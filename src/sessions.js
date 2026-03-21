const fs   = require('fs')
const path = require('path')
const os   = require('os')

const sessionsDir = path.join(os.homedir(), '.claude', 'sessions')
const metaFile    = path.join(os.homedir(), '.claude', 'session-meta.json')

// In-memory store: Map<fileKey, sessionObject>
// fileKey = filename stem, e.g. "postwriter-a1b2c3d4"
const store = new Map()

function mergeMeta(session, meta) {
  const entry = meta[session.cwd] || {}
  return {
    ...session,
    fileKey: session.fileKey,
    label:   entry.label    || session.project,
    color:   entry.color    || '#8b949e',
    firstSeen: entry.firstSeen || null
  }
}

function fileKeyFromPath(filePath) {
  return path.basename(filePath, '.json')
}

function loadAll(meta) {
  store.clear()
  if (!fs.existsSync(sessionsDir)) return
  for (const file of fs.readdirSync(sessionsDir)) {
    if (!file.endsWith('.json') || file.endsWith('.tmp')) continue
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'))
      const fileKey = path.basename(file, '.json')
      store.set(fileKey, mergeMeta({ ...raw, fileKey }, meta))
    } catch (_) {}
  }
}

function updateFromFile(filePath, meta) {
  if (filePath.endsWith('.tmp')) return null
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const fileKey = fileKeyFromPath(filePath)
    const merged = mergeMeta({ ...raw, fileKey }, meta)
    store.set(fileKey, merged)
    return merged
  } catch (_) {
    return null
  }
}

function removeByFile(filePath) {
  const fileKey = fileKeyFromPath(filePath)
  store.delete(fileKey)
  return fileKey
}

function getAll() {
  return Array.from(store.values())
}

function getByFileKey(fileKey) {
  return store.get(fileKey) || null
}

module.exports = { store, loadAll, updateFromFile, removeByFile, getAll, getByFileKey, sessionsDir, metaFile }
