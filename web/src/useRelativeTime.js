import { useState, useEffect } from 'react'

export function formatDuration(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`
}

export function useRelativeTime(timestamp) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    const update = () => {
      if (!timestamp) { setLabel(''); return }
      setLabel(formatDuration(Date.now() - new Date(timestamp).getTime()) + ' ago')
    }
    update()
    const id = setInterval(update, 10000)
    return () => clearInterval(id)
  }, [timestamp])
  return label
}
