const fs = require('fs')
const os = require('os')
const path = require('path')
const { readMeta, writeMeta, ensureProject } = require('../src/meta.js')

let tmpDir, metaFile

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-test-'))
  metaFile = path.join(tmpDir, 'session-meta.json')
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('readMeta', () => {
  it('returns default when file missing', () => {
    const m = readMeta(metaFile)
    expect(m).toEqual({ _colorIndex: 0 })
  })

  it('returns parsed content when file exists', () => {
    fs.writeFileSync(metaFile, JSON.stringify({ _colorIndex: 2, '/some/path': { label: 'test', color: '#aaa', firstSeen: '2026-01-01T00:00:00.000Z' } }))
    const m = readMeta(metaFile)
    expect(m._colorIndex).toBe(2)
    expect(m['/some/path'].label).toBe('test')
  })

  it('resets to default on corrupt file', () => {
    fs.writeFileSync(metaFile, 'NOT JSON {{{')
    const m = readMeta(metaFile)
    expect(m).toEqual({ _colorIndex: 0 })
  })
})

describe('writeMeta', () => {
  it('writes atomically (tmp file is gone after write)', () => {
    const meta = { _colorIndex: 1 }
    writeMeta(metaFile, meta)
    const files = fs.readdirSync(tmpDir)
    expect(files.some(f => f.includes('.tmp.'))).toBe(false)
    expect(files).toContain('session-meta.json')
  })

  it('written content is readable', () => {
    const meta = { _colorIndex: 5, '/foo': { label: 'foo', color: '#111', firstSeen: '2026-01-01T00:00:00.000Z' } }
    writeMeta(metaFile, meta)
    const read = readMeta(metaFile)
    expect(read).toEqual(meta)
  })
})

describe('ensureProject', () => {
  it('assigns first palette color to new project', () => {
    const meta = readMeta(metaFile)
    const updated = ensureProject(meta, '/new/project', 'project')
    expect(updated['/new/project'].color).toBe('#58a6ff')
    expect(updated['/new/project'].label).toBe('project')
    expect(updated['/new/project'].firstSeen).toBeTruthy()
    expect(updated._colorIndex).toBe(1)
  })

  it('does not overwrite existing project entry', () => {
    const meta = { _colorIndex: 1, '/existing': { label: 'custom', color: '#ff0000', firstSeen: '2026-01-01T00:00:00.000Z' } }
    const updated = ensureProject(meta, '/existing', 'existing')
    expect(updated['/existing'].color).toBe('#ff0000')
    expect(updated['/existing'].label).toBe('custom')
    expect(updated._colorIndex).toBe(1)
  })

  it('wraps color index after 10', () => {
    let meta = { _colorIndex: 9 }
    meta = ensureProject(meta, '/p9', 'p9')
    expect(meta['/p9'].color).toBe('#ff7b72') // palette[9]
    meta = ensureProject(meta, '/p10', 'p10')
    expect(meta['/p10'].color).toBe('#58a6ff') // palette[0] (wrap)
  })
})
