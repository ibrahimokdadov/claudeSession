import { useState, useEffect } from 'react'

export default function Settings({ onClose }) {
  const [data, setData]       = useState(null)   // { terminals, preferred }
  const [selected, setSelected] = useState(null)
  const [saved, setSaved]     = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/terminals')
      .then(r => r.json())
      .then(d => {
        setData(d)
        setSelected(d.preferred || '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function save() {
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredTerminal: selected || null }),
    }).then(() => {
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 20,
          background: 'rgba(0,0,0,0.5)',
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 21,
        width: 380,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{
          padding: '13px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: 'var(--text-primary)',
          }}>
            settings
          </span>
          <button
            onClick={onClose}
            style={{ color: 'var(--text-secondary)', fontSize: 18, lineHeight: 1, padding: '0 2px' }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px' }}>
          <div style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: 'var(--text-dim)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 600,
            marginBottom: 10,
          }}>
            Terminal for Focus
          </div>

          {loading && (
            <div style={{ color: 'var(--text-secondary)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
              scanning…
            </div>
          )}

          {!loading && data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {/* Auto option */}
              <TerminalRow
                name=""
                label="Auto-detect"
                subtitle="Walk process tree from each session"
                running={false}
                selected={!selected}
                onSelect={() => setSelected('')}
              />

              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

              {data.terminals.map(t => (
                <TerminalRow
                  key={t.name}
                  name={t.name}
                  label={t.label}
                  running={t.running}
                  selected={selected === t.name}
                  onSelect={() => setSelected(t.name)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 16px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 14px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 4,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)',
            }}
          >
            cancel
          </button>
          <button
            onClick={save}
            style={{
              padding: '6px 14px',
              background: saved ? '#3fb95018' : 'var(--bg-tertiary)',
              border: `1px solid ${saved ? 'var(--accent-done)' : 'var(--border)'}`,
              borderRadius: 4,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: saved ? 'var(--accent-done)' : 'var(--text-primary)',
              transition: 'all 0.15s',
            }}
          >
            {saved ? 'saved ✓' : 'save'}
          </button>
        </div>
      </div>
    </>
  )
}

function TerminalRow({ label, subtitle, running, selected, onSelect }) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 4,
        cursor: 'pointer',
        background: selected ? 'var(--bg-tertiary)' : 'transparent',
        border: `1px solid ${selected ? 'var(--border)' : 'transparent'}`,
        transition: 'background 0.1s',
      }}
    >
      {/* Radio */}
      <div style={{
        width: 14, height: 14,
        borderRadius: '50%',
        border: `2px solid ${selected ? 'var(--accent-working)' : 'var(--border)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        transition: 'border-color 0.15s',
      }}>
        {selected && (
          <div style={{
            width: 6, height: 6,
            borderRadius: '50%',
            background: 'var(--accent-working)',
          }} />
        )}
      </div>

      {/* Label */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-primary)',
        }}>
          {label}
        </div>
        {subtitle && (
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>
            {subtitle}
          </div>
        )}
      </div>

      {/* Running indicator */}
      {running && (
        <span style={{
          fontSize: 9,
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--accent-done)',
          background: '#3fb95015',
          padding: '2px 6px',
          borderRadius: 3,
          flexShrink: 0,
        }}>
          running
        </span>
      )}
    </div>
  )
}
