/**
 * PTY host: runs under a plain Node.js child process when node-pty cannot be
 * loaded inside Electron's process (ABI mismatch, e.g. unbuilt dev setups).
 * Speaks JSON-lines over stdio. argv[2] is the path to the node-pty module.
 */
const readline = require('node:readline')

const pty = require(process.argv[2])
const sessions = new Map()

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  const { op, id } = msg
  if (op === 'create') {
    if (sessions.has(id)) return
    const shell = msg.shell || process.env.SHELL || 'bash'
    const proc = pty.spawn(shell, Array.isArray(msg.args) ? msg.args : [], {
      name: 'xterm-256color',
      cols: msg.cols || 80,
      rows: msg.rows || 24,
      cwd: msg.cwd || process.env.HOME,
      env: process.env
    })
    sessions.set(id, proc)
    proc.onData((data) => send({ ev: 'data', id, data }))
    proc.onExit(({ exitCode }) => {
      sessions.delete(id)
      send({ ev: 'exit', id, code: exitCode })
    })
  } else if (op === 'input') {
    sessions.get(id)?.write(msg.data)
  } else if (op === 'resize') {
    try {
      sessions.get(id)?.resize(msg.cols, msg.rows)
    } catch {
      // resize on a dying pty throws; ignore
    }
  } else if (op === 'dispose') {
    sessions.get(id)?.kill()
    sessions.delete(id)
  }
})

process.on('SIGTERM', () => {
  for (const proc of sessions.values()) proc.kill()
  process.exit(0)
})
