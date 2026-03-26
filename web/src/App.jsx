// web/src/App.jsx
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Board from './Board.jsx'
import Settings from './Settings.jsx'
import { groupIntoProjects } from './utils.js'
import './App.css'

const WS_URL = `ws://${location.host}/ws`

export default function App() {
  const [sessions, setSessions]         = useState(new Map())
  const [selectedCwd, setSelectedCwd]   = useState(null)
  const [showAll, setShowAll]           = useState(new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [connected, setConnected]       = useState(false)
  const wsRef     = useRef(null)
  const retryDelay = useRef(1000)

  // ── WebSocket ────────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'snapshot') {
        setSessions(new Map(msg.sessions.map(s => [s.fileKey, s])))
      } else if (msg.type === 'session_updated') {
        setSessions(prev => new Map(prev).set(msg.session.fileKey, msg.session))
      } else if (msg.type === 'session_removed') {
        setSessions(prev => {
          const next = new Map(prev)
          next.delete(msg.fileKey)
          return next
        })
      }
    }

    ws.onopen  = () => { setConnected(true);  retryDelay.current = 1000 }
    ws.onclose = () => {
      setConnected(false)
      setTimeout(() => {
        retryDelay.current = Math.min(retryDelay.current * 2, 30000)
        connect()
      }, retryDelay.current)
    }
  }, [])

  useEffect(() => {
    connect()
    return () => wsRef.current?.close()
  }, [connect])

  // ── Project grouping ─────────────────────────────────────────────────────────
  const projects = useMemo(() => groupIntoProjects(sessions), [sessions])

  // Auto-select: pick most-recently-active project
  useEffect(() => {
    if (projects.size === 0) { setSelectedCwd(null); return }
    // If current selection still exists, keep it
    if (selectedCwd && projects.has(selectedCwd)) return
    // Otherwise pick the project with the highest lastTimestamp
    const best = Array.from(projects.values())
      .sort((a, b) => b.lastTimestamp - a.lastTimestamp)[0]
    setSelectedCwd(best.cwd)
  }, [projects]) // intentionally omit selectedCwd to avoid loops

  // ── API calls ────────────────────────────────────────────────────────────────
  function handleUpdate(fileKey, patch) {
    fetch(`/api/sessions/${encodeURIComponent(fileKey)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  }

  function handleKill(fileKey) {
    fetch(`/api/sessions/${encodeURIComponent(fileKey)}`, { method: 'DELETE' })
  }

  function handleFocus(fileKey) {
    return fetch(`/api/sessions/${encodeURIComponent(fileKey)}/focus`, { method: 'POST' })
      .then(r => r.json())
  }

  function handleToggleShowAll(cwd) {
    setShowAll(prev => {
      const next = new Set(prev)
      if (next.has(cwd)) next.delete(cwd)
      else next.add(cwd)
      return next
    })
  }

  const selectedProject = selectedCwd ? projects.get(selectedCwd) : null

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Board
        projects={projects}
        selectedCwd={selectedCwd}
        showAll={showAll}
        connected={connected}
        onSelect={setSelectedCwd}
        onSettings={() => setSettingsOpen(true)}
        onToggleShowAll={handleToggleShowAll}
        onUpdate={handleUpdate}
        onFocus={handleFocus}
        onKill={handleKill}
        selectedProject={selectedProject}
      />
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
