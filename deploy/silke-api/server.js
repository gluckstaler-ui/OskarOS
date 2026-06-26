// Dedicated contact-form backend for silke-lengler.ch — a single tiny Node process
// mounted at silke-lengler.ch/api via cPanel "Setup Node.js App" (Passenger).
// No build step, no framework. Sends to Praxis@Silke-Lengler.ch.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');
const nodemailer = require('nodemailer');

// --- config from .silke-mail.env in the app root (NOT under the web docroot) ---
function loadCfg() {
  const cfg = {};
  try {
    const txt = fs.readFileSync(path.join(__dirname, '.silke-mail.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) cfg[m[1]] = m[2];
    }
  } catch (e) { /* fall back to process env */ }
  for (const k of Object.keys(process.env)) if (cfg[k] === undefined) cfg[k] = process.env[k];
  return cfg;
}
const CFG = loadCfg();
const TO = CFG.MAIL_TO || 'Praxis@Silke-Lengler.ch';

let tx = null;
async function transport() {
  if (tx) return tx;
  const ports = (CFG.SMTP_PORTS || '465:true,587:false,26:false').split(',').map(s => {
    const [p, sec] = s.split(':'); return { port: Number(p), secure: sec === 'true' };
  });
  let last;
  for (const { port, secure } of ports) {
    for (const strict of [true, false]) { // cPanel presents a hostname-mismatched cert; retry unpinned
      const t = nodemailer.createTransport({
        host: CFG.SMTP_HOST, port, secure,
        auth: { user: CFG.SMTP_USER, pass: CFG.SMTP_PASS },
        requireTLS: !secure, tls: { rejectUnauthorized: strict, servername: CFG.SMTP_HOST },
        connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 20000,
      });
      try { await t.verify(); tx = t; return t; } catch (e) { last = e; }
    }
  }
  throw last || new Error('No SMTP submission port reachable');
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers, limits: { fields: 25, files: 0, fieldSize: 65536 } });
    const out = {};
    bb.on('field', (n, v) => { out[n] = v; });
    bb.on('close', () => resolve(out));
    bb.on('error', reject);
    req.pipe(bb);
  });
}
async function readBody(req) {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) return parseMultipart(req);
  const raw = await new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(s)); });
  if (ct.includes('application/json')) { try { return JSON.parse(raw || '{}'); } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(raw));
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };

const server = http.createServer(async (req, res) => {
  const json = (code, obj) => { res.writeHead(code, Object.assign({ 'content-type': 'application/json; charset=utf-8' }, CORS)); res.end(JSON.stringify(obj)); };
  const p = (req.url || '').split('?')[0];
  const isContact = /(^|\/)contact\/?$/.test(p); // matches with or without the /api base-uri prefix

  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method === 'GET' && isContact) return json(200, { ok: true, info: 'silke-lengler contact endpoint — POST to send' });

  if (req.method === 'POST' && isContact) {
    let f;
    try { f = await readBody(req); } catch { return json(400, { ok: false, error: 'Bad request.' }); }
    if (f.company) return json(200, { ok: true }); // honeypot
    const name = (f.name || '').replace(/[\r\n]+/g, ' ').trim();
    const email = (f.email || '').replace(/[\r\n\s]+/g, '');
    const phone = (f.telefon || f.phone || '').replace(/[\r\n]+/g, ' ').trim();
    const message = (f.nachricht || f.message || '').trim();
    if (!name || !email || !message) return json(400, { ok: false, error: 'Bitte Name, E-Mail und Nachricht ausfüllen.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { ok: false, error: 'Diese E-Mail-Adresse sieht ungültig aus.' });
    try {
      const t = await transport();
      const info = await t.sendMail({
        from: `Website Silke Lengler <${CFG.MAIL_FROM || CFG.SMTP_USER}>`,
        to: TO, bcc: CFG.MAIL_ARCHIVE_BCC || undefined,
        replyTo: `${name} <${email}>`,
        subject: `Anfrage über die Website — ${name}`,
        text: 'Neue Nachricht über das Kontaktformular silke-lengler.ch\n' +
          '----------------------------------------\n' +
          `Name:     ${name}\nE-Mail:   ${email}\n` + (phone ? `Telefon:  ${phone}\n` : '') +
          '----------------------------------------\n\n' + message + '\n',
      });
      console.log('[silke-api] sent', info.messageId, '->', TO, 'accepted', JSON.stringify(info.accepted));
      return json(200, { ok: true });
    } catch (e) {
      console.error('[silke-api] send failed:', (e && e.message) || e);
      return json(500, { ok: false, error: 'Die Nachricht konnte gerade nicht gesendet werden.' });
    }
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log('silke-api listening on ' + port));
