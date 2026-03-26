export const STALE_MS = 2 * 60 * 60 * 1000 // 2 hours

export const ACTIVE_STATUSES = new Set(['working', 'waiting', 'thinking', 'responding', 'subagent'])

// Lower number = higher priority
export const STATUS_PRIORITY = {
  working:    1,
  thinking:   2,
  responding: 3,
  subagent:   4,
  waiting:    5,
  done:       6,
  running:    7,
}

export const STATUS_META = {
  working:    { label: 'working',    color: 'var(--accent-working)', pulse: true  },
  thinking:   { label: 'thinking',   color: 'var(--accent-working)', pulse: true  },
  responding: { label: 'responding', color: 'var(--accent-working)', pulse: true  },
  subagent:   { label: 'subagent',   color: '#bc8cff',               pulse: true  },
  waiting:    { label: 'waiting',    color: 'var(--accent-waiting)', pulse: false },
  done:       { label: 'done',       color: 'var(--accent-done)',    pulse: false },
  running:    { label: 'idle',       color: 'var(--accent-idle)',    pulse: false },
}

/** A session is stale if it hasn't been updated in 2h AND is not in an active status.
 *  Sessions stuck at 'working' for >2h are intentionally NOT stale — the user can kill them. */
export function isStale(session) {
  return session.timestamp < Date.now() - STALE_MS &&
    !ACTIVE_STATUSES.has(session.status)
}

/** Returns the highest-priority status across all non-stale sessions.
 *  Falls back to the most recent session's status if all are stale. */
export function projectStatus(sessions) {
  const nonStale = sessions.filter(s => !isStale(s))
  const pool = nonStale.length > 0 ? nonStale : sessions
  return pool.reduce((best, s) => {
    const bp = STATUS_PRIORITY[best]  ?? 7
    const sp = STATUS_PRIORITY[s.status] ?? 7
    return sp < bp ? s.status : best
  }, pool[0]?.status ?? 'running')
}

/** Normalize a cwd path: forward slashes, lowercase drive letter. */
function normalizeCwd(cwd) {
  return cwd.replace(/\\/g, '/').replace(/^([A-Z]):/, m => m.toLowerCase())
}

/** Get the project root: strip /.worktrees/... (and any sub-paths after it) so all
 *  worktrees for the same repo collapse into a single project row. */
function getProjectRoot(cwd) {
  const norm = normalizeCwd(cwd)
  const idx = norm.indexOf('/.worktrees/')
  return idx !== -1 ? norm.slice(0, idx) : norm
}

/** Groups a sessions Map (fileKey → session) into a projects Map (cwd → project).
 *  Each project: { cwd, project, label, color, status, lastTimestamp, sessions[] } */
export function groupIntoProjects(sessionsMap) {
  const projects = new Map()

  for (const session of sessionsMap.values()) {
    const { cwd } = session
    if (!cwd) continue

    const key = getProjectRoot(cwd)

    if (!projects.has(key)) {
      const rootName = key.split('/').at(-1) || key
      projects.set(key, {
        cwd: key,  // normalized project root path — consistent key for selectedCwd
        project:       rootName,
        label:         session.label || rootName,
        color:         session.color   || 'var(--accent-working)',
        status:        'running',
        lastTimestamp: 0,
        sessions:      [],
      })
    }

    const proj = projects.get(key)
    // Tag session with worktree name if it lives in a sub-path of the root
    const normSession = normalizeCwd(cwd)
    const worktree = normSession !== key
      ? normSession.slice(key.length).replace(/^\/\.worktrees\//, '').split('/')[0]
      : null
    proj.sessions.push({ ...session, worktree })
    if ((session.timestamp || 0) > proj.lastTimestamp) {
      proj.lastTimestamp = session.timestamp
      // Use most recent session for label/color meta
      if (session.label)   proj.label = session.label
      if (session.color)   proj.color = session.color
      if (session.project) proj.project = session.project
    }
  }

  // Sort each project's sessions by timestamp desc, compute project status
  for (const proj of projects.values()) {
    proj.sessions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    proj.status = projectStatus(proj.sessions)
  }

  return projects
}
