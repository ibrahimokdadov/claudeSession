// web/src/SessionTree.jsx
import { useState } from 'react'
import { isStale, STATUS_META, ACTIVE_STATUSES } from './utils.js'
import { useRelativeTime } from './useRelativeTime.js'

const MAX_DEPTH = 4

/** Build parent→child maps from flat sessions array. */
function buildTree(sessions) {
  const byId = new Map(
    sessions.filter(s => s.sessionId).map(s => [s.sessionId, s])
  )
  const projectIds = new Set(byId.keys())
  const childMap = new Map()  // parentSessionId → child[]
  const roots = []

  for (const s of sessions) {
    if (s.parentSessionId && projectIds.has(s.parentSessionId)) {
      if (!childMap.has(s.parentSessionId)) childMap.set(s.parentSessionId, [])
      childMap.get(s.parentSessionId).push(s)
    } else {
      roots.push(s)
    }
  }

  roots.sort((a, b) => b.timestamp - a.timestamp)
  for (const children of childMap.values()) {
    children.sort((a, b) => b.timestamp - a.timestamp)
  }

  return { roots, childMap }
}

function SessionNode({ session, depth, isLast, onFocus, onKill }) {
  const [killConfirm, setKillConfirm] = useState(false)
  const timeAgo = useRelativeTime(session.timestamp)
  const stale = isStale(session)
  const meta = STATUS_META[session.status] || STATUS_META.running
  const canFocus = !stale && !!session.terminalPid
  const canKill  = !stale && ACTIVE_STATUSES.has(session.status)

  function handleKill() {
    if (!killConfirm) {
      setKillConfirm(true)
      setTimeout(() => setKillConfirm(false), 3000)
    } else {
      setKillConfirm(false)
      onKill(session.fileKey)
    }
  }

  return (
    <div style={{
      opacity: stale ? 0.38 : 1,
      display: 'flex',
      alignItems: 'stretch',
      paddingLeft: depth * 20,
    }}>
      {depth > 0 && (
        <div style={{
          width: 20, flexShrink: 0,
          display: 'flex', alignItems: 'flex-start',
          paddingTop: 8, fontSize: 10, color: 'var(--border)',
          marginLeft: -20,
          borderLeft: '1px solid var(--border-dim)',
          paddingLeft: 6,
        }}>
          {isLast ? '└─' : '├─'}
        </div>
      )}
      <div
        style={{ flex: 1, borderRadius: 5, padding: '5px 8px', margin: '2px 0', transition: 'background 0.1s' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {/* Top row: dot + id + status + time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: meta.color, color: meta.color,
            display: 'inline-block', flexShrink: 0,
            animation: meta.pulse ? 'pulse-ring 2s ease-out infinite' : 'none',
          }} />
          <span style={{
            fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 11,
            color: 'var(--text-primary)',
          }}>
            {(session.sessionId || session.fileKey).slice(0, 8)}
          </span>
          <span style={{
            fontSize: 9, textTransform: 'uppercase',
            letterSpacing: '0.05em', fontWeight: 500, color: meta.color,
          }}>
            {meta.label}
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-dim)', marginLeft: 'auto' }}>
            {timeAgo}
          </span>
        </div>

        {/* Worktree badge — shown when session lives in a sub-path (worktree) */}
        {session.worktree && (
          <div style={{
            fontSize: 9, color: 'var(--text-dim)', marginTop: 1,
            paddingLeft: 12, fontFamily: 'var(--font-mono)',
          }}>
            ↳ {session.worktree}
          </div>
        )}

        {/* Message row */}
        {session.message && (
          <div style={{
            fontSize: 10, color: 'var(--text-secondary)', marginTop: 2,
            paddingLeft: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {session.message}
          </div>
        )}

        {/* Action buttons — only on non-stale sessions */}
        {(canFocus || canKill) && (
          <div style={{ display: 'flex', gap: 5, marginTop: 5, paddingLeft: 12 }}>
            {canFocus && (
              <button
                onClick={() => onFocus(session.fileKey)}
                style={{
                  fontSize: 9, fontFamily: 'var(--font-mono)',
                  border: '1px solid var(--border)', borderRadius: 3,
                  padding: '2px 9px', background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.1s',
                }}
                onMouseEnter={e => { e.target.style.color = 'var(--text-primary)'; e.target.style.borderColor = 'var(--text-secondary)' }}
                onMouseLeave={e => { e.target.style.color = 'var(--text-secondary)'; e.target.style.borderColor = 'var(--border)' }}
              >
                focus
              </button>
            )}
            {canKill && (
              <button
                onClick={handleKill}
                style={{
                  fontSize: 9, fontFamily: 'var(--font-mono)',
                  border: `1px solid ${killConfirm ? '#f85149' : 'var(--border)'}`,
                  borderRadius: 3, padding: '2px 9px',
                  background: killConfirm ? '#f8514918' : 'var(--bg-tertiary)',
                  color: killConfirm ? '#f85149' : 'var(--text-secondary)',
                  cursor: 'pointer', transition: 'all 0.1s',
                }}
              >
                {killConfirm ? 'confirm?' : 'kill'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Recursively render a session and its visible children. */
function renderSubtree(session, depth, childMap, isLast, onFocus, onKill, showAll) {
  if (isStale(session) && !showAll) return []

  const children = childMap.get(session.sessionId) || []
  const visibleChildren = showAll ? children : children.filter(c => !isStale(c))

  return [
    <SessionNode
      key={session.fileKey}
      session={session}
      depth={depth}
      isLast={isLast}
      onFocus={onFocus}
      onKill={onKill}
    />,
    ...visibleChildren.flatMap((child, i) => {
      const isLastChild = i === visibleChildren.length - 1
      // Beyond MAX_DEPTH, render flat at MAX_DEPTH rather than nesting deeper
      const nextDepth = Math.min(depth + 1, MAX_DEPTH)
      return renderSubtree(child, nextDepth, childMap, isLastChild, onFocus, onKill, showAll)
    }),
  ]
}

export default function SessionTree({ sessions, showAll, onToggleShowAll, onFocus, onKill }) {
  const { roots, childMap } = buildTree(sessions)

  const staleCount = sessions.filter(s => isStale(s)).length
  const allStale   = staleCount === sessions.length
  // If all sessions are stale, show them regardless of showAll (nothing to hide)
  const effectiveShowAll = showAll || allStale
  const hiddenCount = effectiveShowAll ? 0 : staleCount

  const visibleRoots = effectiveShowAll ? roots : roots.filter(r => !isStale(r))

  const activeCount = sessions.length - staleCount
  const label = sessions.length === 0
    ? null
    : sessions.length === 1
    ? '1 session'
    : `${sessions.length} sessions${activeCount < sessions.length ? ` · ${activeCount} active` : ''}`

  return (
    <div>
      {label && (
        <div style={{
          fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em',
          color: 'var(--text-dim)', fontWeight: 600, marginBottom: 10,
        }}>
          {label}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {visibleRoots.flatMap((root, i) =>
          renderSubtree(root, 0, childMap, i === visibleRoots.length - 1, onFocus, onKill, effectiveShowAll)
        )}
      </div>

      {hiddenCount > 0 && (
        <div style={{
          marginTop: 10, padding: '6px 8px',
          border: '1px dashed var(--border-dim)', borderRadius: 4,
          fontSize: 10, color: 'var(--text-dim)',
        }}>
          {hiddenCount} older session{hiddenCount !== 1 ? 's' : ''} hidden ·{' '}
          <span
            onClick={onToggleShowAll}
            style={{ color: 'var(--accent-working)', cursor: 'pointer' }}
          >
            show all
          </span>
        </div>
      )}

      {sessions.length === 0 && (
        <div style={{
          fontSize: 11, color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)', padding: '8px 0',
        }}>
          —
        </div>
      )}
    </div>
  )
}
