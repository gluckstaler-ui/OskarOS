// ============================================================================
// scripts/imap-starttls-harness.ts — load-shaped verification for the
// STARTTLS-first IMAP adapter (lib/imap-client.ts).
//
// The 2026-08-11 adapter was "verified" with ONE happy-path connection and
// then leaked unhandledRejections into production when sockets died during
// the upgrade window (NoConnection flood next to the Consular bridge).
// This harness asserts the two things that single test never could:
//
//   1. BURST  — 8 parallel real connections to the configured IMAP host.
//   2. CHAOS  — a local TCP proxy to the real host that destroys the socket
//               at hostile moments (right after the greeting, right after
//               the STARTTLS OK), forcing the death-during-upgrade window.
//
// PASS = every connect() settles (resolve or clean reject) AND the process
// records ZERO unhandledRejections. Run: npx tsx scripts/imap-starttls-harness.ts
// ============================================================================
import net from 'node:net'
import { readFileSync } from 'node:fs'
import { makeImapClient } from '../lib/imap-client'

// --- env from .env.local (no dotenv dep in scripts) ---
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf-8').split('\n')) {
  const m = line.match(/^(OSKAR_MAIL_[A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}
const HOST = process.env.OSKAR_MAIL_IMAP_HOST!
const USER = process.env.OSKAR_MAIL_USER!
const PASS = process.env.OSKAR_MAIL_PASS!

let unhandled = 0
process.on('unhandledRejection', (err) => {
  unhandled++
  console.error(`  !! unhandledRejection #${unhandled}:`, (err as Error)?.message)
})

function client(port: number, host = HOST) {
  return makeImapClient({
    host, port,
    // the adapter derives STARTTLS from port 143; chaos proxies listen on a
    // random port, so force the path explicitly for any non-real-host client
    starttls: true,
    auth: { user: USER, pass: PASS },
    logger: false,
    connectionTimeout: 15_000,
  })
}

async function settle(label: string, c: ReturnType<typeof client>) {
  try {
    await c.connect()
    await c.logout().catch(() => c.close())
    return `${label}: OK`
  } catch (err) {
    return `${label}: clean-reject (${(err as Error).message})`
  }
}

// Proxy that forwards HOST:143 but destroys both sockets after the upstream
// has sent `killAfterLines` full lines (greeting = 1, STARTTLS OK = 2), or
// after `killAfterMs` if given (post-connect death). Clients must pass
// starttls:true — the proxy sits on a random port and the adapter would
// otherwise pick the wrong path from it.
function chaosProxy(opts: { killAfterLines?: number; killAfterMs?: number }): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer((down) => {
      const up = net.connect(143, HOST)
      let lines = 0
      const drop = () => { up.destroy(); down.destroy() }
      if (opts.killAfterMs) setTimeout(drop, opts.killAfterMs)
      up.on('data', (buf) => {
        down.write(buf)
        if (opts.killAfterLines) {
          lines += buf.toString('latin1').split('\r\n').length - 1
          if (lines >= opts.killAfterLines) drop()
        }
      })
      down.on('data', (buf) => up.write(buf))
      up.on('error', drop); down.on('error', drop)
      up.on('close', () => down.destroy()); down.on('close', () => up.destroy())
    })
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      resolve({ port, close: () => srv.close() })
    })
  })
}

async function main() {
  const results: string[] = []

  // 1 — BURST: parallel real connections
  console.log('— burst: 8 parallel connections to', `${HOST}:143`)
  results.push(...await Promise.all(Array.from({ length: 8 }, (_, i) => settle(`burst-${i}`, client(143)))))

  // 2 — CHAOS: socket dies right after the greeting (before client sends STARTTLS)
  console.log('— chaos: kill after greeting × 4')
  for (let i = 0; i < 4; i++) {
    const p = await chaosProxy({ killAfterLines: 1 })
    results.push(await settle(`kill-after-greeting-${i}`, client(p.port, '127.0.0.1')))
    p.close()
  }

  // 3 — CHAOS: socket dies right after the STARTTLS OK (mid TLS handshake)
  console.log('— chaos: kill after STARTTLS OK × 4')
  for (let i = 0; i < 4; i++) {
    const p = await chaosProxy({ killAfterLines: 2 })
    results.push(await settle(`kill-after-starttls-ok-${i}`, client(p.port, '127.0.0.1')))
    p.close()
  }

  // 4 — CHAOS: connect succeeds, socket dies later while the client is held
  //     open with NO explicit error listener (mail-eyes' exact usage). This is
  //     the prime suspect for the production unhandledRejection flood.
  console.log('— chaos: post-connect death while idle × 2')
  for (let i = 0; i < 2; i++) {
    const p = await chaosProxy({ killAfterMs: 4000 })
    const c = client(p.port, '127.0.0.1')
    try {
      await c.connect()
      await new Promise((r) => setTimeout(r, 7000)) // outlive the kill
      results.push(`post-connect-death-${i}: still-usable=${c.usable}`)
    } catch (err) {
      results.push(`post-connect-death-${i}: clean-reject (${(err as Error).message})`)
    } finally {
      await c.logout().catch(() => c.close())
      p.close()
    }
  }

  // let stragglers reject
  await new Promise((r) => setTimeout(r, 3000))

  console.log('\n' + results.join('\n'))
  console.log(`\nunhandledRejections: ${unhandled}`)
  if (unhandled > 0 || results.some((r) => r.includes('undefined'))) {
    console.log('VERDICT: FAIL')
    process.exit(1)
  }
  console.log('VERDICT: PASS')
}

main().catch((err) => { console.error('harness crashed:', err); process.exit(2) })
