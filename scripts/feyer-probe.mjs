import { chromium } from 'playwright';
const OUT='/tmp/feyer-shots';
const base='https://paradiso.dev/FEYER/';
const b=await chromium.launch();

// 1) Dumbar early frames — is there a door?
{
  const ctx=await b.newContext({viewport:{width:1440,height:900}});
  const p=await ctx.newPage();
  p.goto(base+encodeURIComponent('04 - Studio Dumbar.dc.html'),{waitUntil:'commit'}).catch(()=>{});
  for (const t of [400,900,1600,2600,4000]) {
    await p.waitForTimeout(t===400?400:  t - (t===900?400: t===1600?900: t===2600?1600:2600));
    await p.screenshot({path:`${OUT}/04-t${t}.png`});
  }
  await ctx.close();
}

// 2) contrast audit
function lum(c){const [r,g,b]=c.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*r+0.7152*g+0.0722*b}
function ratio(a,bb){const L1=lum(a),L2=lum(bb);const hi=Math.max(L1,L2),lo=Math.min(L1,L2);return (hi+0.05)/(lo+0.05)}
const PAGES=[['01','01 - La Stanza.dc.html'],['02','02 - Brockmann x Linear.dc.html'],['03','03 - Kenya Hara.dc.html'],['04','04 - Studio Dumbar.dc.html'],['05','05 - Active Theory.dc.html'],['07','07 - La Prova.dc.html']];
for (const [id,file] of PAGES){
  const ctx=await b.newContext({viewport:{width:1440,height:900}});
  const p=await ctx.newPage();
  try{await p.goto(base+encodeURIComponent(file),{waitUntil:'networkidle',timeout:60000})}catch{}
  await p.waitForTimeout(4000);
  const data=await p.evaluate(()=>{
    const parse=s=>{const m=s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);return m?[+m[1],+m[2],+m[3],m[4]===undefined?1:+m[4]]:null};
    const bgOf=el=>{let e=el;while(e){const c=parse(getComputedStyle(e).backgroundColor);if(c&&c[3]>0.5)return c;e=e.parentElement}return [255,255,255,1]};
    const out=[];
    document.querySelectorAll('p,li,span,a,td,figcaption,h1,h2,h3,h4').forEach(el=>{
      const txt=(el.innerText||'').trim();
      if(!txt||txt.length<4||el.children.length>0)return;
      const cs=getComputedStyle(el);
      if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity<0.3)return;
      const r=el.getBoundingClientRect(); if(r.width<5||r.height<5)return;
      const fg=parse(cs.color); if(!fg)return;
      out.push({t:txt.slice(0,45),fg,bg:bgOf(el),size:parseFloat(cs.fontSize),w:cs.fontWeight});
    });
    return out;
  });
  const bad=data.map(d=>({...d,cr:ratio(d.fg.slice(0,3),d.bg.slice(0,3))}))
    .filter(d=>{const large=d.size>=24||(d.size>=18.66&&+d.w>=700);return d.cr < (large?3:4.5)});
  const uniq=[...new Map(bad.map(x=>[x.t,x])).values()].sort((a,b)=>a.cr-b.cr);
  console.log(`\n### ${id}  total-text-nodes=${data.length}  below-WCAG-AA=${uniq.length}`);
  uniq.slice(0,8).forEach(x=>console.log(`   ${x.cr.toFixed(2)}:1  ${x.size}px  "${x.t}"`));
  await ctx.close();
}
await b.close();
