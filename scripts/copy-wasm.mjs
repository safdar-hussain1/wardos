#!/usr/bin/env node
import { copyFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const source = 'node_modules/sql.js/dist/sql-wasm.wasm'
const dest = 'public/sql-wasm.wasm'

mkdirSync(dirname(dest), { recursive: true })
copyFileSync(source, dest)
console.log(`Copied ${source} to ${dest}`)
