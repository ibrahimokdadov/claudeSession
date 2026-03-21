const fs = require('fs')
const { PALETTE } = require('./colorPalette.js')

function readMeta(metaFile) {
  try {
    return JSON.parse(fs.readFileSync(metaFile, 'utf8'))
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn('[meta] corrupt session-meta.json, resetting:', e.message)
    }
    return { _colorIndex: 0 }
  }
}

function writeMeta(metaFile, meta) {
  const tmp = metaFile + '.tmp.' + process.pid
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2))
  fs.renameSync(tmp, metaFile)
}

function ensureProject(meta, cwd, projectName) {
  if (meta[cwd]) return meta
  const color = PALETTE[meta._colorIndex % PALETTE.length]
  return {
    ...meta,
    _colorIndex: (meta._colorIndex || 0) + 1,
    [cwd]: {
      label: projectName,
      color,
      firstSeen: new Date().toISOString()
    }
  }
}

module.exports = { readMeta, writeMeta, ensureProject }
