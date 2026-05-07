#!/usr/bin/env node
/**
 * port-forward.js — :80 → :3000 single-process TCP forwarder.
 *
 * Architecture (from start.sh):
 *   - Next.js runs as the user on :3000 (unprivileged, Keychain intact,
 *     CLI bridge works because root can't read the user's Keychain).
 *   - This script runs as root on :80 (privileged port).
 *   - Every inbound connection on :80 gets a paired socket to 127.0.0.1:3000.
 *     Bytes flow both ways via Node's stream pipe.
 *   - No fork-per-connection. No spawn. One Node process, one accept loop,
 *     N pairs of pipes. Fast under the parallel-request load of a Next.js
 *     dev page (HMR + RSC + image fetches all racing).
 *
 * Started by start.sh; killed automatically when start.sh exits via the
 * trap on lines 40 of that script.
 *
 * Why not socat? Pure Node has no install dep, gives us better error
 * logging, and lets us add forwarding logic (HSTS strip, header munging,
 * etc.) if we ever need it. Keep this file tiny — it's load-bearing for
 * the LAN-on-paradiso.local UX.
 */

const net = require('net')

const LISTEN_PORT = 80
const TARGET_HOST = '127.0.0.1'
const TARGET_PORT = 3000

const server = net.createServer((clientSocket) => {
  const targetSocket = net.connect(TARGET_PORT, TARGET_HOST, () => {
    // Paired sockets — pipe both directions. No buffering, no munging,
    // pure passthrough of TCP bytes (which carries the HTTP/1.1 + WS
    // upgrade traffic Next.js dev needs).
    clientSocket.pipe(targetSocket)
    targetSocket.pipe(clientSocket)
  })

  // If Next.js isn't up yet (or restarted), targetSocket errors. Close
  // the client side cleanly so curl/browser sees a connection refused
  // rather than hanging.
  targetSocket.on('error', (err) => {
    if (err.code !== 'ECONNRESET') {
      console.warn(`[port-forward] target ${TARGET_HOST}:${TARGET_PORT} error:`, err.message)
    }
    clientSocket.destroy()
  })

  // If the client disconnects mid-stream, kill the target side too so
  // we don't leak half-open sockets.
  clientSocket.on('error', (err) => {
    if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
      console.warn('[port-forward] client error:', err.message)
    }
    targetSocket.destroy()
  })
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[port-forward] :${LISTEN_PORT} is already in use. Is another instance running?`)
    console.error('  Try: sudo pkill -f "port-forward.js"')
    process.exit(1)
  }
  if (err.code === 'EACCES') {
    console.error(`[port-forward] Permission denied to bind :${LISTEN_PORT}. Run with sudo.`)
    process.exit(1)
  }
  console.error('[port-forward] server error:', err.message)
  process.exit(1)
})

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`[port-forward] listening on :${LISTEN_PORT} → ${TARGET_HOST}:${TARGET_PORT}`)
})

// Graceful shutdown on SIGTERM/SIGINT (start.sh's trap sends SIGTERM).
function shutdown(signal) {
  console.log(`[port-forward] ${signal} received — closing listener`)
  server.close(() => process.exit(0))
  // Hard exit if close hangs on a slow socket
  setTimeout(() => process.exit(0), 1000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
