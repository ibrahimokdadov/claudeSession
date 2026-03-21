import { useRelativeTime } from './useRelativeTime.js'

const STATUS_META = {
  waiting:  { label: 'waiting',  dot: true,  pulse: false, color: 'var(--accent-waiting)' },
  working:  { label: 'working',  dot: true,  pulse: true,  color: 'var(--accent-working)' },
  thinking: { label: 'thinking', dot: true,  pulse: true,  color: 'var(--accent-working)' },
  done:     { label: 'done',     dot: false, pulse: false, color: 'var(--accent-done)' },
  running:  { label: 'idle',     dot: false, pulse: false, color: 'var(--accent-idle)' },
}

export default function SessionCard({ session, isActive, onSelect }) {
  const timeAgo = useRelativeTime(session.timestamp)
  const meta = STATUS_META[session.status] || STATUS_META.running
  const accentColor = session.color || '#484f58'

  return (
    <div
      className="card-animate"
      onClick={onSelect}
      style={{
        background: isActive
          ? `linear-gradient(135deg, #161b22 0%, ${accentColor}08 100%)`
          : 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        borderLeft: `3px solid ${accentColor}`,
        borderTop:    '1px solid var(--border)',
        borderRight:  '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
        padding: '9px 11px',
        cursor: 'pointer',
        transition: 'background 0.12s, border-color 0.12s',
        outline: isActive ? `1px solid ${accentColor}40` : 'none',
        outlineOffset: 0,
      }}
    >
      {/* Top row: label + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <span style={{
          color: accentColor,
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
          fontSize: 12,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          letterSpacing: '-0.01em',
        }}>
          {session.label || session.project}
        </span>

        {/* Status indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: meta.color,
            display: 'inline-block',
            color: meta.color,
            animation: meta.pulse ? 'pulse-ring 2s ease-out infinite' : 'none',
            flexShrink: 0,
          }} />
          <span style={{
            color: meta.color,
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            {meta.label}
          </span>
        </div>
      </div>

      {/* Bottom row: message + time */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          opacity: session.message ? 1 : 0.4,
        }}>
          {session.message || (session.cwd ? session.cwd.split(/[\\/]/).pop() : '—')}
        </span>
        <span style={{
          fontSize: 10,
          color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)',
          flexShrink: 0,
        }}>
          {timeAgo}
        </span>
      </div>
    </div>
  )
}
