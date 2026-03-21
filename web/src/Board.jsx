import SessionCard from './SessionCard.jsx'

const COLUMNS = [
  { id: 'waiting',  label: 'Waiting',  statuses: ['waiting'],             accent: 'var(--accent-waiting)' },
  { id: 'working',  label: 'Working',  statuses: ['working', 'thinking'], accent: 'var(--accent-working)' },
  { id: 'done',     label: 'Done',     statuses: ['done'],                accent: 'var(--accent-done)'    },
  { id: 'idle',     label: 'Idle',     statuses: ['running'],             accent: 'var(--accent-idle)'    },
]

function ConnDot({ connected }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: connected ? 'var(--accent-done)' : '#f85149',
        display: 'inline-block',
        transition: 'background 0.3s',
      }} />
      <span style={{
        fontSize: 10,
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-mono)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}>
        {connected ? 'live' : 'reconnecting…'}
      </span>
    </div>
  )
}

export default function Board({ sessions, activeProject, connected, onSelect }) {
  const total = sessions.length

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      minWidth: 0,
      background: 'var(--bg-primary)',
    }}>
      {/* Header */}
      <div style={{
        padding: '0 20px',
        height: 46,
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--bg-secondary)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: '-0.02em',
            color: 'var(--text-primary)',
          }}>
            claudeSession
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-dim)',
          }}>
            {total} session{total !== 1 ? 's' : ''}
          </span>
        </div>
        <ConnDot connected={connected} />
      </div>

      {/* Columns grid */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        overflow: 'hidden',
        gap: 0,
      }}>
        {COLUMNS.map((col, i) => {
          const cards = sessions.filter(s => col.statuses.includes(s.status))
          return (
            <div key={col.id} style={{
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              borderRight: i < COLUMNS.length - 1 ? '1px solid var(--border-dim)' : 'none',
            }}>
              {/* Column header */}
              <div style={{
                padding: '9px 14px 8px',
                borderBottom: `1px solid var(--border)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'var(--bg-secondary)',
                flexShrink: 0,
              }}>
                <span style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 600,
                }}>
                  {col.label}
                </span>
                <span style={{
                  fontSize: 10,
                  color: cards.length > 0 ? col.accent : 'var(--text-dim)',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  background: cards.length > 0 ? `${col.accent}15` : 'transparent',
                  padding: '1px 6px',
                  borderRadius: 10,
                  transition: 'all 0.2s',
                  minWidth: 20,
                  textAlign: 'center',
                }}>
                  {cards.length}
                </span>
              </div>

              {/* Scrollable cards area */}
              <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}>
                {cards.map(s => (
                  <SessionCard
                    key={s.project}
                    session={s}
                    isActive={activeProject === s.project}
                    onSelect={() => onSelect(s.project)}
                  />
                ))}
                {cards.length === 0 && (
                  <div style={{
                    color: 'var(--text-dim)',
                    fontSize: 11,
                    padding: '12px 4px',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.02em',
                  }}>
                    —
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
