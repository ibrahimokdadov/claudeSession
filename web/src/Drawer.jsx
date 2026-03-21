import { useState, useEffect, useRef } from 'react'
import { formatDuration } from './useRelativeTime.js'

const COLORS = [
  '#58a6ff', '#f85149', '#3fb950', '#e3b341', '#bc8cff',
  '#f78166', '#79c0ff', '#56d364', '#ffa657', '#ff7b72'
]

function Section({ title, children }) {
  return (
    <div>
      <div style={{
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)',
        fontWeight: 600,
        marginBottom: 8,
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

export default function Drawer({ session, onClose, onUpdate, onKill, onFocus }) {
  const [label, setLabel] = useState(session.label || session.project)
  const [killConfirm, setKillConfirm] = useState(false)
  const [focusMsg, setFocusMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const killTimer = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    setLabel(session.label || session.project)
  }, [session.project, session.label])

  useEffect(() => {
    inputRef.current?.focus()
  }, [session.project])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  function saveLabel() {
    const trimmed = label.trim()
    if (trimmed && trimmed !== (session.label || session.project)) {
      onUpdate({ label: trimmed })
    }
  }

  function handleKill() {
    if (!killConfirm) {
      setKillConfirm(true)
      killTimer.current = setTimeout(() => setKillConfirm(false), 3000)
    } else {
      clearTimeout(killTimer.current)
      onKill()
    }
  }

  async function handleFocus() {
    const result = await onFocus()
    if (result?.focused) {
      setFocusMsg('Focused!')
      setTimeout(() => setFocusMsg(''), 2000)
    }
  }

  function handleCopyId() {
    if (!session.sessionId) return
    navigator.clipboard.writeText(session.sessionId)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const accentColor = session.color || '#484f58'
  const uptime = session.firstSeen
    ? formatDuration(Date.now() - new Date(session.firstSeen).getTime())
    : null

  return (
    <>
      {/* Invisible backdrop for click-outside close */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 10 }}
      />

      {/* Drawer panel */}
      <div
        className="drawer-animate"
        style={{
          position: 'relative',
          zIndex: 11,
          width: 290,
          flexShrink: 0,
          background: 'var(--bg-secondary)',
          borderLeft: `1px solid ${accentColor}40`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Accent stripe at top */}
        <div style={{ height: 2, background: accentColor, flexShrink: 0 }} />

        {/* Header */}
        <div style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: accentColor, flexShrink: 0,
          }} />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 600,
            fontSize: 12,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: accentColor,
          }}>
            {session.project}
          </span>
          {uptime && (
            <span style={{
              fontSize: 10,
              color: 'var(--text-dim)',
              fontFamily: 'var(--font-mono)',
              flexShrink: 0,
            }}>
              {uptime}
            </span>
          )}
          <button
            onClick={onClose}
            style={{
              color: 'var(--text-secondary)',
              fontSize: 16,
              lineHeight: 1,
              padding: '0 2px',
              flexShrink: 0,
              transition: 'color 0.1s',
            }}
            onMouseEnter={e => e.target.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.target.style.color = 'var(--text-secondary)'}
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}>

          {/* Label */}
          <Section title="Label">
            <input
              ref={inputRef}
              value={label}
              onChange={e => setLabel(e.target.value)}
              onBlur={saveLabel}
              onKeyDown={e => {
                if (e.key === 'Enter') { saveLabel(); e.target.blur() }
              }}
              style={{
                width: '100%',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 8px',
                color: 'var(--text-primary)',
                outline: 'none',
                fontSize: 12,
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = accentColor}
              onBlurCapture={e => e.target.style.borderColor = 'var(--border)'}
            />
          </Section>

          {/* Color */}
          <Section title="Color">
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => onUpdate({ color: c })}
                  title={c}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: c,
                    padding: 0,
                    outline: c === session.color ? `2px solid ${c}` : '2px solid transparent',
                    outlineOffset: 2,
                    transition: 'transform 0.1s, outline 0.1s',
                    transform: c === session.color ? 'scale(1.15)' : 'scale(1)',
                  }}
                  onMouseEnter={e => { if (c !== session.color) e.target.style.transform = 'scale(1.1)' }}
                  onMouseLeave={e => { if (c !== session.color) e.target.style.transform = 'scale(1)' }}
                />
              ))}
            </div>
          </Section>

          {/* Path */}
          <Section title="Path">
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--text-secondary)',
              wordBreak: 'break-all',
              userSelect: 'text',
              lineHeight: 1.6,
            }}>
              {session.cwd || '—'}
            </div>
          </Section>

          {/* Session ID */}
          {session.sessionId && (
            <Section title="Session ID">
              <button
                onClick={handleCopyId}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: copied ? 'var(--accent-done)' : 'var(--text-secondary)',
                  padding: 0,
                  textAlign: 'left',
                  transition: 'color 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
                title="Click to copy full ID"
              >
                <span>{session.sessionId.slice(0, 8)}…</span>
                <span style={{ fontSize: 9, opacity: 0.6 }}>
                  {copied ? '✓ copied' : 'copy'}
                </span>
              </button>
            </Section>
          )}

          {/* Status */}
          <Section title="Status">
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-secondary)',
            }}>
              {session.status}
              {session.message && (
                <span style={{ color: 'var(--text-dim)', marginLeft: 8 }}>
                  — {session.message}
                </span>
              )}
            </span>
          </Section>
        </div>

        {/* Footer actions */}
        <div style={{
          padding: '10px 12px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          gap: 6,
          flexShrink: 0,
        }}>
          <button
            onClick={handleFocus}
            style={{
              flex: 1,
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '7px 0',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: focusMsg ? 'var(--accent-done)' : 'var(--text-primary)',
              transition: 'all 0.15s',
            }}
          >
            {focusMsg || 'focus'}
          </button>
          <button
            onClick={handleKill}
            style={{
              flex: 1,
              background: killConfirm ? '#f8514918' : 'var(--bg-tertiary)',
              border: `1px solid ${killConfirm ? '#f85149' : 'var(--border)'}`,
              borderRadius: 'var(--radius-sm)',
              padding: '7px 0',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: killConfirm ? '#f85149' : 'var(--text-secondary)',
              transition: 'all 0.15s',
            }}
          >
            {killConfirm ? 'confirm?' : 'kill'}
          </button>
        </div>
      </div>
    </>
  )
}
