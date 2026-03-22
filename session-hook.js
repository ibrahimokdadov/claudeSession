#!/usr/bin/env node
// Called by Claude Code hooks to write session status
// Usage: node session-hook.js <status>

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const status      = process.argv[2] || 'idle';
const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
const mapFile     = path.join(os.homedir(), '.claude', 'session-map.json');
const metaFile    = path.join(os.homedir(), '.claude', 'session-meta.json');

// Extract a human-readable summary from the hook's tool input
function extractMessage(data) {
  const tool  = data.tool_name || '';
  const input = data.tool_input || {};

  if (tool === 'Bash' && input.command) {
    // Show first meaningful part of the command, strip leading whitespace/flags
    return input.command.trim().substring(0, 40);
  }
  if ((tool === 'Read' || tool === 'Write' || tool === 'Edit') && input.file_path) {
    return path.basename(input.file_path);
  }
  if (tool === 'Glob' && input.pattern) return input.pattern.substring(0, 40);
  if (tool === 'Grep' && input.pattern) return input.pattern.substring(0, 40);
  if (tool === 'WebFetch' && input.url)  return new URL(input.url).hostname;
  if (tool === 'WebSearch' && input.query) return input.query.substring(0, 40);
  if (tool === 'Agent' && input.description) return input.description.substring(0, 40);
  if (tool)                              return tool;
  if (data.message)                      return data.message;
  if (data.type)                         return data.type;
  return '';
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => (input += d));
process.stdin.on('end', () => {
  let message   = '';
  let sessionId = '';
  try {
    const data = JSON.parse(input);
    if (data.session_id) sessionId = data.session_id;
    message = extractMessage(data);
  } catch (_) {}

  const cwd     = process.env.PWD || process.cwd();
  const project = path.basename(cwd);

  fs.mkdirSync(sessionsDir, { recursive: true });

  const filename = sessionId ? `${project}-${sessionId.substring(0, 8)}.json` : `${project}.json`;
  const filepath = path.join(sessionsDir, filename);

  // SubagentStart: record spawn intent so the child session can claim its parent
  if (status === 'subagent') {
    if (sessionId) {
      const intentFile = path.join(sessionsDir, `.spawn-intent-${sessionId.substring(0, 8)}.json`);
      const tmpIntent = intentFile + '.tmp';
      fs.writeFileSync(tmpIntent, JSON.stringify({ parentSessionId: sessionId, cwd, timestamp: Date.now() }));
      fs.renameSync(tmpIntent, intentFile);
    }
    return;
  }

  // "ended" = session is gone, clean up immediately instead of waiting for stale timeout
  if (status === 'ended') {
    try { fs.unlinkSync(filepath); } catch (_) {}
    return;
  }

  // Detect terminal ancestor once per session (when file doesn't yet have terminalPid)
  let terminalPid = null;
  let terminalType = null;
  try {
    const existing = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    terminalPid  = existing.terminalPid  || null;
    terminalType = existing.terminalType || null;
  } catch (_) {}

  if (!terminalPid) {
    try {
      const { execSync } = require('child_process');
      const KNOWN = ['WindowsTerminal', 'ConEmu64', 'ConEmu', 'Code', 'mintty', 'Hyper', 'Warp', 'warp'];
      const knownList = KNOWN.map(n => `'${n}'`).join(',');
      const script = [
        `$known = @(${knownList});`,
        `$p = ${process.ppid};`,
        `for ($i = 0; $i -lt 10; $i++) {`,
        `  $proc = Get-CimInstance Win32_Process | Where-Object ProcessId -eq $p | Select-Object -First 1;`,
        `  if (-not $proc) { break }`,
        `  $name = $proc.Name -replace '\\.exe$','';`,
        `  if ($name -in $known) {`,
        `    [PSCustomObject]@{ pid = [int]$proc.ProcessId; type = $name } | ConvertTo-Json -Compress;`,
        `    break`,
        `  }`,
        `  if ($proc.ParentProcessId -le 0) { break }`,
        `  $p = $proc.ParentProcessId`,
        `}`,
      ].join(' ');
      const raw = execSync(`powershell.exe -NonInteractive -Command "${script}"`,
        { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (raw) {
        const info = JSON.parse(raw);
        terminalPid  = info.pid  || null;
        terminalType = info.type || null;
      }
    } catch (_) {}
  }

  // Determine parentSessionId: read from existing file or claim a recent spawn intent
  let parentSessionId = null;
  try {
    const existing = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    parentSessionId = existing.parentSessionId || null;
  } catch (_) {}

  if (!parentSessionId) {
    try {
      const now = Date.now();
      const intentFiles = fs.readdirSync(sessionsDir)
        .filter(f => f.startsWith('.spawn-intent-') && f.endsWith('.json'))
        .map(f => {
          try { return { name: f, intent: JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8')) }; }
          catch (_) { return null; }
        })
        .filter(x => x && x.intent.cwd === cwd && now - x.intent.timestamp < 10000)
        .sort((a, b) => b.intent.timestamp - a.intent.timestamp); // most recent first
      if (intentFiles.length > 0) {
        const { name, intent } = intentFiles[0];
        parentSessionId = intent.parentSessionId;
        try { fs.unlinkSync(path.join(sessionsDir, name)); } catch (_) {} // claim it
      }
    } catch (_) {}
  }

  // Atomic write: write to .tmp then rename to avoid partial reads on fast refresh
  const tmpPath = filepath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify({ project, status, message, cwd, sessionId, pid: process.ppid, terminalPid, terminalType, parentSessionId, timestamp: Date.now() }));
  fs.renameSync(tmpPath, filepath);

  // Persist session ID → project mapping for crash recovery
  if (sessionId) {
    let map = {};
    try { map = JSON.parse(fs.readFileSync(mapFile, 'utf8')); } catch (_) {}
    map[sessionId] = { project, cwd, firstSeen: map[sessionId]?.firstSeen || new Date().toISOString(), lastSeen: new Date().toISOString() };
    const tmpMap = mapFile + '.tmp';
    fs.writeFileSync(tmpMap, JSON.stringify(map, null, 2));
    fs.renameSync(tmpMap, mapFile);
  }

  // Emit ANSI escapes for Windows Terminal tab title + color
  try {
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (_) {}
    const entry = meta[cwd] || {};
    const label = entry.label || project;
    const color = entry.color || null;
    process.stdout.write(`\x1b]0;[${label}] ${status}\x07`);
    if (color) process.stdout.write(`\x1b]9;8;"${color}"\x07`);
  } catch (_) {}
});
