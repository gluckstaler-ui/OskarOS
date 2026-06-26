#!/usr/bin/env node
// Web-log analytics for the cPanel box. Reads an Apache "combined" log (live
// domlog or a .gz-extracted archive), aggregates it, prints a report.
// This IS the whole engine — a live tailer + dashboard is a thin wrapper on top.
'use strict';
const fs = require('fs');
const file = process.argv[2];
const label = process.argv[3] || file;

const LINE  = /^(\S+) \S+ \S+ \[([^\]]+)] "([A-Z]+) (\S+)[^"]*" (\d{3}) (\S+) "([^"]*)" "([^"]*)"/;
const BOT   = /bot|crawl|spider|slurp|bing(preview|bot)|yandex|baidu|duckduck|dataprovider|facebookexternal|semrush|ahrefs|mj12|dotbot|petalbot|gptbot|claudebot|ccbot|bytespider|headless|phantom|monitor|uptime|curl|wget|python-requests|go-http-client|libwww|axios|node-fetch|okhttp|java\//i;
const ASSET = /\.(css|js|mjs|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|mp4|webm|xml|txt|pdf)(\?|$)/i;
const MON   = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };

const seen = new Set();
let total=0, parsed=0, botHits=0, humanHits=0, bytes=0, minT=null, maxT=null;
const humanIPs=new Set(), paths={}, refs={}, status={}, hours={};
const host = label.replace(/^www\./,'');

for (const ln of fs.readFileSync(file,'utf8').split('\n')) {
  if (!ln || seen.has(ln)) continue; seen.add(ln); total++;
  const m = LINE.exec(ln); if (!m) continue; parsed++;
  const [, ip, ts, method, path, st, sz, ref, ua] = m;
  bytes += sz==='-' ? 0 : (parseInt(sz,10)||0);
  status[st] = (status[st]||0)+1;
  const d = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2})/.exec(ts);
  if (d) { const key=`${d[3]}-${MON[d[2]]}-${d[1]} ${d[4]}:00`; if(!minT||key<minT)minT=key; if(!maxT||key>maxT)maxT=key; hours[d[4]]=(hours[d[4]]||0)+1; }
  if (BOT.test(ua) || ua==='-') { botHits++; continue; }
  humanHits++; humanIPs.add(ip);
  if (method==='GET' && !ASSET.test(path) && (st[0]==='2'||st[0]==='3')) paths[path]=(paths[path]||0)+1;
  if (ref && ref!=='-' && !ref.includes(host)) refs[ref]=(refs[ref]||0)+1;
}

const top = (o,n=8)=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,n);
const fmtB = b=> b>1e6?(b/1e6).toFixed(1)+' MB' : b>1e3?(b/1e3).toFixed(1)+' KB' : b+' B';
const out = [];
out.push(`\n═══ ${label} ═══`);
out.push(`window:        ${minT||'?'}  →  ${maxT||'?'}`);
out.push(`requests:      ${total} unique log lines  (${parsed} parsed)`);
out.push(`humans:        ${humanHits} hits from ${humanIPs.size} unique IPs`);
out.push(`bots/crawlers: ${botHits} hits`);
out.push(`bandwidth:     ${fmtB(bytes)}`);
out.push(`\ntop pages (human):`);
const tp=top(paths); out.push(tp.length?tp.map(([p,c])=>`  ${String(c).padStart(4)}  ${p}`).join('\n'):'  (none)');
out.push(`\ntop referrers (human, external):`);
const tr=top(refs); out.push(tr.length?tr.map(([r,c])=>`  ${String(c).padStart(4)}  ${r}`).join('\n'):'  (none)');
out.push(`\nstatus codes:  ${top(status,10).map(([s,c])=>`${s}×${c}`).join('   ')}`);
out.push(`busiest hours: ${top(hours,6).map(([h,c])=>`${h}h×${c}`).join('   ')}`);
console.log(out.join('\n'));
