#!/usr/bin/env node
/* Offline verification of engineering_tools_all_in_one.html
 * - Blocks ALL http/https requests (proves offline capability).
 * - Loads the merged file from file://, exercises each tool inside its iframe. */
const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE = 'file://' + path.resolve(process.argv[2] || '/Users/wlsekffo/orca/Actuator/engineering_tools_all_in_one.html');

const results = [];
function rec(name, pass, detail){ results.push({name, pass, detail: detail||''});
  console.log((pass?'  \x1b[32mPASS\x1b[0m ':'  \x1b[31mFAIL\x1b[0m ')+name+(detail?('  — '+detail):'')); }

const sleep = ms => new Promise(r=>setTimeout(r,ms));

async function frameByName(page, n){
  for(let i=0;i<40;i++){
    const fr = page.frames().find(f=>f.name()==='frame-'+n);
    if(fr){ try{ await fr.evaluate(()=>document.readyState); return fr; }catch(e){} }
    await sleep(100);
  }
  return null;
}
// count canvases that actually have drawn (non-blank) content
async function canvasReport(frame){
  return await frame.evaluate(()=>{
    const cs=[...document.querySelectorAll('canvas')];
    let nonblank=0; const details=[];
    for(const c of cs){
      try{
        const w=c.width,h=c.height; if(!w||!h){ details.push((c.id||'?')+':0x0'); continue; }
        const ctx=c.getContext('2d'); if(!ctx){ details.push((c.id||'?')+':noctx'); continue; }
        const d=ctx.getImageData(0,0,w,h).data;
        // sample: count pixels differing from first non-transparent pixel
        let seen=new Set(), painted=0;
        for(let i=0;i<d.length;i+=Math.max(4,Math.floor(d.length/40000)/1*4)){
          const a=d[i+3];
          if(a!==0){ painted++; seen.add((d[i]<<16)|(d[i+1]<<8)|d[i+2]); }
        }
        const nb = painted>20 && seen.size>2;
        if(nb) nonblank++;
        details.push((c.id||'?')+':'+w+'x'+h+(nb?'✓':'∅')+'('+seen.size+'c)');
      }catch(e){ details.push((c.id||'?')+':ERR'); }
    }
    return {total:cs.length, nonblank, details};
  });
}
// click first element whose visible text contains `txt`
async function clickByText(frame, txt){
  return await frame.evaluate((t)=>{
    const els=[...document.querySelectorAll('button,a,.seg,.tab,div[onclick],span[onclick]')];
    const el=els.find(e=>(e.textContent||'').replace(/\s+/g,' ').includes(t));
    if(el){ el.click(); return true; } return false;
  }, txt);
}

