#!/usr/bin/env node

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const root = path.join(__dirname, '..')
const dist = path.join(root, 'web', 'dist')

// Build frontend if not already built
if (!fs.existsSync(dist)) {
  console.log('Building frontend...')
  execSync('npx vite build web/', { cwd: root, stdio: 'inherit' })
}

// Start the server
require(path.join(root, 'src', 'server.js'))
