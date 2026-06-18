import puppeteer from 'puppeteer'
const browser = await puppeteer.launch({ headless: 'new' })
try {
  const page = await browser.newPage()
  await page.goto('http://localhost:3000/crm?view=scout&theme=polar', { waitUntil: 'networkidle2', timeout: 30000 })
  const steps = await page.evaluate(async () => {
    const r = await fetch('/api/mcp/job-status', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: '__scout__' }),
    })
    const j = await r.json()
    const jobs = j.jobs ?? []
    const running = jobs.find((x) => x.kind === 'scout_taste' && x.status === 'running')
    return {
      jobCount: jobs.length,
      kinds: jobs.map((x) => `${x.kind}:${x.status}`),
      foundRunning: !!running,
      jobId: running?.jobId ?? null,
      targetLen: running?.target ? running.target.split(',').length : 0,
    }
  })
  console.log(JSON.stringify(steps))
} finally { await browser.close() }
