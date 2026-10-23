#!/usr/bin/env node
// Collects the machine facts for the takeover runbook. Read-only, no sudo, never prints secret values.
// Writes /DRIVE/Runbook/facts/<date>.json and /DRIVE/Runbook/FACTS.md (German).
// Run: node /Oskar/ops/runbook-facts.mjs   (weekly via launchd, see ops/ch.oskar.runbook.plist later)
import { execSync } from 'node:child_process'
import net from 'node:net'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = '/DRIVE/Runbook'
const FACTS_DIR = join(OUT, 'facts')
mkdirSync(FACTS_DIR, { recursive: true })
const PATH = '/opt/homebrew/bin:/Users/macminim5/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
const sh = (cmd, { timeout = 15000 } = {}) => {
  try { return execSync(cmd, { encoding: 'utf8', timeout, env: { ...process.env, PATH, LANG: 'de_CH.UTF-8' }, stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return '' }
}
const SECRET = /(sk-ant-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|password=|passwort=|[A-Za-z0-9+/]{40,}={0,2})/i
const safe = s => (s || '').split('\n').filter(l => !SECRET.test(l)).join('\n')
const now = new Date()
const stamp = now.toISOString().slice(0, 10)
const F = { generated: now.toISOString(), host: sh('hostname') }

/* ── macOS ───────────────────────────────────────────────── */
F.macos = {
  version: sh('sw_vers -productVersion'), build: sh('sw_vers -buildVersion'), kernel: sh('uname -r'),
  model: sh("system_profiler SPHardwareDataType 2>/dev/null | awk -F': ' '/Model Name|Model Identifier|Chip|Memory|Serial Number/{print $1\": \"$2}' | sed 's/^ *//'"),
  uptime: sh('uptime'), boot: sh('sysctl -n kern.boottime | sed -E "s/.*\\} //"'), tz: sh('readlink /etc/localtime | sed "s|.*zoneinfo/||"'), date: sh('date'),
  pmset: sh('pmset -g custom'), lastSleep: sh("pmset -g log | grep -E '^[0-9-]+ [0-9:]+ [+0-9]+ (Sleep|Wake|DarkWake) {2,}' | tail -4 | cut -c1-140"),
  sleepCount24h: sh("pmset -g log | grep -E '^" + new Date(Date.now() - 864e5).toISOString().slice(0, 10) + "|^" + stamp + "' | grep -c 'Entering Sleep'"),
  filevault: sh('fdesetup status'), firewall: sh('/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate'),
  softwareUpdate: sh('softwareupdate -l 2>&1 | tail -n +2 | head -8', { timeout: 60000 }) || '(keine Ausgabe)',
  users: sh("dscl . -list /Users UniqueID | awk '$2>=500 && $2<1000{print $1\" (uid \"$2\")\"}'"),
  admins: sh('dscl . -read /Groups/admin GroupMembership | sed "s/GroupMembership: //"'),
  loginItems: sh(`osascript -e 'tell application "System Events" to get the name of every login item'`, { timeout: 8000 }) || '(nicht lesbar ohne Automation-Freigabe)',
  spotlightExclusions: sh('defaults read /.Spotlight-V100/VolumeConfiguration.plist Exclusions 2>/dev/null') || '(nicht lesbar ohne sudo)',
  disks: sh('df -h / /System/Volumes/Data | awk "NR==1||/disk/"'), volumes: '(externe Platten werden im Runbook nicht gezeigt)',
  memory: sh("sysctl -n hw.memsize | awk '{printf \"%.0f GB\", $1/1073741824}'"),
}
/* ── Netzwerk ─────────────────────────────────────────────── */
F.network = {
  interfaces: sh("ifconfig | awk '/^[a-z]/{i=$1} /inet /{print i, $2}'"),
  gateway: sh('route -n get default 2>/dev/null | awk "/gateway/{print \\$2}"'),
  dns: sh("scutil --dns | awk '/nameserver\\[0\\]/{print $3}' | sort -u | tr '\\n' ' '"),
  wifi: sh('networksetup -getairportnetwork en1 2>/dev/null || networksetup -getairportnetwork en0 2>/dev/null'),
  mdns: sh('scutil --get LocalHostName') + '.local',
  mdnsNote: '',
}
const PORTS = { 22: 'SSH (Entfernte Anmeldung)', 80: 'FileMaker Apache (HTTP)', 443: 'FileMaker Apache (HTTPS, Admin Console, Data API)', 88: 'Kerberos (macOS)', 445: 'SMB-Dateifreigabe', 3000: 'OskarOS (Next.js)', 3031: 'macOS Content Caching / ARD?', 3283: 'Apple Remote Desktop', 5000: 'macOS AirPlay-Receiver', 5003: 'FileMaker Server (Datenbank, fmnet)', 5013: 'FileMaker (Web Publishing)', 5900: 'Bildschirmfreigabe (VNC)', 7000: 'macOS AirPlay', 16000: 'FileMaker Admin Console', 16001: 'FileMaker Admin Console (HTTP)', 16002: 'FileMaker Admin Server', 1895: 'FileMaker WPE (lokal)', 50003: 'FileMaker (lokal)', 50004: 'FileMaker (lokal)' }
const probe = port => new Promise(res => { const so = net.connect({ host: '127.0.0.1', port, timeout: 700 }); so.on('connect', () => { so.destroy(); res(true) }); so.on('error', () => res(false)); so.on('timeout', () => { so.destroy(); res(false) }) })
const PROBE_PORTS = [...Object.keys(PORTS).map(Number), 2399, 8443, 8080, 3001]
const open = []
for (const p of PROBE_PORTS) if (await probe(p)) open.push(p)
F.network.listeners = open.join(' ')
F.network.portTable = open.map(p => [p, PORTS[p] || 'UNBEKANNT — prüfen'])
F.network.sharing = { ssh: open.includes(22) ? 'Port 22 offen' : 'Port 22 zu', screenSharing: open.includes(5900) ? 'Port 5900 offen' : 'Port 5900 zu' }

/* ── launchd ──────────────────────────────────────────────── */
const uid = sh('id -u')
const daemons = sh('ls /Library/LaunchDaemons').split('\n').filter(l => /oskar|drive|filemaker|rclone/i.test(l))
const agents = sh('ls ~/Library/LaunchAgents').split('\n').filter(l => /oskar|drive|rclone/i.test(l))
const printJob = (domain, label) => { const o = sh(`launchctl print ${domain}/${label} 2>/dev/null | grep -E "^\\s+(state|pid|program|run interval|last exit code) " | sed "s/^\\s*//"`); return o || '(nicht lesbar)' }
F.launchd = {
  systemDaemons: daemons.map(f => ({ file: f, label: f.replace('.plist', ''), status: printJob('system', f.replace('.plist', '')) })),
  userAgents: agents.map(f => ({ file: f, label: f.replace('.plist', ''), status: printJob(`gui/${uid}`, f.replace('.plist', '')) })),
  // 2026-10-22: Oskar (oskar.sh) and the FileMaker backup (fm-backup.sh) run from this user's crontab.
  crontab: sh('crontab -l') || '(leer)',
  processes: sh("ps -axo user,pid,etime,command | grep -E 'fmserver_helperd|fmserverd|oskar.sh|node server.js|npm run dev|rclone|Google Drive' | grep -v grep | cut -c1-140"),
}

/* ── FileMaker Server ─────────────────────────────────────── */
const FMS = '/Library/FileMaker Server'
const fmsadmin = `"${FMS}/Database Server/bin/fmsadmin"`
const dbDir = join(FMS, 'Data/Databases')
const listFiles = (dir, filter = () => true) => existsSync(dir) ? readdirSync(dir).filter(f => !f.startsWith('.') && filter(f)).map(f => { const st = statSync(join(dir, f)); return { name: f, size: st.isDirectory() ? '' : (st.size / 1048576).toFixed(1) + ' MB', mtime: st.mtime.toISOString().slice(0, 16).replace('T', ' ') } }) : []
F.filemaker = {
  installed: existsSync(FMS), version: sh(`${fmsadmin} -v | head -1`),
  files: listFiles(dbDir, f => f.endsWith('.fmp12')),
  backups: listFiles(join(FMS, 'Data/Backups')),
  driveBackups: listFiles('/DRIVE/Backups', (f) => statSync(join('/DRIVE/Backups', f)).isDirectory()),
  schedules: '(braucht Admin-Login: fmsadmin list schedules -u … — siehe Runbook E10.2, noch nicht eingerichtet)',
  dataApi: sh('curl -sk --max-time 5 -o /dev/null -w "%{http_code}" https://localhost/fmi/data/vLatest/productInfo') === '200' ? 'aktiv' : 'nicht aktiv (HTTP ' + sh('curl -sk --max-time 5 -o /dev/null -w "%{http_code}" https://localhost/fmi/data/vLatest/productInfo') + ')',
  adminConsole: sh('curl -sk --max-time 5 -o /dev/null -w "%{http_code}" https://localhost:443/admin-console/') === '200' ? 'erreichbar (https://<ip>/admin-console, Port 16000)' : 'nicht erreichbar',
  eventLogErrors: safe(sh(`grep -E "\\t(Fehler|Error|Warnung|Warning)\\t" "${FMS}/Logs/Event.log" 2>/dev/null | tail -10 | cut -c1-160`)) || '(keine oder nicht lesbar)',
  eventLogLast: safe(sh(`tail -3 "${FMS}/Logs/Event.log" 2>/dev/null | cut -c1-160`)),
  scriptsDir: listFiles(join(FMS, 'Data/Scripts')).map(f => f.name).join(', ') || '(leer)',
}

/* ── OskarOS ──────────────────────────────────────────────── */
const O = '/Oskar'
const envKeys = existsSync(join(O, '.env.local')) ? readFileSync(join(O, '.env.local'), 'utf8').split('\n').filter(l => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l)).map(l => l.split('=')[0]) : []
const ver = existsSync(join(O, 'db/version.json')) ? JSON.parse(readFileSync(join(O, 'db/version.json'), 'utf8')) : {}
const curl = (p, t = 8) => sh(`curl -s --max-time ${t} http://localhost:3000${p}`, { timeout: (t + 2) * 1000 })
let wa = {}; try { wa = JSON.parse(curl('/api/admin/whatsapp/status')) } catch { }
let mail = {}; try { mail = JSON.parse(curl('/api/admin/settings/mail')) } catch { }
let mailStatus = {}; try { mailStatus = JSON.parse(curl('/api/admin/mail/status')) } catch { }
F.oskar = {
  path: O, owner: sh(`stat -f '%Su:%Sg' ${O}/.`), version: ver.version || ver.release || JSON.stringify(ver).slice(0, 80), git: sh(`git -C ${O} log -1 --format='%h %ad %s' --date=short`), dirty: sh(`git -C ${O} status --short | wc -l | tr -d ' '`) + ' uncommitted Änderungen',
  node: sh('node -v'), npm: sh('npm -v'), claude: sh('claude --version 2>/dev/null | head -1'),
  nodeId: envKeys.includes('OSKAR_NODE_ID') ? sh(`grep '^OSKAR_NODE_ID=' ${O}/.env.local | cut -d= -f2`) : '(nicht gesetzt)',
  envKeys: envKeys.join(', '),
  http: sh('curl -s -o /dev/null --max-time 8 -w "%{http_code}" http://localhost:3000/crm') || 'keine Antwort',
  whatsapp: wa.status ? `${wa.status}${wa.phone ? ' · ' + String(wa.phone).replace(/(\d{4})\d+(\d{2})/, '$1…$2') : ''}${wa.linkedSince ? ' · verknüpft ' + wa.linkedSince.slice(0, 10) : ''}` : '(Status nicht abrufbar)',
  mail: mail.user ? `${String(mail.user).replace(/(.{2}).*(@.*)/, '$1…$2')} · IMAP ${mail.imap_host || mail.imapHost || '?'}:${mail.imap_port || mail.imapPort || '?'} · SMTP ${mail.smtp_host || mail.smtpHost || '?'}:${mail.smtp_port || mail.smtpPort || '?'}` : '(Mail-Config nicht abrufbar)',
  mailLastSweep: mailStatus.last_sweep_at || '(unbekannt)',
  logs: ['/Users/macminim5/oskar-ops/logs/server.log (Interim, bis Sprint 1)', '/Oskar/logs/ (Legacy)'].join('; '),
  eventLogs: sh(`wc -l ${O}/db/events/*.jsonl | sed 's|/Oskar/db/events/||'`),
  dbSize: sh(`du -sh ${O}/db ${O}/media ${O}/public 2>/dev/null | awk '{print $2": "$1}' | tr '\\n' ' '`),
}

/* ── rclone / Drive / Google ──────────────────────────────── */
F.sync = {
  rclone: sh('rclone version 2>/dev/null | head -1') || 'nicht installiert',
  rcloneRemotes: sh('rclone listremotes 2>/dev/null') || '(keine)',
  driveAccount: (sh('ls ~/Library/CloudStorage 2>/dev/null').match(/GoogleDrive-(.*)/) || [])[1]?.replace(/(.{3}).*(@)/, '$1…$2') || '(Drive for Desktop nicht angemeldet)',
  driveProcess: sh("pgrep -fl 'Google Drive' | head -1") ? 'läuft' : 'läuft nicht',
  driveTree: sh('ls -la /DRIVE 2>/dev/null | tail -n +2 | awk \'{print $NF}\' | grep -v "^\\.$\\|^\\.\\.$" | tr "\\n" " "'),
  driveMirrorLeftovers: ['Documents', 'Music', '.tmp.drivedownload'].filter(d => existsSync('/DRIVE/' + d)).join(', ') || 'keine',
  agy: sh('/Applications/Gemini.app/Contents/Helpers/agy --version 2>/dev/null') ? 'Antigravity CLI ' + sh('/Applications/Gemini.app/Contents/Helpers/agy --version 2>/dev/null') + ' (in Gemini.app)' : 'nicht vorhanden',
  gcloud: sh('ls ~/.config/gcloud 2>/dev/null') ? 'gcloud-Config vorhanden' : 'kein gcloud',
}

/* ── Domains & Zertifikate ─────────────────────────────── */
const certOf = hostport => sh(`echo | openssl s_client -connect ${hostport} -servername ${hostport.split(':')[0]} 2>/dev/null | openssl x509 -noout -subject -issuer -enddate 2>/dev/null | sed -E 's/^(subject|issuer)=.*CN ?= ?([^,/]+).*/\\1: \\2/'`) || '(kein Zertifikat / nicht erreichbar)'
F.dns = {
  publicIp: sh('curl -s --max-time 8 https://api.ipify.org'),
  publicRdns: sh('dig +short -x $(curl -s --max-time 8 https://api.ipify.org) 2>/dev/null'),
  zones: Object.fromEntries(['praxis-oppliger.ch', 'praxis-bernoulli.ch'].map(d => [d, { ns: sh(`dig +short NS ${d} | sort | tr '\\n' ' '`), a: sh(`dig +short A ${d} | tr '\\n' ' '`), www: sh(`dig +short A www.${d} | tr '\\n' ' '`), mx: sh(`dig +short MX ${d} | tr '\\n' ' '`), fm: sh(`dig +short fm.${d} | tr '\\n' ' '`) || '(nicht gesetzt)', mini: sh(`dig +short mini.${d} | tr '\\n' ' '`) || '(nicht gesetzt)' }])),
  certFileMaker: certOf('localhost:443'),
  certWebsite: certOf('praxis-oppliger.ch:443'),
}

/* ── write JSON + FACTS.md ────────────────────────────────── */
writeFileSync(join(FACTS_DIR, `${stamp}.json`), JSON.stringify(F, null, 2))
const prev = readdirSync(FACTS_DIR).filter(f => f.endsWith('.json') && f < `${stamp}.json`).sort().pop()
let diff = ''
if (prev) {
  const P = JSON.parse(readFileSync(join(FACTS_DIR, prev), 'utf8'))
  const flat = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => typeof v === 'object' && v && !Array.isArray(v) ? flat(v, pre + k + '.') : [[pre + k, JSON.stringify(v)]])
  const a = Object.fromEntries(flat(P)), b = Object.fromEntries(flat(F))
  const skip = /generated|uptime|date|lastSleep|sleepCount|processes|eventLogLast|mailLastSweep|dirty|mtime/
  diff = Object.keys(b).filter(k => !skip.test(k) && a[k] !== b[k]).map(k => `- \`${k}\`: ${a[k] ?? '—'} → ${b[k]}`).join('\n')
}
const t = (rows, head) => `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n` + rows.map(r => `| ${r.map(c => String(c ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>')).join(' | ')} |`).join('\n')
const kv = o => t(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]), ['Einstellung', 'Wert'])
const md = `# Fakten (automatisch erzeugt)

Erzeugt ${F.generated} auf ${F.host} durch \`/Oskar/ops/runbook-facts.mjs\`. Nichts hier ist von Hand geschrieben; bei Zweifel gilt die Maschine. Keine Passwörter, keine Token.

## 5. Systemeinstellungen

### macOS
${kv({ Version: `${F.macos.version} (${F.macos.build}), Kernel ${F.macos.kernel}`, Hardware: F.macos.model, Speicher: F.macos.memory, Boot: F.macos.boot, Uptime: F.macos.uptime, Zeitzone: F.macos.tz, FileVault: F.macos.filevault, Firewall: F.macos.firewall, 'Benutzer (uid ≥ 500)': F.macos.users, 'Admin-Gruppe': F.macos.admins, 'Login-Items (macminim5)': F.macos.loginItems, 'Spotlight-Ausschlüsse': F.macos.spotlightExclusions, 'Software-Updates': F.macos.softwareUpdate })}

### Energie (pmset)
\`\`\`
${F.macos.pmset}
\`\`\`
Letzte Schlaf-/Wach-Ereignisse (${F.macos.sleepCount24h || 0} Schlafphasen in den letzten 24 h):
\`\`\`
${F.macos.lastSleep || '(keine)'}
\`\`\`

### Laufwerke
\`\`\`
${F.macos.disks}
\`\`\`
${F.macos.volumes}

### Netzwerk
${kv({ Interfaces: F.network.interfaces, Gateway: F.network.gateway, DNS: F.network.dns, WLAN: F.network.wifi, 'mDNS-Name': F.network.mdns, SSH: F.network.sharing.ssh, Bildschirmfreigabe: F.network.sharing.screenSharing })}

### Offene Ports
${t(F.network.portTable, ['Port', 'Dienst'])}

(Geprüft per Verbindungstest auf 127.0.0.1; Ports ausserhalb der bekannten Liste werden nicht erkannt.)

## 6. Komponenten

### launchd-Daemons (System, /Library/LaunchDaemons)
${F.launchd.systemDaemons.length ? t(F.launchd.systemDaemons.map(d => [d.label, d.status]), ['Label', 'Status']) : '(keine Oskar/Drive/FileMaker-Daemons gefunden)'}

### launchd-Agents (Benutzer macminim5, ~/Library/LaunchAgents) — keine erwartet (Oskar läuft seit 2026-10-22 über cron)
${F.launchd.userAgents.length ? t(F.launchd.userAgents.map(d => [d.label, d.status]), ['Label', 'Status']) : '(keine)'}

### cron (Benutzer macminim5, \`crontab -l\`)
\`\`\`
${F.launchd.crontab}
\`\`\`

Laufende Prozesse:
\`\`\`
${F.launchd.processes || '(keine passenden)'}
\`\`\`

### FileMaker Server
${kv({ Installiert: F.filemaker.installed ? 'ja, ' + FMS : 'nein', Version: F.filemaker.version, 'Admin Console': F.filemaker.adminConsole, 'Data API': F.filemaker.dataApi, Zeitpläne: F.filemaker.schedules, 'System-Skripte (Data/Scripts)': F.filemaker.scriptsDir })}

Gehostete Dateien (${F.filemaker.files.length}):
${t(F.filemaker.files.map(f => [f.name, f.size, f.mtime]), ['Datei', 'Grösse', 'Geändert'])}

Backups in \`${FMS}/Data/Backups\` (eingebautes Auto-Backup):
${t(F.filemaker.backups.map(f => [f.name, f.mtime]), ['Ordner', 'Zeit'])}

Backups in \`/DRIVE/Backups\` (\`fm-backup.sh\`: Wochentage überschrieben, Sonntage als \`FM_JJJJ-Mon-KW\`; Kopie auf Drive \`/FM-Backups\`):
${F.filemaker.driveBackups.length ? t(F.filemaker.driveBackups.map(f => [f.name, f.mtime]), ['Ordner', 'Zeit']) : '(noch keine)'}

Letzte Fehler/Warnungen in Event.log:
\`\`\`
${F.filemaker.eventLogErrors}
\`\`\`

### OskarOS
${kv({ Pfad: `${F.oskar.path} (Besitzer ${F.oskar.owner})`, Version: `${F.oskar.version} · git ${F.oskar.git} · ${F.oskar.dirty}`, 'Node / npm / claude': `${F.oskar.node} / ${F.oskar.npm} / ${F.oskar.claude}`, 'Node-ID (Event-Log)': F.oskar.nodeId, 'Keys in .env.local (nur Namen)': F.oskar.envKeys, 'HTTP /crm': F.oskar.http, WhatsApp: F.oskar.whatsapp, Mail: F.oskar.mail, 'Letzter Mail-Sweep': F.oskar.mailLastSweep, Logs: F.oskar.logs, 'Datenumfang': F.oskar.dbSize })}

Event-Logs (Zeilen):
\`\`\`
${F.oskar.eventLogs}
\`\`\`

### Sync, Drive, Google
${kv({ rclone: F.sync.rclone, 'rclone-Remotes': F.sync.rcloneRemotes, 'Google Drive for Desktop': `${F.sync.driveAccount} · ${F.sync.driveProcess}`, '/DRIVE Inhalt': F.sync.driveTree, 'Spiegel-Reste in /DRIVE': F.sync.driveMirrorLeftovers, 'Antigravity CLI': F.sync.agy, gcloud: F.sync.gcloud })}

## 7. Zeitpläne (gefunden)
${t([
  ...F.launchd.crontab.split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => {
    const m = l.trim().match(/^(@\w+|(?:\S+\s+){4}\S+)\s+(.+)$/)
    return m ? [m[1], m[2] + ' (cron)', /fm-backup/.test(m[2]) ? '/DRIVE/Backups, /Oskar/logs/rclone.log' : '/Oskar/logs/server.log', ''] : [l, '(cron)', '', '']
  }),
  ['eingebaut', 'FileMaker-Zeitplan „FMS" (Auto-Backup nach Data/Backups)', 'Data/Backups/FMS_<datum>', 'soll gelöscht werden (E2.1, Admin Console)'],
  ['alle 20 s', 'Oskar: Scheduled-Send-Ticker', 'im Prozess', ''],
  ['alle 15 min', 'Oskar: Auto-Respond-Heartbeat', 'im Prozess', 'nur aktiv, wenn ein Prospect auto_respond=1 hat'],
  ['alle 5 min', 'Oskar: WhatsApp-Reconnect', 'im Prozess', ''],
], ['Zeit', 'Job', 'Ergebnis sichtbar in', 'Hinweis'])}

## 10. Domains, DNS und Zertifikate (gefunden)
${kv({ 'Öffentliche IP jetzt': `${F.dns.publicIp} (${F.dns.publicRdns || 'kein Reverse-Name'})`, 'Zertifikat FileMaker Server (:443)': F.dns.certFileMaker, 'Zertifikat praxis-oppliger.ch': F.dns.certWebsite })}

${t(Object.entries(F.dns.zones).map(([d, z]) => [d, z.ns, z.a, z.www, z.mx, z.fm, z.mini]), ['Domain', 'Nameserver', 'A', 'www', 'MX', 'fm.', 'mini.'])}

## 11. Änderungen seit dem letzten Lauf${prev ? ` (${prev.replace('.json', '')})` : ''}
${diff || (prev ? '(keine Änderungen an den verglichenen Fakten)' : '(erster Lauf, kein Vergleich)')}
`
writeFileSync(join(OUT, 'FACTS.md'), md)
console.log(`FACTS.md written (${md.length} chars); facts/${stamp}.json; diff lines: ${diff ? diff.split('\n').length : 0}`)
