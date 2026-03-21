import { useState, useEffect, useCallback, useRef } from 'react'
import Board from './Board.jsx'
import Drawer from './Drawer.jsx'
import './App.css'

const WS_URL = `ws://${location.host}/ws`

export default function App() {
  const [sessions, setSessions] = useState(new Map())
  const [drawerProject, setDrawerProject] = useState(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef(null)
  const retryDelay = useRef(1000)

  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'snapshot') {
        setSessions(new Map(msg.sessions.map(s => [s.project, s])))
      } else if (msg.type === 'session_updated') {
        setSessions(prev => new Map(prev).set(msg.session.project, msg.session))
      } else if (msg.type === 'session_removed') {
        setSessions(prev => {
          const next = new Map(prev)
          next.delete(msg.project)
          return next
        })
        setDrawerProject(p => p === msg.project ? null : p)
      }
    }

    ws.onopen = () => {
      setConnected(true)
      retryDelay.current = 1000
    }

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

  const sessionList = Array.from(sessions.values())
  const drawerSession = drawerProject ? sessions.get(drawerProject) : null

  function handleUpdate(project, patch) {
    fetch(`/api/sessions/${encodeURIComponent(project)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    })
  }

  function handleKill(project) {
    fetch(`/api/sessions/${encodeURIComponent(project)}`, { method: 'DELETE' })
  }

  function handleFocus(project) {
    return fetch(`/api/sessions/${encodeURIComponent(project)}/focus`, { method: 'POST' })
      .then(r => r.json())
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Board
        sessions={sessionList}
        activeProject={drawerProject}
        connected={connected}
        onSelect={p => setDrawerProject(p === drawerProject ? null : p)}
      />
      {drawerSession && (
        <Drawer
          key={drawerSession.project}
          session={drawerSession}
          onClose={() => setDrawerProject(null)}
          onUpdate={(patch) => handleUpdate(drawerSession.project, patch)}
          onKill={() => handleKill(drawerSession.project)}
          onFocus={() => handleFocus(drawerSession.project)}
        />
      )}
    </div>
  )
}
