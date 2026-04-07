#!/usr/bin/env node

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const root = path.join(__dirname, '..')
const dist = path.join(root, 'web', 'dist')

// Install deps + build frontend if not already built
if (!fs.existsSync(dist)) {
  console.log('Installing dependencies...')
  execSync('npm install --production=false', { cwd: root, stdio: 'inherit' })
  console.log('Building frontend...')
  const vite = require.resolve('vite/bin/vite.js', { paths: [root] })
  execSync(`node "${vite}" build web/`, { cwd: root, stdio: 'inherit' })
}

// Start the server
require(path.join(root, 'src', 'server.js'))
