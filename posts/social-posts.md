# Social Posts — claudeSession

---

## LinkedIn

### Technical

Built a session identity layer for Claude Code using its native hook system.

The core problem: Claude Code's hooks (SessionStart, PreToolUse, PostToolUse, Stop, Notification) fire on every action but the data goes nowhere by default. claudeSession intercepts those hooks, writes structured session state to disk, and streams it to a React dashboard over WebSocket.

A few specific things worth noting:

- **Session grouping**: sessions are keyed by `cwd` at SessionStart so subagents spawned from the same root project cluster under one tree automatically
- **Subagent tree visualization**: parent-child relationships are inferred from the hook payload's `session_id` chain — you get a real tree of who spawned whom
- **Tab focus**: wrote a PowerShell script using Windows UI Automation to switch Windows Terminal tabs by title, so clicking "Focus" in the dashboard actually brings the right terminal to the foreground
- **Zombie detection**: walks the Windows process tree to find orphaned `node.exe` processes — Claude subagents that exited without triggering a Stop hook

Stack: Node.js + Express + native `ws` WebSocket + React/Vite on the frontend. No database — session state lives in memory and gets snapshotted to JSON on disk.

The hook integration was the interesting constraint. Claude Code doesn't expose a plugin API — you configure hooks as shell commands in settings, and they get called with JSON piped to stdin. So session-hook.js reads stdin, parses the event, and POSTs to the local Express server. Simple, but it works across every Claude Code version without modification.

GitHub: https://github.com/ibrahimokdadov/claudeSession

---

### ELI5

Imagine you have 15 browser tabs open and every single one just says "New Tab". You can't tell which is your banking page, which is your email, which is the video you were watching. You just click around until you find it.

That's what running Claude Code at scale feels like. Every terminal window, every VS Code panel, every tab — all say "Claude Code". You're running 15 sessions across 8 projects and they're completely anonymous.

claudeSession fixes that by watching each session as it runs and building a live dashboard that shows:

- Which project each session belongs to
- What it's currently doing (working, waiting for input, done, crashed)
- Which sessions are parent agents and which are the subagents they spawned
- Which sessions are technically still "running" but actually zombied

One click focuses the right terminal. Another resumes a stale session. Nothing fancy — it just gives each session an identity so you can actually manage what you have open.

https://claudesession.whhite.com

---

### Why we built it

At some point I had 12 Claude Code sessions open across 4 projects and I genuinely could not tell which was which.

I was running a long-form refactor across three services simultaneously. Each had a root session and at least one subagent. The terminal titles all said "Claude Code". The VS Code panels all said "Claude Code". When a session finished and I needed to review its output, I was clicking into random terminals hoping to find the right one.

The thing that broke me was clicking into a terminal, seeing a question waiting for my input, answering it — and then realizing three minutes later I'd answered the wrong session. I'd just sent a detailed code review to a session that was building a database schema.

The problem isn't that Claude Code doesn't show session info — it's that there's no mechanism for it to even try. There's no session registry, no process naming, no status indicator. The hooks exist but they don't feed anything by default.

So I built the registry myself. Now each session has a name, a status badge, a project label, and a position in the subagent tree. The tab confusion problem just... went away.

https://github.com/ibrahimokdadov/claudeSession

---

### What makes it different

Most Claude Code monitoring tools I've seen focus on output — showing you logs, token counts, cost tracking. claudeSession focuses on identity.

A few things that aren't obvious from the description:

**Hook-native, not polling.** State changes happen in real time because claudeSession sits inside Claude's own hook pipeline. There's no file watching or process polling for session status — the hooks fire and the dashboard updates within milliseconds.

**Subagent tree, not a flat list.** When Claude Code spawns subagents, they show up as children under the parent session. You can see the full execution tree for a project at a glance, not just a pile of anonymous sessions.

**Windows Terminal tab control.** Clicking "Focus" in the dashboard calls a PowerShell UI Automation script that actually switches the Windows Terminal tab. Not just "here's the session ID, good luck" — it moves focus to the right terminal.

**Zombie detection.** Sessions that crash without triggering a Stop hook get flagged by walking the process tree. You see a "crashed" badge instead of "working" forever.

None of these required patching Claude Code or using undocumented internals. Everything runs through the documented hook system and standard Node.js process APIs.

https://claudesession.whhite.com

---

### Story

About two months into running Claude Code seriously, I noticed my workflow had a specific failure mode: I'd start a session, context-switch to something else, come back ten minutes later, and spend the first two minutes just figuring out which session I was looking at.

Sometimes I'd run `pwd` to see where I was. Sometimes I'd scroll up to find the first message. For subagents it was worse — they don't even have a conversation thread to scroll through.

The moment that made me actually build something: I was reviewing output from what I thought was a session working on authentication. I gave detailed feedback, approved the approach, told it to proceed. It proceeded — on the payment service, which I hadn't intended to touch at all. I'd been talking to the wrong session for six minutes.

After that I spent a weekend building claudeSession. The SessionStart hook gives you `cwd` and a session ID. The other hooks give you status transitions. Wire those into a dashboard and suddenly every session has an address.

Now I open the dashboard before I open anything else. Green means working. Yellow means waiting. Gray means done. Red means look at it now. And the tree tells me exactly who spawned what.

https://github.com/ibrahimokdadov/claudeSession

---

## Twitter / X

### Technical

Built a session identity layer for Claude Code. Intercepts SessionStart/Stop/PreToolUse hooks, groups by cwd, streams to a React dashboard over WebSocket. Subagent trees auto-build from session_id chains. Tab focus via Windows UI Automation. #ClaudeCode

---

### ELI5

Every Claude Code tab says "Claude Code". With 15 sessions open that's 15 identical tabs. claudeSession watches each session and builds a live dashboard: project name, status, which sessions spawned which. Click to focus the right terminal. #ClaudeCode

---

### Why we built it

I answered a 6-minute conversation in the wrong Claude session. Gave detailed feedback, approved the approach, said proceed. It was working on the wrong service entirely. Built claudeSession that weekend.

---

### What makes it different

Most Claude monitoring tools track output. claudeSession tracks identity — which session is which, who spawned whom, which ones are zombied. Hook-native so updates are real time. One-click Windows Terminal tab focus actually switches the tab. #buildinpublic

---

### Story

Ran `pwd` to figure out which Claude session I was in. That's when I knew I had a tooling problem. claudeSession: https://claudesession.whhite.com
