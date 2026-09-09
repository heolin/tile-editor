#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', short: 'p', default: '4173' },
    host: { type: 'string', default: '127.0.0.1' },
    lan: { type: 'boolean', default: false },
    open: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

if (values.help) {
  console.log(`
  tile-editor [folder]

    -p, --port <n>   port to listen on (default 4173)
        --host <ip>  interface to bind (default 127.0.0.1)
        --lan        bind 0.0.0.0 so other devices on the network can connect
    -h, --help       show this message

  Serves the editor for a Tiled project folder. Designed to run inside Termux:
  start it, then open the printed address in the phone's browser.
`)
  process.exit(0)
}

const root = resolve(positionals[0] ?? '.')
if (!existsSync(root)) {
  console.error(`Folder nie istnieje: ${root}`)
  process.exit(1)
}

const uiDir = resolve(repoRoot, 'packages/ui/dist')
const { startServer } = await import('@tile-editor/server')

const server = await startServer({
  root,
  port: Number(values.port),
  host: values.lan ? '0.0.0.0' : values.host,
  uiDir: existsSync(uiDir) ? uiDir : undefined,
})

console.log(`\n  tile-editor\n`)
console.log(`  projekt:  ${root}`)
console.log(`  adres:    ${server.url}`)
if (!existsSync(uiDir)) {
  console.log(`\n  UI nie jest zbudowane — uruchom "npm run build" albo "npm run dev -w @tile-editor/ui".`)
}
console.log(`\n  Ctrl+C kończy.\n`)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0))
  })
}