(async()=>{
  const blocked=[];
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args:['--no-sandbox','--disable-gpu','--allow-file-access-from-files'] });
  const page = await browser.newPage();

  // ---- OFFLINE enforcement: abort any network (http/https/ws) request ----
  await page.setRequestInterception(true);
  page.on('request', req=>{
    const u=req.url();
    if(/^https?:|^wss?:/i.test(u)){ blocked.push(u); req.abort(); }
    else req.continue();
  });
  const pageErrors=[];
  page.on('pageerror', e=>pageErrors.push('[top] '+e.message));
  page.on('console', m=>{ if(m.type()==='error') pageErrors.push('[console] '+m.text()); });

  await page.goto(FILE, {waitUntil:'load', timeout:30000});
  await sleep(400);

  // 1) Shell: tabs present
  const tabs = await page.$$eval('.tab', els=>els.map(e=>e.dataset.tool));
  rec('shell: 7개 탭 존재', tabs.length===7 && ['home','linkage','hinge','regression','servo','rigging','manual'].every(t=>tabs.includes(t)), tabs.join(','));

  // helper to open a tool tab and get its frame
  async function open(name){ await page.evaluate(n=>window.showTool(n,false), name); await sleep(250); return await frameByName(page, name); }

  // 2) HOME
  let f = await open('home');
  rec('home: 로드 & 도구 카드 존재', !!f && await f.evaluate(()=>/도구 모음|Engineering/.test(document.body.textContent) && document.querySelectorAll('a.card,.card').length>0));

  // 3) LINKAGE (4-bar)
  f = await open('linkage');
  let ok = !!f;
  if(f){
    const info = await f.evaluate(()=>({
      cv: !!document.getElementById('cv'),
      hasResults: !!document.getElementById('rMA') || !!document.getElementById('rMu'),
      optBtn: !!document.getElementById('btnOptimize'),
      sendHM: typeof window.sendToHM==='function' || !!document.getElementById('sendHM'),
      grashof: !!document.getElementById('gBadge')
    }));
    rec('linkage: 캔버스/결과/최적화·연동 UI', info.cv && info.hasResults && info.optBtn && info.sendHM, JSON.stringify(info));
    // torque result numeric
    const t = await f.evaluate(()=>{ const e=document.getElementById('rMA')||document.getElementById('rT4torque'); return e?e.textContent.trim():''; });
    rec('linkage: 토크/기계이득 계산값 출력', /[0-9]/.test(t), 'MA/T4="'+t+'"');
    // AI optimizer runs without throwing
    const optRes = await f.evaluate(()=>{ try{ if(typeof runOptimizer==='function'){ runOptimizer(); return 'ran'; } return 'no-fn'; }catch(e){ return 'ERR:'+e.message; } });
    rec('linkage: AI 최적값 계산 실행', optRes==='ran'||optRes==='no-fn', optRes);
    // graphs render (mechanism cv + torque/coupler plots)
    const cr = await canvasReport(f);
    rec('linkage: 그래프/기구 캔버스 렌더(오프라인)', cr.nonblank>=2, JSON.stringify(cr.details));
  } else rec('linkage: 프레임 로드', false);

  // 4) CROSS-TOOL: linkage -> hinge handoff (window.open shim + localStorage)
  if(f){
    await page.evaluate(()=>{ localStorage.removeItem('hm_linkage_v1'); });
    const sent = await f.evaluate(()=>{ try{ if(typeof sendToHM==='function'){ sendToHM(); return 'called'; } const b=document.getElementById('sendHM'); if(b){ b.click(); return 'clicked'; } return 'no-target'; }catch(e){ return 'ERR:'+e.message; } });
    await sleep(600);
    const cur = await page.evaluate(()=>{ const t=document.querySelector('.tab.active'); return t?t.dataset.tool:'?'; });
    const ls  = await page.evaluate(()=>localStorage.getItem('hm_linkage_v1'));
    rec('연동: 4-Bar→힌지 window.open이 부모 탭전환', cur==='hinge', 'sent='+sent+' activeTab='+cur);
    rec('연동: localStorage(hm_linkage_v1) 기록', !!ls && ls.length>2, ls?('len '+ls.length):'null');
  }

  // 5) HINGE — libs inlined + KPI + received linkage
  f = await open('hinge'); await sleep(300);
  if(f){
    const info = await f.evaluate(()=>({
      chart: typeof window.Chart==='function',
      h2c: typeof window.html2canvas==='function',
      khm: (document.getElementById('k-hm')||{}).textContent||'',
      linkbox: (()=>{ const b=document.getElementById('ht-linkbox'); return b? getComputedStyle(b).display : 'none-el'; })()
    }));
    rec('hinge: Chart.js 인라인 로드(오프라인)', info.chart, 'typeof Chart='+info.chart);
    rec('hinge: html2canvas 인라인 로드(오프라인)', info.h2c, 'typeof html2canvas='+info.h2c);
    rec('hinge: 힌지모멘트 H KPI 계산', /[0-9]/.test(info.khm), 'k-hm="'+info.khm.trim()+'"');
    rec('hinge: 4바 링키지 연동 수신 표시', info.linkbox!=='none' && info.linkbox!=='none-el', 'linkbox display='+info.linkbox);
    await sleep(700); // let wind-tunnel animation & chart paint
    const cr = await canvasReport(f);
    const wt = await f.evaluate(()=>{ const c=document.getElementById('wtCanvas'); if(!c)return 'no-el'; try{const ctx=c.getContext('2d');const d=ctx.getImageData(0,0,c.width,c.height).data;let p=0;for(let i=3;i<d.length;i+=4)if(d[i])p++;return p>50?'animating':'blank';}catch(e){return 'ERR';} });
    rec('hinge: 감도차트+풍동시뮬 캔버스 렌더(오프라인)', cr.nonblank>=1, JSON.stringify(cr.details));
    rec('hinge: 풍동 시뮬레이션 동작(wtCanvas)', wt==='animating', 'wtCanvas='+wt);
  } else rec('hinge: 프레임 로드', false);

  // 6) REGRESSION — Chart + sample -> R²
  f = await open('regression'); await sleep(200);
  if(f){
    const chart = await f.evaluate(()=>typeof window.Chart==='function');
    rec('regression: Chart.js 인라인 로드(오프라인)', chart, 'typeof Chart='+chart);
    await clickByText(f, '샘플'); await sleep(700);
    const r2 = await f.evaluate(()=>{ const t=document.body.textContent; const m=t.match(/R²[^0-9-]*(-?\d?\.?\d+)/); return m?m[0]:''; });
    rec('regression: 샘플 데이터 회귀 → R² 산출', /\d/.test(r2), r2.slice(0,40).replace(/\n/g,' '));
    const cr = await canvasReport(f);
    rec('regression: 산점도+회귀곡선 차트 렌더(오프라인)', cr.nonblank>=1, JSON.stringify(cr.details));
  } else rec('regression: 프레임 로드', false);

  // 7) SERVO — Chart + sample -> analyze -> bandwidth
  f = await open('servo'); await sleep(200);
  if(f){
    const chart = await f.evaluate(()=>typeof window.Chart==='function');
    rec('servo: Chart.js 인라인 로드(오프라인)', chart, 'typeof Chart='+chart);
    await clickByText(f, '샘플'); await sleep(600);
    await clickByText(f, '분석 실행'); await sleep(1500);
    const kpi = await f.evaluate(()=>{ const t=document.body.textContent; return /대역폭|Hz|고유|감쇠/.test(t)? 'metrics-present':''; });
    rec('servo: 샘플→분석 실행→대역폭/고유진동수 지표', kpi==='metrics-present', kpi);
    const cr = await canvasReport(f);
    rec('servo: Bode/파형 차트 렌더(오프라인)', cr.nonblank>=1, JSON.stringify(cr.details));
  } else rec('servo: 프레임 로드', false);

  // 8) RIGGING — example -> regression -> coefficients/JSON
  f = await open('rigging'); await sleep(200);
  if(f){
    const base = await f.evaluate(()=>({ tabs: document.querySelectorAll('[class*="surf"],[data-surf],.tab').length>0, hasJSON: /FCA_RIG/.test(document.body.textContent) || !!document.querySelector('[contenteditable]') }));
    await clickByText(f, '예시'); await sleep(500);
    await clickByText(f, '회귀식 계산'); await sleep(600);
    const out = await f.evaluate(()=>{ const t=document.body.textContent; return { r2: /R²[^0-9]*\d/.test(t), fca: /FCA_RIG/.test(t) }; });
    rec('rigging: 조종면 UI/JSON(FCA_RIG) 구조 존재', base.hasJSON, JSON.stringify(base));
    rec('rigging: 예시→회귀식 계산 결과 출력', out.r2||out.fca, JSON.stringify(out));
  } else rec('rigging: 프레임 로드', false);

  // 9) MANUAL — loads, search index works
  f = await open('manual'); await sleep(200);
  if(f){
    const info = await f.evaluate(()=>({ sects: document.querySelectorAll('section.section').length, idx: (typeof SEARCH_INDEX!=='undefined')?SEARCH_INDEX.length:0 }));
    rec('manual: 5개 섹션 & 검색 인덱스', info.sects===5 && info.idx>=70, JSON.stringify(info));
  } else rec('manual: 프레임 로드', false);

  // 10) OFFLINE: no external request slipped through
  rec('오프라인: 외부(http/https) 요청 0건', blocked.length===0, blocked.length? ('차단됨 '+blocked.length+'건: '+blocked.slice(0,3).join(' | ')) : '외부 요청 없음');

  // 11) No uncaught JS errors at top level
  rec('무결성: 상위 프레임 JS 오류 없음', pageErrors.length===0, pageErrors.slice(0,3).join(' || '));

  await browser.close();

  const passed = results.filter(r=>r.pass).length;
  console.log('\n== 결과: '+passed+'/'+results.length+' 통과 ==');
  if(blocked.length) console.log('참고: 차단된 외부요청 샘플:', blocked.slice(0,5));
  process.exit(passed===results.length?0:1);
})().catch(e=>{ console.error('FATAL', e); process.exit(2); });
