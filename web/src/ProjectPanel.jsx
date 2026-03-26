// web/src/ProjectPanel.jsx
import { useState, useEffect, useRef } from 'react'
import SessionTree from './SessionTree.jsx'
import { isStale } from './utils.js'

const COLORS = [
  '#58a6ff', '#f85149', '#3fb950', '#e3b341', '#bc8cff',
  '#f78166', '#79c0ff', '#56d364', '#ffa657', '#ff7b72',
]

export default function ProjectPanel({ project, showAll, onToggleShowAll, onUpdate, onFocus, onKill }) {
  const [label, setLabel] = useState(project.label)
  const inputRef = useRef(null)
  const [openLabel, setOpenLabel] = useState('open')

  async function handleOpen() {
    const active = project.sessions.filter(s => !isStale(s))
    const target = (active.length ? active : project.sessions)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0]
    if (!target) return
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(target.fileKey)}/focus`, { method: 'POST' })
      const d = await r.json()
      const next = d.focused ? 'focused!' : d.opened ? 'opened!' : 'open'
      setOpenLabel(next)
      setTimeout(() => setOpenLabel('open'), 2000)
    } catch (_) {}
  }

  // Sync label when project changes
  useEffect(() => {
    setLabel(project.label)
  }, [project.cwd, project.label])

  function saveLabel() {
    const trimmed = label.trim()
    if (trimmed && trimmed !== project.label) onUpdate({ label: trimmed })
  }

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: 'var(--bg-primary)', minWidth: 0, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: project.color, flexShrink: 0,
          }} />
          <input
            ref={inputRef}
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { saveLabel(); e.target.blur() } }}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13,
              color: project.color, letterSpacing: '-0.02em',
            }}
            onFocus={e => e.target.style.opacity = '0.8'}
            onBlur={e => { e.target.style.opacity = '1'; saveLabel() }}
          />
          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => onUpdate({ color: c })}
                title={c}
                style={{
                  width: 14, height: 14, borderRadius: '50%', background: c,
                  padding: 0, flexShrink: 0,
                  outline: c === project.color ? `2px solid ${c}` : '2px solid transparent',
                  outlineOffset: 2,
                  transform: c === project.color ? 'scale(1.2)' : 'scale(1)',
                  transition: 'transform 0.1s, outline 0.1s',
                }}
                onMouseEnter={e => { if (c !== project.color) e.target.style.transform = 'scale(1.1)' }}
                onMouseLeave={e => { if (c !== project.color) e.target.style.transform = 'scale(1)' }}
              />
            ))}
          </div>
          <button
            onClick={handleOpen}
            title="Focus or open this project's terminal tab"
            style={{
              fontSize: 9, fontFamily: 'var(--font-mono)',
              border: '1px solid var(--border)', borderRadius: 3,
              padding: '2px 10px', background: 'var(--bg-tertiary)',
              color: openLabel !== 'open' ? 'var(--accent-done)' : 'var(--text-dim)',
              cursor: project.sessions.length ? 'pointer' : 'default',
              opacity: project.sessions.length ? 1 : 0.3,
              transition: 'all 0.15s', flexShrink: 0,
            }}
            disabled={!project.sessions.length}
            onMouseEnter={e => { if (project.sessions.length && openLabel === 'open') e.target.style.color = 'var(--text-secondary)' }}
            onMouseLeave={e => { if (openLabel === 'open') e.target.style.color = 'var(--text-dim)' }}
          >
            {openLabel}
          </button>
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10,
          color: 'var(--text-dim)', wordBreak: 'break-all',
        }}>
          {project.cwd}
        </div>
      </div>

      {/* Session tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        <SessionTree
          sessions={project.sessions}
          showAll={showAll}
          onToggleShowAll={onToggleShowAll}
          onFocus={onFocus}
          onKill={onKill}
        />
      </div>
    </div>
  )
}
