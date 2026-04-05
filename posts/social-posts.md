# Social Posts — claudeSession

---

## LinkedIn

### Technical

claudeSession hooks into Claude Code's native event pipeline: SessionStart, PreToolUse, PostToolUse, Stop, Notification. Those hooks fire on every action but send their JSON to stdout by default -> nothing persists. session-hook.js reads that stdin payload, writes structured state to disk, and the Express server streams updates to a React dashboard over WebSocket.

Session grouping works by keying on `cwd` at SessionStart, so subagents spawned from the same root directory cluster automatically under one project entry. Parent-child relationships come from the `session_id` chain in the hook payload, which means the dashboard renders a real tree rather than a flat list.

Tab focus was the fiddliest part. I wrote a PowerShell script using Windows UI Automation that switches Windows Terminal tabs by title string, so clicking "Focus" in the dashboard actually brings the right terminal forward, not just highlights it.

Zombie detection walks the Windows process tree looking for orphaned `node.exe` processes -> Claude subagents that crashed without firing a Stop hook. They show up with a "crashed" badge instead of staying "working" forever.

Stack: Node.js, Express, native `ws` WebSocket, React/Vite. No database. Session state lives in memory with JSON snapshots on disk. The hook integration is a shell command in Claude Code's settings file that pipes to `node session-hook.js`. Works across every Claude Code version without touching internals.

GitHub: https://github.com/ibrahimokdadov/claudeSession

---

### ELI5

Picture 15 browser tabs, all saying "New Tab". No favicons, no titles, nothing. You want your banking page and you're clicking through tabs until you find it.

Running Claude Code across several projects at once is like that. Every terminal, every VS Code panel -> all say "Claude Code". You've got 15 sessions open across 8 projects and none of them have names.

claudeSession watches each session as it runs and builds a live dashboard showing which project it belongs to, what it's doing right now (working, waiting, done, crashed), and which sessions spawned which. One click focuses the right terminal. Another resumes a stale one. Each session just gets an identity.

https://claudesession.whhite.com

---

### Why we built it

At some point I had 12 sessions open across 4 projects and genuinely couldn't tell them apart.

I was running a refactor across three services simultaneously. Each had a root session and at least one subagent, the terminal titles all said "Claude Code," and when a session finished and I needed to review the output, I was clicking into random terminals hoping to land on the right one.

What actually broke me: I clicked into a terminal, saw a question waiting for input, answered it in detail, approved the approach, told it to proceed. Three minutes later I realized I'd been talking to the wrong session for the last six minutes. It proceeded -> on the payment service, which I hadn't meant to touch.

That was the weekend I built the session registry. Now each one has a name, a status, a project, and a position in the tree.

https://github.com/ibrahimokdadov/claudeSession

---

### What makes it different

Most Claude Code monitoring tools I've seen are about output -> logs, token counts, cost. claudeSession is about identity. Which session is which. Who spawned whom. Which ones crashed without telling you.

Status updates happen in real time because claudeSession sits inside Claude's hook pipeline, so there's no file watching or polling loop. The hooks fire and the dashboard updates in milliseconds. The subagent tree isn't a flat list either -> when Claude spawns agents they appear as children under the parent session with tree lines showing the relationship, which for a project running three parallel agents means you can see the full execution structure at a glance.

Clicking "Focus" calls a PowerShell UI Automation script that actually switches the Windows Terminal tab. Not just "here's the PID, figure it out" -> it moves focus to the right terminal. And none of this required patching Claude Code. Everything runs through the documented hook system and standard Node.js process APIs.

https://claudesession.whhite.com

---

### Story

About two months into running Claude Code seriously, I developed a specific habit: I'd run `pwd` when switching sessions to figure out which project I was in.

Fine, I guess. Then I started checking scrollback to find the first message. For subagents it was worse -> they don't have a conversation thread to scroll through.

The moment I actually built something: I was reviewing output from a session I thought was working on authentication. Gave detailed feedback, approved the approach, said proceed. It proceeded. On the payment service. I'd been in the wrong terminal for six minutes without realizing it.

I spent the next weekend wiring SessionStart hooks into a dashboard. `cwd` plus session ID gives you everything you need to build the registry, the other hooks give you status transitions, and that's probably 80% of the useful data. Now I open the dashboard before I open anything else. Green means working. Yellow means waiting. Gray means done. Red means stop what you're doing. I'm still not sure what the right color for "zombie" is.

https://github.com/ibrahimokdadov/claudeSession

---

## Twitter / X

### Technical

Built session identity for Claude Code. Intercepts SessionStart/Stop/PreToolUse hooks, groups by cwd, streams over WebSocket to a React dashboard. Subagent trees auto-build from session_id chains. Tab focus via PowerShell UI Automation. #ClaudeCode

---

### ELI5

15 Claude Code tabs, all titled "Claude Code". You can't tell which project is which or what any of them are doing. claudeSession watches each session and gives them names, statuses, and a project. Click to focus the right terminal. #ClaudeCode

---

### Why we built it

I gave detailed feedback to the wrong Claude session for six minutes, approved the approach, said proceed. It rewrote the payment service. Built claudeSession that weekend.

---

### What makes it different

Other Claude tools track tokens and cost. claudeSession tracks which session is which, who spawned whom, which ones crashed. Hook-native so updates are instant. "Focus" actually switches the Windows Terminal tab. #buildinpublic

---

### Story

I ran `pwd` to figure out which Claude session I was in. That was the moment I knew I had a problem. claudeSession: https://claudesession.whhite.com
