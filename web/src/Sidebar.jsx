// web/src/Sidebar.jsx
import { isStale } from './utils.js'
import { useRelativeTime } from './useRelativeTime.js'

const PULSE_STATUSES = new Set(['working', 'thinking', 'responding', 'subagent'])

function ConnDot({ connected }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: connected ? 'var(--accent-done)' : '#f85149',
        display: 'inline-block', transition: 'background 0.3s',
      }} />
      <span style={{
        fontSize: 10, color: 'var(--text-secondary)',
        fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>
        {connected ? 'live' : 'reconnecting…'}
      </span>
    </div>
  )
}

function ProjectRow({ project, isSelected, onSelect }) {
  const timeAgo = useRelativeTime(project.lastTimestamp)
  const allStale = project.sessions.every(s => isStale(s))
  const pulse = PULSE_STATUSES.has(project.status)

  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', cursor: 'pointer',
        opacity: allStale ? 0.4 : 1,
        borderRight: isSelected ? `2px solid ${project.color}` : '2px solid transparent',
        background: isSelected ? 'var(--bg-tertiary)' : 'transparent',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-secondary)' }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: project.color, color: project.color,
        display: 'inline-block', flexShrink: 0,
        animation: pulse ? 'pulse-ring 2s ease-out infinite' : 'none',
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 11,
          color: isSelected ? project.color : 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {project.label}
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-dim)', display: 'flex', gap: 6, marginTop: 1 }}>
          <span>{project.status === 'running' ? 'idle' : project.status}</span>
          <span>{timeAgo}</span>
        </div>
      </div>
      <span style={{
        fontSize: 8, background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '0 5px', color: 'var(--text-dim)', flexShrink: 0,
      }}>
        {project.sessions.length}
      </span>
    </div>
  )
}

export default function Sidebar({ projects, selectedCwd, connected, onSelect, onSettings }) {
  const projectList = Array.from(projects.values())

  // Sort: active projects first (by lastTimestamp desc), then stale (by lastTimestamp desc)
  const active = projectList
    .filter(p => p.sessions.some(s => !isStale(s)))
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp)
  const stale = projectList
    .filter(p => p.sessions.every(s => isStale(s)))
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp)
  const sorted = [...active, ...stale]

  const totalSessions = projectList.reduce((n, p) => n + p.sessions.length, 0)

  return (
    <div style={{
      width: 200, flexShrink: 0,
      background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* App header */}
      <div style={{
        height: 46, padding: '0 12px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12,
            letterSpacing: '-0.02em', color: 'var(--text-primary)',
          }}>
            claudeSession
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)' }}>
            {totalSessions}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ConnDot connected={connected} />
          <button
            onClick={onSettings}
            title="Settings"
            style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1, padding: '2px 3px', borderRadius: 3 }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
          >⚙</button>
        </div>
      </div>

      {/* Project list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {sorted.length === 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: 'var(--text-dim)',
            fontFamily: 'var(--font-mono)', fontSize: 11,
          }}>
            — no active sessions
          </div>
        )}
        {sorted.map(p => (
          <ProjectRow
            key={p.cwd}
            project={p}
            isSelected={p.cwd === selectedCwd}
            onSelect={() => onSelect(p.cwd)}
          />
        ))}
      </div>
    </div>
  )
}
