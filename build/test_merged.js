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

  // 1) Shell: 7 tools registered, tab bar removed (nav = home cards + per-tool 홈 button)
  const shellNav = await page.evaluate(()=>({ tools: Object.keys(TOOLS), tabBar: document.querySelectorAll('.tab').length }));
  rec('shell: 7개 도구 등록 & 탭바 제거됨',
      shellNav.tools.length===7 && ['home','linkage','hinge','regression','servo','rigging','manual'].every(t=>shellNav.tools.includes(t)) && shellNav.tabBar===0,
      'tools='+shellNav.tools.join(',')+' tabBar='+shellNav.tabBar);

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
      hasResults: !!document.getElementById('lCST4') || !!document.getElementById('lCSMuOut'),
      optBtn: !!document.getElementById('btnOptimize'),
      sendHM: typeof window.sendToHM==='function' || !!document.getElementById('sendHM'),
      grashof: !!document.getElementById('gBadge')
    }));
    rec('linkage: 캔버스/결과/최적화·연동 UI',
        info.cv && info.hasResults && info.optBtn && info.sendHM && info.grashof, JSON.stringify(info));
    // torque result numeric
    const t = await f.evaluate(()=>{ const e=document.getElementById('lCST4'); return e?e.textContent.trim():''; });
    rec('linkage: 출력토크 T₄ 계산값 출력(조종면 각도 카드)', /[0-9]/.test(t), 'T4="'+t+'"');
    // AI optimizer runs without throwing
    const optRes = await f.evaluate(()=>{ try{ if(typeof runOptimizer==='function'){ runOptimizer(); return 'ran'; } return 'no-fn'; }catch(e){ return 'ERR:'+e.message; } });
    rec('linkage: AI 최적값 계산 실행', optRes==='ran'||optRes==='no-fn', optRes);
    // graphs render (mechanism cv + torque/coupler plots)
    const cr = await canvasReport(f);
    rec('linkage: 그래프/기구 캔버스 렌더(오프라인)', cr.nonblank>=2, JSON.stringify(cr.details));
    // servo toggle + 크랭크 a 는 #ia 로만 입력 (중복이던 홀간거리 칸은 제거됨), no throw
    const sv = await f.evaluate(()=>{ try{
      const cb=document.getElementById('cbServo'); if(!cb) return {err:'no-toggle'};
      cb.checked=true; onServoToggle();
      const ia=document.getElementById('ia'); ia.value='25.4';
      ia.dispatchEvent(new Event('input',{bubbles:true}));
      const ok = SERVO.show===true && Math.abs(S.a-25.4)<1e-6
                 && document.getElementById('iArmHole')===null;   // 중복 입력칸 삭제 확인
      cb.checked=false; onServoToggle();   // 원상 복구 (이후 연동 테스트에 영향 없게)
      ia.value='20'; ia.dispatchEvent(new Event('input',{bubbles:true}));
      return {ok, a:S.a, armHoleGone:document.getElementById('iArmHole')===null};
    }catch(e){ return {err:e.message}; } });
    rec('linkage: 서보 토글 + a 단일 입력(#ia, 홀간거리 중복칸 제거)', sv.ok===true, JSON.stringify(sv));

    // 링크 카드의 고정/변수 자물쇠 토글 (설계 변수 블록에서 이동)
    const lk = await f.evaluate(()=>{ try{
      const b=document.getElementById('btnVarLock_c'), rg=document.getElementById('varRange_c');
      if(!b||!rg) return {err:'no-lock'};
      // 상태값(OPTVARS)만 보면 setOptVar 배선만 검증되고 이 리팩터가 바꾼 '렌더링'은 안 잡힌다
      const g0=b.textContent, c0=b.classList.contains('on'), d0=getComputedStyle(rg).display, v0=OPTVARS.c.v;
      b.click();
      const g1=b.textContent, c1=b.classList.contains('on'), d1=getComputedStyle(rg).display, v1=OPTVARS.c.v;
      b.click();
      return {ok: v0===true&&v1===false&&OPTVARS.c.v===v0            // 상태 반전·복귀
                  && g0==='🔓'&&g1==='🔒'&&b.textContent===g0        // 자물쇠 글리프
                  && c0===true&&c1===false&&b.classList.contains('on')===c0   // .on 클래스
                  && d0==='flex'&&d1==='none'&&getComputedStyle(rg).display===d0, // 범위행 표시
              glyph:[g0,g1], on:[c0,c1], range:[d0,d1]};
    }catch(e){ return {err:e.message}; } });
    rec('linkage: 링크 카드 고정/변수 자물쇠 토글', lk.ok===true, JSON.stringify(lk));

    // 작동기 장착각: 기본 180°(몸체 뒤집힌 형상) · 0~360 전 범위(예전엔 ±90 클램프)
    const tl = await f.evaluate(()=>{ try{
      const i=document.getElementById('iServoTilt'); if(!i) return {err:'no-tilt'};
      const def=SERVO.tilt, mn=i.min, mx=i.max;
      const set=v=>{ i.value=v; onServoTilt(); return SERVO.tilt; };
      const r={def, mn, mx, a270:set(270), a135:set(135), a359:set(359),
               wrap360:set(360), wrapNeg:set(-10), wrapBig:set(540)};
      set(def);
      return {ok: def===180 && mn==='0' && mx==='360'
                  && r.a270===270 && r.a135===135 && r.a359===359      // 90° 넘어도 클램프 없음
                  && r.wrap360===0 && r.wrapNeg===350 && r.wrapBig===180, ...r};
    }catch(e){ return {err:e.message}; } });
    rec('linkage: 장착각 기본 180° + 0~360 전 범위(90° 클램프 없음)', tl.ok===true, JSON.stringify(tl));

    // 조종면 이동 명령: 상향 최대(−δ) / 중립 / 하향 최대(+δ) (+ '중립 지정' 은 기준 변경)
    const cs = await f.evaluate(()=>{ try{
      const dn=document.getElementById('lCSdn'), z=document.getElementById('lCSzero'),
            up=document.getElementById('lCSup'), nEl=document.getElementById('iT4Neutral');
      if(!dn||!z||!up) return {err:'no-cs-buttons'};
      setDeflectMode('asym');
      document.getElementById('iDeflectP').value=30;
      document.getElementById('iDeflectM').value=10; updateCSUI();
      nEl.value=100; csGo('zero');
      const t0=S.t4;                       // 중립
      up.click(); const tup=S.t4;          // 상향 최대 (δ=−30) → θ₄ 130
      const dUp=csDelta();                 // 부호 규약: 상향은 음수여야 한다
      dn.click(); const tdn=S.t4;          // 하향 최대 (δ=+10) → θ₄ 90
      const dDn=csDelta();                 //            하향은 양수
      z.click();  const tz=S.t4;           // 중립 → 0
      // 끝단이 10° 배수가 아니면 버림값으로 간다 — 상35/하26 → 상향 30 / 하향 20
      document.getElementById('iDeflectP').value=35;
      document.getElementById('iDeflectM').value=26; updateCSUI();
      const lup=up.textContent, ldn=dn.textContent;
      up.click(); const fup=S.t4;          // 상향 30 → 130
      dn.click(); const fdn=S.t4;          // 하향 20 → 80
      // 끝단이 10° 미만이면 버림값 0 → 버튼 숨김
      document.getElementById('iDeflectP').value=8;
      document.getElementById('iDeflectM').value=8; updateCSUI();
      const hidden = up.style.display==='none' && dn.style.display==='none';
      document.getElementById('iDeflectP').value=30;
      document.getElementById('iDeflectM').value=10; updateCSUI();
      // ±1° 트림: 중립 좌우 버튼으로 1°씩, 끝단에서 멈춤
      const tm=document.getElementById('lCStrimM'), tp=document.getElementById('lCStrimP');
      if(!tm||!tp) return {err:'no-trim'};
      // +1° 트림 = δ 증가 = 조종면 하향 = θ₄ 감소 (부호 규약)
      z.click(); tp.click(); const r1=S.t4;              // δ+1 → θ₄ 99
      tp.click(); tp.click(); const r3=S.t4;             // δ+3 → θ₄ 97
      tm.click(); const r2=S.t4;                         // δ+2 → θ₄ 98
      z.click(); for(let i=0;i<12;i++) tp.click();       // 하향 끝단(δ=+10)에서 멈춤
      const rMin=S.t4;
      z.click();
      up.click(); const before=S.t4;       // δ=−30(상향 최대) 상태에서
      csSetNeutral();                      // 기준만 재정의 (θ₄ 불변)
      const afterT4=S.t4, afterN=+nEl.value;
      setDeflectMode('sym'); nEl.value=100; csGo('zero');
      return {ok: t0===100 && tup===130 && tdn===90 && tz===100
                  && dUp===-30 && dDn===10                      // 상향 −, 하향 + (부호 규약)
                  && lup==='▲ 상향 −30°' && ldn==='하향 +20° ▼'  // 35/26 → 버림 30/20
                  && fup===130 && fdn===80 && hidden
                  && r1===99 && r3===97 && r2===98 && rMin===90
                  && afterT4===before && afterN===before,
              t0,tup,tdn,tz,dUp,dDn,lup,ldn,fup,fdn,hidden,r1,r3,r2,rMin,before,afterT4,afterN};
    }catch(e){ return {err:e.message}; } });
    rec('linkage: 조종면 이동·트림·중립지정 + 부호 규약(상향 −/하향 +)', cs.ok===true, JSON.stringify(cs));

    // 서보각도 카드 — 조종면 중립에서 0°, 양 끝은 실제 크랭크 회전량. 조종면 각도와
    // 같은 1자유도를 입력측에서 본 값이라, 끝으로 보내면 판독값이 끝 칸과 일치해야 한다.
    const svc = await f.evaluate(()=>{ const _sv={a:S.a,b:S.b,c:S.c,d:S.d}; try{
      const g=i=>document.getElementById(i), tx=i=>g(i)?g(i).textContent.trim():null;
      setDeflectMode('asym'); g('iDeflectP').value=30; g('iDeflectM').value=20; updateCSUI();
      g('ia').value=20; g('ib').value=100; g('ic').value=40; g('id').value=100; onLink();
      g('iT4Neutral').value=100;   // 앞 테스트의 잔여 중립각에 기대지 않는다
      csGo('zero'); draw();
      const zero=tx('lSV'), cUp=tx('lSVup'), cDn=tx('lSVdn'), cTr=tx('lSVtravel');
      onCSAngle(-30); draw(); const atUp=tx('lSV');
      onCSAngle(20);  draw(); const atDn=tx('lSV');
      // 독립 검산: θ₂₀+Δθ₂ 를 순방향으로 풀면 같은 θ₄ 가 나와야 한다 (표시값이 아니라 기구가 근거)
      csGo('zero'); draw();
      const t40=csNeutralT4();
      const z=(solve(S.a,S.b,S.c,gLen(),t40)||[]).find(x=>x.type===S.sol);
      let worst=0, n=0;
      if(z) for(const d of [-30,-15,0,7.5,20]){
        onCSAngle(d); draw();
        const a=svAngles(); if(!a||a.cur===null) continue;
        const bk=fwdSolveEx(S.a,S.b,S.c,gLen(),((z.t2+a.cur)%360+360)%360);
        if(bk){ n++; worst=Math.max(worst,Math.abs(bk.t4-S.t4)); }
      }
      // 해 분기를 바꾸면 서보가 도는 방향이 뒤집힌다 — 카드가 그걸 따라가야 한다
      csGo('zero'); draw(); const upOpen=tx('lSVup');
      setSol(S.sol==='open'?'cross':'open'); draw(); const upCross=tx('lSVup');
      setSol('open'); draw();
      // 원시 각 카드는 기본 접힘이고, 도달 불가 배너는 그 접이 영역 **밖**에 있어야 한다
      const foldHidden=g('rawAngFold').style.display==='none';
      const bannerOut=!!g('noSolAng') && !g('rawAngFold').contains(g('noSolAng'));
      // 중복 금지 — 토크·전달각은 조종면 카드에만, 서보 카드에는 없어야 한다
      const svCard=g('lSV').closest('.angle-card');
      const noDup=!svCard.querySelector('#lCST4,#lCSMuIn,#lCSMuOut');
      return {ok: zero==='+0.0°' && atUp===cUp && atDn===cDn
                  && cUp!==cDn && cUp!=='—' && cDn!=='—' && cTr!=='—'
                  && n===5 && worst<0.01
                  && upOpen!==upCross && upCross!=='—'
                  && foldHidden && bannerOut && noDup,
              zero,cUp,cDn,cTr,atUp,atDn,역산건수:n,역산최대오차:+worst.toFixed(4),
              upOpen,upCross,foldHidden,bannerOut,noDup};
    }catch(e){ return {err:e.message}; }
    finally{ const g=i=>document.getElementById(i);
      setSol('open');
      g('ia').value=_sv.a; g('ib').value=_sv.b; g('ic').value=_sv.c; g('id').value=_sv.d;
      onLink(); csGo('zero'); draw(); } });
    rec('linkage: 서보각도 카드 — 중립 0° · 양 끝 일치 · 순방향 역산 · 중복 없음', svc.ok===true, JSON.stringify(svc));

    // 크랭크가 중립에서 ±180° 를 넘는 형상 — 표본마다 따로 접으면 360° 가 튀며 **부호가
    // 뒤집힌다**. 해가 끊기지도 않아 ≥ 도 — 도 안 뜨고 조용히 반대 방향을 알려준다.
    // 카드의 산출물이 곧 부호라 이 조합은 반드시 고정해 둔다.
    const svw = await f.evaluate(()=>{ const _sv={a:S.a,b:S.b,c:S.c,d:S.d,t4:S.t4}; try{
      const g=i=>document.getElementById(i), tx=i=>g(i).textContent.trim();
      setDeflectMode('asym'); g('iDeflectP').value=30; g('iDeflectM').value=20; updateCSUI();
      g('ia').value=25; g('ib').value=145; g('ic').value=100; g('id').value=80; onLink();
      setSol('open'); setT4(60); csSetNeutral(); draw();
      // 독립 검산 — 0.05° 씩 걸어가며 θ₂ 변화를 누적한다(구현의 표본 격자와 무관)
      const walk=dT=>{
        const t40=csNeutralT4();
        const at=t4=>{ const r=solve(S.a,S.b,S.c,gLen(),t4); if(!r) return null;
          const x=r.find(q=>q.type===S.sol)||r[0]; return x?x.t2:null; };
        let prev=at(t40); if(prev===null) return null;
        const N=Math.max(1,Math.round(Math.abs(dT)/0.05));
        let acc=0;
        for(let i=1;i<=N;i++){ const t=at(t40-dT*i/N); if(t===null) return null;
          acc+=((t-prev+180)%360+360)%360-180; prev=t; }
        return acc;
      };
      const wUp=walk(-30), wDn=walk(20);
      let lo=1e9, hi=-1e9;
      for(let d=-30; d<=20.0001; d+=0.25){ const v=walk(d); if(v===null) continue;
        lo=Math.min(lo,v); hi=Math.max(hi,v); }
      const fmt=v=>(v>=0?'+':'−')+Math.abs(v).toFixed(1)+'°';
      const cUp=tx('lSVup'), cDn=tx('lSVdn'), cTr=tx('lSVtravel');
      onCSAngle(-30); draw(); const atUp=tx('lSV');

      // 변화점을 아슬아슬하게 스치는 형상 — 판독값(svRelAt)과 양 끝(svSweep)이 서로 다른
      // 걸음으로 걸으면 정확히 360° 어긋나, 카드 위아래가 서로를 반박한다. 두 걸음을 같은
      // 식에서 뽑으므로 이제 구조적으로 어긋날 수 없다.
      setDeflectMode('asym'); g('iDeflectP').value=77.5; g('iDeflectM').value=45.5; updateCSUI();
      g('ia').value=163.9; g('ib').value=164.11; g('ic').value=255.9; g('id').value=255.82; onLink();
      setSol('cross'); setT4(197.7); csSetNeutral(); draw();
      onCSAngle(45.5); draw();
      const kCur=tx('lSV'), kDn=tx('lSVdn');
      // 1° 걸음이었다면 어긋났을 형상인가 — 아니면 이 단언이 공허하다
      const t40k=csNeutralT4(), zk=svT2At(t40k);
      const kwalk=(dT,st)=>{ let prev=zk, acc=0;
        const n=Math.max(1,Math.ceil(Math.abs(dT)/st));
        for(let i=1;i<=n;i++){ const t=svT2At(t40k-dT*i/n); if(t===null) return null;
          acc+=((t-prev+180)%360+360)%360-180; prev=t; }
        return acc; };
      const coarse=kwalk(45.5,1), fine=kwalk(45.5,(77.5+45.5)/svN(77.5,45.5));
      const kiteReal = coarse!==null && fine!==null && Math.abs(coarse-fine)>300;

      return {ok: wUp!==null && wUp>180              // 실제로 ±180 을 넘는 형상인가(공허 방지)
                  && cUp===fmt(wUp) && cDn===fmt(wDn)
                  && Math.abs(parseFloat(cTr)-(hi-lo))<0.6
                  && atUp===cUp && cTr.indexOf('≥')<0   // 해가 끊기지 않으므로 하한 표기가 아니다
                  && kiteReal && kCur===kDn,            // 걸음이 갈릴 수 있는 형상에서 두 판독값 일치
              독립상향:+wUp.toFixed(1), 독립하향:+wDn.toFixed(1), 독립행정:+(hi-lo).toFixed(1),
              카드상향:cUp, 카드하향:cDn, 카드행정:cTr, 상향이동:atUp,
              변화점판독:kCur, 변화점끝:kDn,
              거친걸음:coarse===null?null:+coarse.toFixed(1), 정렬걸음:fine===null?null:+fine.toFixed(1)};
    }catch(e){ return {err:e.message}; }
    finally{ const g=i=>document.getElementById(i);
      setSol('open'); setDeflectMode('asym');
      g('iDeflectP').value=30; g('iDeflectM').value=20; updateCSUI();
      g('ia').value=_sv.a; g('ib').value=_sv.b; g('ic').value=_sv.c; g('id').value=_sv.d;
      onLink(); g('iT4Neutral').value=100; setT4(_sv.t4); draw(); } });
    rec('linkage: 서보각도 — ±180° 를 넘어도 이어짐 · 변화점 근처에서 두 판독값 불일치 없음', svw.ok===true, JSON.stringify(svw));

    // 서보각도 ↔ 조종면 각도 대응 그래프 — 실제로 그려진 폴리라인을 잡아 카드와 대조한다.
    const svp = await f.evaluate(()=>{ const _sv={a:S.a,b:S.b,c:S.c,d:S.d}; try{
      const g=i=>document.getElementById(i);
      const cap=()=>{                       // drawSVPlot 이 낸 선·글자·원을 그대로 받아 적는다
        const c=g('svPlot').getContext('2d');
        const segs=[],texts=[],arcs=[]; let path=[];
        const _bp=c.beginPath.bind(c),_mv=c.moveTo.bind(c),_ln=c.lineTo.bind(c),
              _st=c.stroke.bind(c),_ft=c.fillText.bind(c),_ar=c.arc.bind(c);
        c.beginPath=function(){path=[];return _bp();};
        c.moveTo=function(x,y){path.push({x,y});return _mv(x,y);};
        c.lineTo=function(x,y){path.push({x,y});return _ln(x,y);};
        c.arc=function(x,y,r,a1,a2,cc){arcs.push({x,y,r});return _ar(x,y,r,a1,a2,cc);};
        c.stroke=function(){ if(path.length>1){ const q=path.slice(); q.s=String(c.strokeStyle); segs.push(q); }
          return _st(); };
        // 회전 라벨(세로축)은 회전 좌표계에서 (0,0) 에 찍힌다 — 좌표를 함께 남겨야
        // '이름만 바꾸고 데이터는 그대로' 같은 변이를 가려낼 수 있다.
        c.fillText=function(t,x,y){texts.push(String(t)); texts.at_=texts.at_||[];
          texts.at_.push({t:String(t),x,y}); return _ft(t,x,y);};
        try{ drawSVPlot(); }
        finally{ c.beginPath=_bp;c.moveTo=_mv;c.lineTo=_ln;c.stroke=_st;c.fillText=_ft;c.arc=_ar; }
        return {segs,texts,arcs,at:texts.at_||[]};
      };
      setDeflectMode('asym'); g('iDeflectP').value=30; g('iDeflectM').value=20; updateCSUI();
      g('ia').value=20; g('ib').value=100; g('ic').value=40; g('id').value=100; onLink();
      g('iT4Neutral').value=100;   // 앞 테스트의 잔여 중립각에 기대지 않는다
      csGo('zero'); draw();
      const foldHidden=g('svPlotFold').style.display==='none';
      const drawnWhileFolded=cap().segs.length;     // 접혀 있으면 offsetWidth=0 → 그리면 안 된다
      toggleSVPlot(); onCSAngle(-12); draw();

      // 두 축 모드에서 같은 표본을 어느 쪽으로 놓는지만 달라야 한다.
      // 표본은 구현이 실제로 그리는 배열에서 가져온다. 여기서 옛 '표본별 접기' 식을 다시
      // 쓰면, 그 식을 되살리는 회귀에 테스트가 함께 동의해 버린다(물리 자체는 svw 가 고정).
      const dp=30, dm=20;
      const samp=svSweep().pts.filter(q=>q.v!==null);
      const A=samp[0], B=samp[samp.length-1];
      const probe=(mode)=>{
        setSVAxis(mode);
        const C=cap();
        const curve=C.segs.slice().sort((x,y)=>y.length-x.length)[0]||[];
        const sw=mode==='s';
        const px=q=>sw?q.v:q.d, py=q=>sw?q.d:q.v;
        // 캡션의 비선형성 = '지금 세로축 단위'로 잰 직선과의 세로 거리
        const refY=x=>py(A)+(py(B)-py(A))*(x-px(A))/((px(B)-px(A))||1);
        let mx=0; for(const q of samp) mx=Math.max(mx, Math.abs(py(q)-refY(px(q))));
        // 단위는 정확히, 수치는 허용오차로 — 구현은 N≈200 표본, 테스트는 401 표본이라
        // 참값이 x.x5 경계에 걸리면 정확 비교는 언젠가 흔들린다(오늘은 일치).
        const unit=' ('+(sw?'조종면':'서보')+')';
        const capTxt=C.texts.find(t=>t.indexOf('직선 대비 최대')===0)||'';
        const want='직선 대비 최대 '+mx.toFixed(1)+'°'+unit;
        const num=parseFloat(capTxt.replace('직선 대비 최대',''));
        const unitOK=capTxt.indexOf(unit)>0 && isFinite(num) && Math.abs(num-mx)<0.06;
        // 마커 — 곡선 위에 있는 것만으로는 부족하다(중립점도 곡선 위다). 모드별로 마커의
        // x 가 '현재 δ' 인지 '현재 서보각' 인지까지 본다.
        const mk=C.arcs.find(q=>q.r>3&&q.r<6);
        const curQ={d:csDelta(), v:svRelAt(csDelta())};
        let dy=null,dx=null;
        if(mk&&curve.length>1){
          const bb=Math.min(...curve.map(q=>Math.abs(q.x-mk.x)));
          dy=Math.min(...curve.filter(q=>Math.abs(q.x-mk.x)<=bb+0.51).map(q=>Math.abs(q.y-mk.y)));
          // 곡선 양 끝이 표본 양 끝이므로, 화면 x 를 데이터 x 로 되돌려 비교한다
          const xL=curve[0].x, xR=curve[curve.length-1].x, dL=px(A), dR=px(B);
          dx=Math.abs(mk.x-(xL+(px(curQ)-dL)/((dR-dL)||1)*(xR-xL)));
        }
        // 중립 원점을 곡선이 지나는가 — 모드마다 본다('중립을 안 뺀' 구현을 잡는 유일한 검사)
        const grn=C.segs.filter(q=>q.s&&q.s.indexOf('52, 199, 89')>0&&q.length===2);
        const vt=grn.find(q=>Math.abs(q[0].x-q[1].x)<0.01);
        const hz=grn.find(q=>Math.abs(q[0].y-q[1].y)<0.01);
        let org=null;
        if(vt&&hz&&curve.length>1){
          const nr=curve.reduce((b,q)=>Math.abs(q.x-vt[0].x)<Math.abs(b.x-vt[0].x)?q:b, curve[0]);
          org=Math.abs(nr.y-hz[0].y);
        }
        // 화면 방향 — 곡선은 δ 오름차순이므로 첫 점이 상향(−dp), 끝 점이 하향(+dm).
        // 's' 모드의 세로축이 δ 라면 하향(+)이 화면 위쪽이어야 한다. 이 단언이 없으면
        // px·py 를 함께 뒤집는 점대칭 변이가 나머지 검사를 전부 통과한다.
        const upDown = curve.length>1 ? (curve[curve.length-1].y<curve[0].y) : null;
        return {n:curve.length, 캡션:capTxt, 기대:want, devOK:unitOK,
                중립원점차:org===null?null:+org.toFixed(2), 하향이위:upDown,
                마커y차:dy===null?null:+dy.toFixed(2), 마커x차:dx===null?null:+dx.toFixed(2),
                끝점x:[curve.length?+curve[0].x.toFixed(1):null,
                       curve.length?+curve[curve.length-1].x.toFixed(1):null],
                // 세로축 = 회전 좌표계 (0,0) 에 찍힌 것, 가로축 = 캔버스 맨 아래 줄
                y축:(C.at.find(q=>q.x===0&&q.y===0)||{}).t||null,
                x축:(C.at.filter(q=>q.y>150&&q.t.indexOf('(°)')>=0).pop()||{}).t||null};
      };
      const D=probe('d'), Sw=probe('s');
      setSVAxis('d');
      // 방향: δ→서보 모드에서 서보각이 줄면 화면 y 는 커진다(카드의 양 끝 부호와 일치)
      const a=svAngles();
      const Cd=cap(); const curveD=Cd.segs.slice().sort((x,y)=>y.length-x.length)[0]||[];
      const xs=curveD.map(q=>q.x), mono=xs.length>1&&xs.every((v,i)=>i===0||v>xs[i-1]);
      const dirOK = !!a && curveD.length>1 &&
                    ((a.up>a.dn) === (curveD[curveD.length-1].y>curveD[0].y));
      // 축을 바꾸면 가로·세로 이름이 **서로 자리를 맞바꿔야** 한다.
      // 집합이 달라졌는지만 보면 한쪽 라벨만 고친 변이를 놓친다.
      const swapped = !!D.x축 && !!D.y축 && !!Sw.x축 && !!Sw.y축
                      && D.x축.indexOf('조종면')===0 && D.y축.indexOf('서보')===0
                      && Sw.x축.indexOf('서보')===0 && Sw.y축.indexOf('조종면')===0;
      const okMk=r=>r.마커y차!==null&&r.마커y차<1&&r.마커x차!==null&&r.마커x차<1;
      return {ok: foldHidden && drawnWhileFolded===0 && g('svPlotFold').style.display===''
                  && D.n>=80 && Sw.n>=80 && mono && dirOK
                  && D.devOK && Sw.devOK && D.캡션!==Sw.캡션   // 단위가 바뀌면 수치도 바뀐다
                  && okMk(D) && okMk(Sw) && swapped
                  && D.중립원점차!==null && D.중립원점차<1      // 두 모드 모두 원점을 지난다
                  && Sw.중립원점차!==null && Sw.중립원점차<1
                  && Sw.하향이위===true,                        // 's' 모드에서 하향(+δ)이 위쪽
              foldHidden, drawnWhileFolded, mono, dirOK, swapped, D, Sw};
    }catch(e){ return {err:e.message}; }
    finally{ const g=i=>document.getElementById(i);
      setSVAxis('d');
      if(g('svPlotFold').style.display!=='none') toggleSVPlot();
      g('ia').value=_sv.a; g('ib').value=_sv.b; g('ic').value=_sv.c; g('id').value=_sv.d;
      onLink(); csGo('zero'); draw(); } });
    rec('linkage: 서보↔조종면 대응 그래프 — 접힘 · 방향·비선형성 일치 · 축 전환 두 모드', svp.ok===true, JSON.stringify(svp));

    // 변환식(3차) + 좌우 반전. 반전은 거울상 조립이라 서보 회전 '방향' 만 뒤집히고
    // 크기·행정·잔차는 같아야 한다 — 계수는 전부 부호만 반대가 된다.
    const sve = await f.evaluate(()=>{ const _sv={a:S.a,b:S.b,c:S.c,d:S.d}; try{
      const g=i=>document.getElementById(i), tx=i=>g(i).textContent.trim();
      setDeflectMode('asym'); g('iDeflectP').value=30; g('iDeflectM').value=20; updateCSUI();
      g('ia').value=20; g('ib').value=100; g('ic').value=40; g('id').value=100; onLink();
      g('iT4Neutral').value=100; csGo('zero'); onCSAngle(-12); draw();
      if(g('svPlotFold').style.display==='none') toggleSVPlot();
      setSVAxis('d'); setSVSide('r'); drawSVPlot();
      // 독립 최소제곱 — 중심화 없이 원변수로 정규방정식을 푼다(구현과 다른 경로)
      const lsq=(xs,ys)=>{
        const M=[];
        for(let i=0;i<4;i++){ const row=[];
          for(let j=0;j<4;j++) row.push(xs.reduce((a,x)=>a+Math.pow(x,i+j),0));
          row.push(xs.reduce((a,x,k)=>a+Math.pow(x,i)*ys[k],0)); M.push(row); }
        for(let c=0;c<4;c++){
          let pv=c; for(let r=c+1;r<4;r++) if(Math.abs(M[r][c])>Math.abs(M[pv][c])) pv=r;
          const t=M[c]; M[c]=M[pv]; M[pv]=t;
          for(let r=0;r<4;r++){ if(r===c) continue; const f=M[r][c]/M[c][c];
            for(let k=c;k<=4;k++) M[r][k]-=f*M[c][k]; } }
        return [M[3][4]/M[3][3], M[2][4]/M[2][2], M[1][4]/M[1][1], M[0][4]/M[0][0]];
      };
      const swp=svSweep(), good=swp.pts.filter(q=>q.v!==null);
      const want=lsq(good.map(q=>q.d), good.map(q=>q.v));
      const gotR=_svEq? _svEq.co.slice() : null;
      const coOK = !!gotR && gotR.every((v,i)=>Math.abs(v-want[i])<Math.max(1e-9,Math.abs(want[i])*1e-6));
      // 잔차가 실제 최대 잔차인가
      let resWant=0;
      for(const q of good) resWant=Math.max(resWant,
        Math.abs(q.v-((((want[0]*q.d+want[1])*q.d+want[2])*q.d+want[3]))));
      const resOK = !!_svEq && Math.abs(_svEq.res-resWant)<1e-6;
      // 식이 캔버스에 실제로 그려지는가
      const c2=g('svPlot').getContext('2d');
      let drawn=[]; const _ft=c2.fillText.bind(c2);
      c2.fillText=function(t,x,y){ drawn.push(String(t)); return _ft(t,x,y); };
      try{ drawSVPlot(); } finally{ c2.fillText=_ft; }
      const eqDrawn=drawn.some(t=>t.indexOf('Δθ₂ =')===0) && drawn.some(t=>t.indexOf('잔차 최대')>=0);
      // ── 좌우 반전 ──
      const cardR={sv:tx('lSV'),up:tx('lSVup'),dn:tx('lSVdn'),tr:tx('lSVtravel')};
      setSVSide('l'); drawSVPlot();
      const cardL={sv:tx('lSV'),up:tx('lSVup'),dn:tx('lSVdn'),tr:tx('lSVtravel')};
      const gotL=_svEq? _svEq.co.slice() : null;
      const neg=t=>t==='—'?t:(t[0]==='−'?'+'+t.slice(1):(t[0]==='+'?'−'+t.slice(1):t));
      const mirOK = cardR.sv!=='—' && cardR.dn!=='—'   // '—' 이면 neg() 가 그대로 통과해 공허해진다
                    && cardL.sv===neg(cardR.sv) && cardL.up===neg(cardR.up)
                    && cardL.dn===neg(cardR.dn) && cardL.tr===cardR.tr   // 행정은 크기라 그대로
                    && !!gotL && gotL.every((v,i)=>Math.abs(v+gotR[i])<Math.max(1e-9,Math.abs(gotR[i])*1e-6))
                    && Math.abs(_svEq.res-resWant)<1e-6;                 // 잔차도 그대로
      setSVSide('l'); let dl=[]; const _f2=c2.fillText.bind(c2);
      c2.fillText=function(t,x,y){ dl.push(String(t)); return _f2(t,x,y); };
      try{ drawSVPlot(); } finally{ c2.fillText=_f2; }
      // 반전 표시는 두 축 모드 모두에서 나와야 한다 — 'd' 만 보면 축을 바꿨을 때
      // 태그를 빠뜨린 회귀가 지나간다(모드마다 태그가 붙는 라벨이 다르다).
      const tagD = dl.some(t=>t.indexOf('좌측')>=0);
      setSVAxis('s'); let ds=[]; const _f3=c2.fillText.bind(c2);
      c2.fillText=function(t,x,y){ ds.push(String(t)); return _f3(t,x,y); };
      try{ drawSVPlot(); } finally{ c2.fillText=_f3; }
      const tagOK = tagD && ds.some(t=>t.indexOf('좌측')>=0);
      setSVAxis('d'); drawSVPlot();
      // 축을 바꾸면 종속변수가 바뀐다
      setSVSide('r'); setSVAxis('s'); drawSVPlot();
      const eqS=_svEq? _svEq.text : '';
      // 그릴 수 없는 형상으로 바뀌면 식은 무효가 되어야 한다. 남겨두면 '식 복사' 가
      // 화면엔 '해가 없습니다' 를 띄운 채 **옛 형상의** 계수를 배정밀도로 건네준다.
      setSVAxis('d'); drawSVPlot();
      const hadEq=_svEq!==null;
      g('ia').value=20; g('ib').value=30; g('ic').value=20; g('id').value=200; onLink(); draw();
      drawSVPlot();
      const staleEq=_svEq!==null;
      g('ia').value=20; g('ib').value=100; g('ic').value=40; g('id').value=100; onLink();
      g('iT4Neutral').value=100; csGo('zero'); draw(); drawSVPlot();
      return {ok: coOK && resOK && eqDrawn && mirOK && tagOK
                  && eqS.indexOf('δ =')===0
                  && hadEq && !staleEq            // 해 없는 형상으로 바뀌면 식이 비워진다
                  && cardR.up!=='—' && cardR.up!==cardL.up,
              coOK, resOK, eqDrawn, mirOK, tagOK, hadEq, staleEq,
              계수:gotR&&gotR.map(v=>+v.toPrecision(6)), 잔차:_svEq&&+resWant.toFixed(4),
              우측:cardR, 좌측:cardL, 축전환식:eqS.slice(0,28)};
    }catch(e){ return {err:e.message}; }
    finally{ const g=i=>document.getElementById(i);
      setSVSide('r'); setSVAxis('d');
      if(g('svPlotFold').style.display!=='none') toggleSVPlot();
      g('ia').value=_sv.a; g('ib').value=_sv.b; g('ic').value=_sv.c; g('id').value=_sv.d;
      onLink(); csGo('zero'); draw(); } });
    rec('linkage: 변환식 3차 계수 = 독립 최소제곱 · 좌우 반전은 부호만 뒤집힘', sve.ok===true, JSON.stringify(sve));

    // 서보각이 구간 안에서 되꺾이는 형상 — 축을 바꾸면 δ 가 서보각의 함수가 아니게 된다.
    // 예전엔 거의 수직인 기준선에 대한 세로거리를 재서 δ 축 폭(50°)의 수백 배인 수를 냈다.
    const svt = await f.evaluate(()=>{ const _sv={a:S.a,b:S.b,c:S.c,d:S.d}; try{
      const g=i=>document.getElementById(i);
      const cap=()=>{ const c=g('svPlot').getContext('2d'); const t=[],seg=[]; let path=[];
        const _ft=c.fillText.bind(c),_bp=c.beginPath.bind(c),_mv=c.moveTo.bind(c),
              _ln=c.lineTo.bind(c),_st=c.stroke.bind(c);
        c.fillText=function(x,a,b2){ const str=String(x);
          t.push({s:str, x:a, y:b2, w:c.measureText(str).width}); return _ft(x,a,b2);};
        c.beginPath=function(){path=[];return _bp();};
        c.moveTo=function(x,y){path.push({x,y});return _mv(x,y);};
        c.lineTo=function(x,y){path.push({x,y});return _ln(x,y);};
        c.stroke=function(){ if(path.length>1){const q=path.slice();q.s=String(c.strokeStyle);seg.push(q);} return _st(); };
        try{ drawSVPlot(); } finally{ c.fillText=_ft;c.beginPath=_bp;c.moveTo=_mv;c.lineTo=_ln;c.stroke=_st; }
        return {t,seg}; };
      setDeflectMode('asym'); g('iDeflectP').value=30; g('iDeflectM').value=20; updateCSUI();
      g('ia').value=40; g('ib').value=60; g('ic').value=40; g('id').value=80; onLink();
      setSol('open'); setT4(150); csSetNeutral(); draw();
      if(g('svPlotFold').style.display==='none') toggleSVPlot();
      setSVSide('r');
      // 이 형상이 실제로 되꺾이는가 (단언이 공허해지지 않게 먼저 확인)
      const good=svSweep().pts.filter(q=>q.v!==null);
      let tv=0; for(let i=1;i<good.length;i++) tv+=Math.abs(good[i].v-good[i-1].v);
      const turn=(tv-Math.abs(good[good.length-1].v-good[0].v))/2;
      setSVAxis('d'); const D=cap();
      const dCap=(D.t.find(q=>/^(직선 대비 )?최대 /.test(q.s))||{s:''}).s;
      setSVAxis('s'); const Sx=cap();
      const sTurn=(Sx.t.find(q=>/^(서보각이|되꺾임 )/.test(q.s))||{s:''}).s;  // 좁은 폭에선 짧은 형태
      const sDev =(Sx.t.find(q=>/^(직선 대비 )?최대 /.test(q.s))||{s:''}).s;
      const chord=Sx.seg.some(q=>q.s&&q.s.indexOf('142, 142, 147')>0);
      // 이 안내가 '수치·기준선·3차식이 왜 사라졌나' 의 유일한 설명이라 잘리면 안 된다.
      // 사이드바 최소폭(280px)일 때 캔버스는 ~230px — 그보다 좁게 강제해 재 본다.
      const holder=g('svPlot').parentElement, _w=holder.style.width;
      let clip=-1e9;
      for(const W of [230,200]){
        holder.style.width=W+'px';
        const C2=cap(), cw=g('svPlot').offsetWidth;
        for(const q of C2.t) if(/서보각이|되꺾임 |둘 —|3차식 불가/.test(q.s))
          clip=Math.max(clip, q.x+q.w-cw);
      }
      holder.style.width=_w; drawSVPlot();
      return {ok: turn>1                                   // 되꺾이는 형상이 맞다
                  && dCap.indexOf('되꺾임')>0
                  && sTurn.indexOf('서보각이')===0          // 기본 폭에선 온전한 문구
                  && sDev===''                             // 축 전환: 수치 대신 사실
                  && !chord && _svEq===null                // 기준선·3차식 없음
                  && Sx.t.some(q=>q.s.indexOf('3차식 불가')>=0)
                  && clip>-1e8 && clip<0,                  // 좁은 폭에서도 안 잘린다
              되꺾임:+turn.toFixed(1), d캡션:dCap, s캡션:sTurn, s수치:sDev,
              기준선:chord, 식:_svEq!==null, 최대넘침:+clip.toFixed(1)};
    }catch(e){ return {err:e.message}; }
    finally{ const g=i=>document.getElementById(i);
      setSVSide('r'); setSVAxis('d');
      if(g('svPlotFold').style.display!=='none') toggleSVPlot();
      setSol('open');
      g('ia').value=_sv.a; g('ib').value=_sv.b; g('ic').value=_sv.c; g('id').value=_sv.d;
      onLink(); g('iT4Neutral').value=100; setT4(100); draw(); } });
    rec('linkage: 서보각 되꺾임 — 축 전환 시 무의미한 비선형성 수치 대신 사실을 알림', svt.ok===true, JSON.stringify(svt));

    // 출력토크 그래프에 조종면 끝단(10° 버림) 마커가 그려지는가
    const pm = await f.evaluate(()=>{ try{
      const sig=(pv,mv)=>{ setDeflectMode('asym');
        document.getElementById('iDeflectP').value=pv;
        document.getElementById('iDeflectM').value=mv;
        document.getElementById('iT4Neutral').value=100;
        updateCSUI(); drawTorquePlot();
        return document.getElementById('torquePlot').toDataURL(); };
      const big=sig(35,26);                      // 버림 30/20 → 마커 2개
      const small=sig(8,8);                      // 버림 0 → 마커 없음
      const big2=sig(35,26);
      const {a,b,c,sol}=S, d=gLen(), T2=+document.getElementById('iTorque').value;
      const at=deg=>{const q=calcMAatT4(a,b,c,d,deg,sol); return q?+Math.abs(T2*q.ma).toFixed(2):null;};
      return {ok: big!==small && big===big2 && csFloor10(35)===30 && csFloor10(26)===20
                  && at(130)!==null && at(80)!==null,
              fUp:csFloor10(35), fDn:csFloor10(26), tUp:at(130), tDn:at(80),
              marker:big!==small, stable:big===big2};
    }catch(e){ return {err:e.message}; } });
    rec('linkage: 토크 그래프에 조종면 끝단(10° 버림) 마커 표시', pm.ok===true, JSON.stringify(pm));

    // 플롯 마커가 조종면 각도 카드와 같은 값을 말하는가.
    // T4arr 는 1° 정수 격자라, 중립각 θ₄₀ 가 정수가 아니면(최적화 적용 후가 보통 그렇다)
    // 끝단·현재위치가 격자에 안 떨어진다. 격자로 읽으면 카드와 최대 0.36 N·m 어긋난다.
    const mk = await f.evaluate(()=>{
      const _sv={a:S.a,b:S.b,c:S.c,d:S.d,dp:document.getElementById('iDeflectP').value,
                 dm:document.getElementById('iDeflectM').value};
      let _ctx=null,_orig=null;
      try{
      const g=id=>document.getElementById(id);
      const num=t=>{const m=String(t).match(/-?[\d.]+/); return m?+m[0]:NaN;};
      g('ia').value=25.4; g('ib').value=111; g('ic').value=46; g('id').value=99; onLink();
      setDeflectMode('asym'); g('iDeflectP').value=20; g('iDeflectM').value=20;
      g('iT4Neutral').value=99.6;              // 일부러 정수가 아닌 중립각
      updateCSUI();
      // 캔버스에 실제로 찍히는 문자열을 가로챈다
      const ctx=g('torquePlot').getContext('2d'), drawn=[], orig=ctx.fillText.bind(ctx);
      _ctx=ctx; _orig=orig;
      ctx.fillText=function(t,x,y){ drawn.push(String(t)); return orig(t,x,y); };
      csGo('zero');  drawTorquePlot();
      const curCard=num(g('lCST4').textContent);
      const curPlot=drawn.filter(t=>/^[\d.]+ N·m$/.test(t)).pop();
      // 알약 윗줄(θ₄)도 격자가 아닌 실제 각도여야 한다 — 아랫줄 δ 와 모순되면 안 된다
      const pill=drawn.filter(t=>/^[\d.]+°$/.test(t)).map(t=>parseFloat(t));
      const curPill=pill.some(v=>Math.abs(v-S.t4)<0.051), pillT4=+S.t4.toFixed(2);
      drawn.length=0;
      csGo('up');    drawTorquePlot();
      const upCard=num(g('lCST4').textContent);
      const upPlot=drawn.filter(t=>/^상향 [\d.]+° · [\d.]+ N·m$/.test(t)).pop();   // 범례 문구 제외
      const upPlotVal=upPlot?num(upPlot.split('·')[1]):null;
      return {ok: Math.abs(curCard-num(curPlot))<0.005 && upPlotVal!==null
                  && Math.abs(upCard-upPlotVal)<0.005 && curPill,
              θ40:99.6, curCard, curPlot, upCard, upPlot, pillT4, curPill, pill};
    }catch(e){ return {err:e.message}; }
    finally{ const g=id=>document.getElementById(id);
      if(_ctx&&_orig) delete _ctx.fillText;     // 예외가 나도 몽키패치를 반드시 되돌린다(프로토타입 복귀)
      g('ia').value=_sv.a; g('ib').value=_sv.b; g('ic').value=_sv.c; g('id').value=_sv.d;
      g('iDeflectP').value=_sv.dp; g('iDeflectM').value=_sv.dm;
      setDeflectMode('sym'); g('iT4Neutral').value=100; onLink(); setT4(100); draw(); } });
    rec('linkage: 플롯 마커·알약이 조종면 각도 카드와 같은 θ₄·T₄ (비정수 중립각)', mk.ok===true, JSON.stringify(mk));

    // AI 추천 패널 접기 — '이 값 적용' 은 접혀도 보이고, 실패 사유는 묻히지 않아야 한다.
    // (#optResult 가 #optFold 의 자식이라, 접히면 자식에 display:block 을 해도 안 보인다.
    //  그래서 가시성 판정은 getComputedStyle 이 아니라 getBoundingClientRect 로 해야 한다)
    const fold = await f.evaluate(()=>{ try{
      const g=id=>document.getElementById(id);
      const seen=e=>{ if(!e) return false; const r=e.getBoundingClientRect();
        return getComputedStyle(e).display!=='none' && r.width>0 && r.height>0; };
      const sweepBtn=()=>[...document.querySelectorAll('button')].find(x=>/검토 \(그래프\)/.test(x.textContent));
      const applyBtn=()=>[...document.querySelectorAll('button')].find(x=>/이 값 적용/.test(x.textContent));
      setDeflectMode('sym'); g('iDeflect').value=25;
      g('ia').value=20; g('ib').value=100; g('ic').value=40; g('id').value=100; onLink();
      if(_optFolded) toggleOptFold();
      doOptimize();
      const open={apply:seen(applyBtn()), sweep:seen(sweepBtn())};
      toggleOptFold();
      const shut={apply:seen(applyBtn()), sweep:seen(sweepBtn()), result:seen(g('optResult'))};
      // 접힌 채 적용이 실제로 동작하는가 (숨김이지 제거가 아님)
      const b4={c:S.c,t4n:+g('iT4Neutral').value};
      applyBtn().click();
      const af={c:S.c,t4n:+g('iT4Neutral').value};
      // 접힌 채 실패 → 자동으로 펼쳐 사유를 보여야 한다
      if(!_optFolded) toggleOptFold();
      g('iDeflect').value=''; doOptimize();
      const warn={folded:_optFolded, seen:seen(g('optResult')), apply:seen(applyBtn())};
      // 접힌 채 링크를 바꿔 카드가 '조립 불가' 가 되면 → 펼쳐서 사유를 보이되 적용은 막지 않는다.
      // (사유는 '현재 기하' 기준 평가라, 적용하면 추천 형상으로 바뀌어 해소될 수 있다)
      g('iDeflect').value=25; doOptimize();
      const wantC=+g('optEditC').value;        // 카드가 추천한 c
      if(!_optFolded) toggleOptFold();
      g('ic').value=wantC===45?44:45; g('id').value=400; onLink();   // c 를 일부러 다르게 + 조립 불가
      const bad0={c:S.c};
      // onLink 의 recalc 은 150ms 디바운스라 아직 안 돌았다. 사유 렌더는 클릭 안의
      // 강제 최신화가 하므로 **클릭 뒤에** 읽어야 한다(전에 읽으면 옛 내용이 잡힌다).
      applyBtn().click();
      const errCase={folded:_optFolded, seen:seen(g('optMetrics')),
                     errRendered:/⚠︎/.test(g('optMetrics').textContent),
                     before:bad0.c, after:S.c, applied:S.c===wantC};
      if(_optFolded) toggleOptFold();
      return {ok: open.apply&&open.sweep && shut.apply&&!shut.sweep&&!shut.result
                  && (af.c!==b4.c||af.t4n!==b4.t4n)
                  && !warn.folded&&warn.seen&&!warn.apply
                  && !errCase.folded&&errCase.seen&&errCase.errRendered&&errCase.applied,
              open, shut, b4, af, warn, errCase};
    }catch(e){ return {err:e.message}; }
    finally{ const g=id=>document.getElementById(id);
      if(_optFolded) toggleOptFold();
      setDeflectMode('sym'); g('iDeflect').value=25;
      g('ia').value=20; g('ib').value=100; g('ic').value=40; g('id').value=100;
      g('iT4Neutral').value=100; onLink(); setT4(100); draw(); } });
    rec('linkage: AI 패널 접기 — 적용은 항상 보이고 실패 사유는 묻히지 않음', fold.ok===true, JSON.stringify(fold));

    // 옵티마이저가 통과시킨 해의 μ 가 결과 카드 평가와 일치하는가.
    // winMuAt 이 physLo 격자 점만 보면, 0.05° 재탐색으로 t0 가 격자를 벗어났을 때
    // 창의 양 끝단(μ 최솟값이 대개 여기 있다)을 건너뛰어 미달 해를 통과시킨다.
    const muend = await f.evaluate(()=>{ const _sv={a:S.a,b:S.b,c:S.c,d:S.d}; try{
      const g=id=>document.getElementById(id);
      g('ia').value=20; g('ib').value=100; g('ic').value=40; g('id').value=100; onLink();
      setDeflectMode('sym'); g('iDeflect').value=25;
      setOptVar('b',false); setOptVar('d',true);      // a·b 고정 · c·d 변수
      doOptimize();
      const gv=i=>{const e=g(i); return e?parseFloat(e.value):null;};
      const t0=gv('optEditT0'), c=gv('optEditC'), d=gv('optEditD');
      const okn=v=>v!==null&&Number.isFinite(v);   // isFinite(null)===true 주의
      const cc=okn(c)?c:S.c, dv=okn(d)?d:S.d, av=S.a, bv=S.b;
      const df=getDeflect();
      // 차선 배너 없이 통과했다면, 창 끝점 포함 실측 μ 가 기준을 만족해야 한다
      const fb=/차선 결과/.test(g('optResult').textContent);
      const sa=S.a,sc=S.c,sd=S.d; let lo=1e9;
      try{ S.a=av; S.c=cc; S.d=dv;
        for(let t=t0-df.dm;t<=t0+df.dp+1e-9;t+=0.05){
          const q=calcMAatT4(av,bv,cc,gLen(),t,S.sol);
          if(q&&isFinite(q.mu)&&q.mu<lo) lo=q.mu;
        }
      } finally { S.a=sa; S.c=sc; S.d=sd; }
      // 'fb ||' 로 두면 이 조합이 차선으로 밀릴 때 단언이 공허해진다(핀의 전제가
      // '통과한 해의 μ 가 진짜인가' 이므로 차선행 자체가 회귀다). lo<1e8 은 표본 0건
      // (isFinite(null)===true 로 cc 가 null 이 되는 경우) 통과를 막는다.
      return {ok: !fb && lo<1e8 && lo>=OPT_MU_MIN-1e-6, 차선:fb, 실측최소μ:+lo.toFixed(2),
              기준:OPT_MU_MIN, t0, c:cc, d:dv};
    }catch(e){ return {err:e.message}; }
    finally{ const g=id=>document.getElementById(id);
      setOptVar('b',true); setOptVar('d',false);
      g('ia').value=_sv.a; g('ib').value=_sv.b; g('ic').value=_sv.c; g('id').value=_sv.d;
      g('iDeflect').value=25; onLink(); setT4(100); draw(); } });
    rec('linkage: 통과한 해의 μ 가 창 끝단 포함 실측과 일치 (a·b 고정·c·d 변수)', muend.ok===true, JSON.stringify(muend));

    // μ 차선 티어에서 배너가 약속한 '전달각 최대화' 가 바깥 변수(a·c·d)에도 적용되는가.
    // optSelect 가 점수(토크)로 고르면 d 를 안 움직여 32.1° 를 내놓는다(무차별 최적 43.6°).
    const mumax = await f.evaluate(()=>{ const _sv={a:S.a,b:S.b,c:S.c,d:S.d}; try{
      const g=id=>document.getElementById(id);
      g('ia').value=20; g('ib').value=100; g('ic').value=40; g('id').value=100; onLink();
      setDeflectMode('sym'); g('iDeflect').value=25; g('iT4Neutral').value=100; updateCSUI();
      for(const k of ['d','a','b','c']) setOptVar(k,false);
      setOptVar('d',true);                       // d 만 변수 → μ 차선 확정 조합
      doOptimize();
      const gv=i=>{const e=g(i); return e&&e.value!==''?parseFloat(e.value):null;};
      const dRec=gv('optEditD'), t0=gv('optEditT0');
      const fb=/차선 결과/.test(g('optResult').textContent);
      // 추천 지점의 실제 최소 μ
      const df=getDeflect(); const sa=S.a,sc=S.c,sd=S.d;
      const muAt=(d,t0)=>{ let mn=1e9; S.d=d;
        for(let t=t0-df.dm;t<=t0+df.dp+1e-9;t+=0.25){
          const q=calcMAatT4(S.a,S.b,S.c,gLen(),t,S.sol);
          if(!q||!isFinite(q.mu)) return -1; if(q.mu<mn) mn=q.mu; }
        return mn; };
      let got=-1, bestBrute=-1;
      try{
        got=muAt(dRec,t0);
        const rd=optVarRange('d');
        for(let d=rd.lo; d<=rd.hi; d+=1){
          const fr=(S.d=d, feasibleRangeOf(S.b)); if(!fr) continue;
          const m=Math.max(0,parseFloat(g('iMarginAngle').value)||0);
          const lo=Math.ceil(fr.lo)+m, hi=Math.floor(fr.hi)-m;
          for(let tt=lo+df.dm; tt<=hi-df.dp; tt+=0.5){
            const v=muAt(d,tt); if(v>bestBrute) bestBrute=v; }
        }
      } finally { S.a=sa; S.c=sc; S.d=sd; }
      // 차선이면 무차별 최대 μ 의 0.6° 안에 들어야 한다(밴드 0.5° + 격자 여유)
      // 양쪽 다 센티넬 통과를 막는다 — bestBrute 는 −1(표본 0건), got 는 1e9(muAt 루프 미실행).
      // 형제 핀의 lo<1e8 과 같은 이유로, 한쪽만 막으면 나머지로 조용히 통과한다.
      return {ok: fb && got>0 && got<1e8 && bestBrute>0 && got>=bestBrute-0.6,
              차선:fb, dRec, t0, 추천μ:+got.toFixed(2), 무차별최대μ:+bestBrute.toFixed(2)};
    }catch(e){ return {err:e.message}; }
    finally{ const g=id=>document.getElementById(id);
      for(const k of ['d','a']) setOptVar(k,false);
      setOptVar('b',true); setOptVar('c',true);
      g('ia').value=_sv.a; g('ib').value=_sv.b; g('ic').value=_sv.c; g('id').value=_sv.d;
      g('iT4Neutral').value=100; onLink(); setT4(100); draw(); } });
    rec('linkage: μ 차선에서 바깥 변수도 전달각 최대화 (d 만 변수)', mumax.ok===true, JSON.stringify(mumax));

    // 설계변수 스윕 — 대상만 못박고 나머지를 재최적화하는 규약, 그리고 **취소 안전성**.
    // 모달을 닫아도 틱 체인이 살아 있으면 낡은 스냅으로 S 를 되돌려, 사용자가 그 뒤
    // 고친 링크값이 조용히 뒤집히고 입력칸과 S 가 영구히 어긋난다.
    const sw = await f.evaluate(async()=>{ const _sv={a:S.a,b:S.b,c:S.c,d:S.d}; try{
      const g=id=>document.getElementById(id);
      g('ia').value=20; g('ib').value=100; g('ic').value=40; g('id').value=100; onLink();
      setDeflectMode('sym'); g('iDeflect').value=25; updateCSUI();
      // (1) 셀렉트는 '변수' 링크만
      dsSyncVarSelect();
      const opts=[...g('dsVar').options].map(o=>o.value).sort().join(',');
      const vars=['d','a','b','c'].filter(k=>OPTVARS[k].v).sort().join(',');
      // (2) 취소 안전성 — 열자마자(자동 실행) 닫고 링크를 바꾼다
      _deltaSweepData=null;
      openDeltaSweep();
      const busy0=_dsBusy;
      closeDeltaSweep();
      g('ia').value=33; g('ib').value=77; onLink();
      await new Promise(r=>setTimeout(r,1200));
      const kept=(S.a===33&&S.b===77&&+g('ia').value===33&&+g('ib').value===77);
      const busyAfter=_dsBusy;
      // 중단하면 잘린 곡선을 버려야 한다 — 안 버리면 '완료' 처럼 그려지고 재오픈해도 재계산 안 됨
      const cleared=(_deltaSweepData===null);
      openDeltaSweep(); const autoRan=_dsBusy; closeDeltaSweep();
      // (3) 정상 스윕 — 데이터가 채워지고 S 가 복원되는가
      g('ia').value=20; g('ib').value=100; onLink();
      // 취소하면 데이터를 비우므로 재오픈은 항상 자동 실행된다 — 먼저 끝내고 시작한다
      openDeltaSweep();
      for(let i=0;i<300&&_dsBusy;i++) await new Promise(r=>setTimeout(r,60));
      g('dsVar').value='c'; dsOnVarChange();
      g('dsFrom').value=28; g('dsTo').value=52; runDeltaSweep();
      for(let i=0;i<300&&_dsBusy;i++) await new Promise(r=>setTimeout(r,60));
      const D=_deltaSweepData;
      const filled=D&&D.muInArr.filter(v=>v!==null).length>5
                    &&D.tnArr.filter(v=>v!==null).length>5;
      // restore() 는 OPTVARS[key].v 도 되돌린다. S 만 보면 '변수가 조용히 고정으로
      // 강등되는' 변이를 놓친다(그 링크가 #dsVar 목록과 옵티마이저 탐색에서 사라진다).
      const restored=(S.a===20&&S.b===100&&S.c===40&&S.d===100&&OPTVARS.c.v===true);
      closeDeltaSweep();
      return {ok: opts===vars && busy0===true && busyAfter===false && kept
                  && cleared && autoRan
                  && !!filled && restored && D.key==='c',
              opts, vars, busy0, busyAfter, kept, cleared, autoRan,
              filled:!!filled, restored, key:D&&D.key, n:D&&D.xs.length};
    }catch(e){ return {err:e.message}; }
    finally{ const g=id=>document.getElementById(id);
      closeDeltaSweep();
      g('ia').value=_sv.a; g('ib').value=_sv.b; g('ic').value=_sv.c; g('id').value=_sv.d;
      onLink(); setT4(100); draw(); } });
    rec('linkage: 설계변수 스윕 — 대상만 고정·나머지 재최적화 · 닫으면 취소(S 안 되돌림)', sw.ok===true, JSON.stringify(sw));

    // 링키지 캔버스 라벨이 줌 배율과 무관하게 서로 겹치지 않는가.
    // 라벨은 화면 픽셀 고정 오프셋이라, 줌아웃하면 기구만 작아져 그대로 포개진다.
    // 텍스트 폭이 아니라 배치기가 예약한 사각형(알약 배경 포함)으로 판정한다.
    const lbl = await f.evaluate(()=>{ const _sv={a:S.a,b:S.b,c:S.c,d:S.d,off:S.offY,t4:S.t4}; try{
      const g=id=>document.getElementById(id);
      const hit=(A,B)=>A.x<B.x+B.w&&B.x<A.x+A.w&&A.y<B.y+B.h&&B.y<A.y+A.h;
      let worst=0, at=null, n=0, minRects=1e9, thin=null;
      // 각도 라벨(θ₂·θ₄)은 고정링크 '아래'(기구 반대쪽)에 놓여야 한다 — 그쪽이 늘 비어 있어
      // 자리싸움이 없다. 위로 올라오면 커플러·관절 라벨과 다투기 시작한다.
      // 주의: 이 단언은 '전부' 를 요구하므로 below 부호에 히스테리시스(밴드 안에서 직전 방향
      // 유지)를 넣으면 밴드에 걸린 라벨이 반대편에 남아 여기서 실패한다. 의도된 제약이다.
      let angTot=0, angBelow=0;
      // 각도 라벨 지시선은 관절에서 끝나야 하고 링크를 가로지르면 안 된다. 판정은 구현의
      // 목표점 계산을 베끼지 않고 '실제로 그려진 선분'으로 한다.
      let leadN=0, leadOff=0, leadCross=0, leadAt=null;
      const ctx2=document.getElementById('cv').getContext('2d');
      // 캔버스는 strokeStyle 을 정규화해 되돌려 준다('rgba(255,59,48,0.35)' → 'rgba(255, 59, 48, 0.35)').
      // 비교 전에 같은 방식으로 정규화한다.
      const _tc=document.createElement('canvas').getContext('2d');
      const cnorm=v=>{ _tc.strokeStyle=v; return String(_tc.strokeStyle); };
      const cr3=(o,u,v)=>(u.x-o.x)*(v.y-o.y)-(u.y-o.y)*(v.x-o.x);
      const xseg=(p1,p2,p3,p4)=>{                 // 끝점 접촉(E)은 교차로 세지 않는다
        const E=1e-7, d1=cr3(p3,p4,p1), d2=cr3(p3,p4,p2), d3=cr3(p1,p2,p3), d4=cr3(p1,p2,p4);
        return ((d1>E&&d2<-E)||(d1<-E&&d2>E)) && ((d3>E&&d4<-E)||(d3<-E&&d4>E));
      };
      // 형상마다 해가 풀리는 θ₄ 를 함께 준다. 공통 100° 로 두면 뒤 두 형상은 전 줌단계에서
      // 해가 없어(drawNoSol) 라벨을 한 개도 안 만든다 — 목록만 4개고 실측은 2개가 된다.
      const SHAPES=[[20,100,40,100,100],[16,110,25,120,100],[30,60,60,80,120],[50,150,120,200,120]];
      const perShape=SHAPES.map(()=>0);
      SHAPES.forEach(([a,b,c,d,t4],si)=>{
        g('ia').value=a; g('ib').value=b; g('ic').value=c; g('id').value=d; onLink(); setT4(t4);
        for(const servo of [false,true]){        // 서보 ON 은 partLabel(후보 4개, 가장 약한 배치기)
          g('cbServo').checked=servo; onServoToggle();
          for(const off of [0,40]){
            g('iServoOffY').value=off; onServoOffset();
            zoomReset();
            for(let z=0;z<7;z++){
              const seen=[], segs=[]; let path=[];
              const _of=ctx2.fillText.bind(ctx2), _bp=ctx2.beginPath.bind(ctx2),
                    _mv=ctx2.moveTo.bind(ctx2), _ln=ctx2.lineTo.bind(ctx2), _st=ctx2.stroke.bind(ctx2);
              ctx2.fillText=function(t,x,y){ seen.push({t:String(t),x,y}); return _of(t,x,y); };
              ctx2.beginPath=function(){ path=[]; return _bp(); };
              ctx2.moveTo=function(x,y){ path.push({m:1,x,y}); return _mv(x,y); };
              ctx2.lineTo=function(x,y){ path.push({m:0,x,y}); return _ln(x,y); };
              ctx2.stroke=function(){
                const sc=String(ctx2.strokeStyle);
                for(let i=1;i<path.length;i++) if(!path[i].m) segs.push([path[i-1],path[i],sc]);
                return _st(); };
              // draw() 가 던져도 패치를 반드시 되돌린다 — 안 그러면 이후 모든 테스트의
              // 캔버스 호출이 죽은 배열에 계속 쌓인다.
              try{ draw(); }
              finally{ ctx2.fillText=_of; ctx2.beginPath=_bp; ctx2.moveTo=_mv;
                       ctx2.lineTo=_ln; ctx2.stroke=_st; }
              n++;
              if(S.solutions){
                // 판정은 '고정링크 직선을 사이에 두고 라벨과 커플러가 반대편인가' 하나뿐.
                // 구현이 아래쪽을 어떻게 고르는지는 베끼지 않는다 — 베끼면 부호를 뒤집는
                // 변이가 오라클까지 같이 뒤집어 통과해 버린다.
                const O2=toWorld(0,0), O4=toWorld(gLen(),0);
                const P2={x:wx(O2[0]),y:wy(O2[1])}, P4={x:wx(O4[0]),y:wy(O4[1])};
                const side=(px,py)=>(px-P2.x)*(P4.y-P2.y)-(py-P2.y)*(P4.x-P2.x);
                const sl=S.solutions.find(x=>x.type===S.sol)||S.solutions[0];
                const PA=toWorld(sl.Ax,sl.Ay), PB=toWorld(sl.Bx,sl.By);
                const sMech=side((wx(PA[0])+wx(PB[0]))/2,(wy(PA[1])+wy(PB[1]))/2);
                const links=[[P2,{x:wx(PA[0]),y:wy(PA[1])}],
                             [{x:wx(PA[0]),y:wy(PA[1])},{x:wx(PB[0]),y:wy(PB[1])}],
                             [{x:wx(PB[0]),y:wy(PB[1])},P4]];
                const pills=[];
                _tc.font='500 10px -apple-system,sans-serif';    // arcAng 과 같은 폰트로 폭 복원
                for(const L of seen) if(/^θ[₂₄]/.test(L.t)){
                  angTot++; perShape[si]++;
                  if(side(L.x,L.y)*sMech<0) angBelow++;
                  pills.push({x:L.x-5,y:L.y-10,w:_tc.measureText(L.t).width+10,h:14});
                }
                // 지시선 = 'θ 알약 안에서 시작' + '알파 정확히 0.35'. 알약 위치만으로 고르면
                // 알약을 지나가는 y오프셋 치수선·기준선 틱이 딸려 온다 — 색조는 크랭크색으로
                // 같고 **알파만 다르다**(불투명 / 0.45). 지시선을 0.35 로 판별하는 이 규칙이
                // 필터의 전부이므로, 다른 요소의 알파를 0.35 로 맞추면 이 테스트가 깨진다.
                const CRK=cnorm(hexAlpha(C.crank,0.35)), FOL=cnorm(hexAlpha(C.follower,0.35));
                for(const [u,v,sc] of segs){
                  if(sc!==CRK&&sc!==FOL) continue;
                  if(!pills.some(q=>u.x>=q.x-0.6&&u.x<=q.x+q.w+0.6&&u.y>=q.y-0.6&&u.y<=q.y+q.h+0.6)) continue;
                  leadN++;
                  // '아무 관절이나' 가 아니라 **제 관절**이어야 한다. 크랭크색 = θ₂ = O₂,
                  // 팔로워색 = θ₄ = O₄. 아무 관절이나 허용하면 θ₄ 지시선이 O₂ 로 가도 통과한다
                  // (인접한 두 arcAng 호출을 복사할 때 나기 쉬운 실수인데, 그 지시선은 고정링크
                  //  아래 빈 곳을 지나 아무것도 가로지르지 않아 교차 단언에도 안 걸린다).
                  const J = sc===CRK ? P2 : P4;
                  if(Math.hypot(v.x-J.x,v.y-J.y)>=0.5) leadOff++;
                  for(const [k,l] of links) if(xseg(u,v,k,l)){
                    leadCross++; leadAt={a,b,c,d,servo,off,scale:+scale.toFixed(2)}; break; }
                }
              }
              const R=_lblRects;
              // 장부가 비면 '겹침 0' 이 공허해진다 — 배치기를 안 거친 라벨을 여기서 잡는다.
              // 단 해가 없는 프레임은 기구 자체를 안 그리므로(drawNoSol) 라벨이 0 이 정상.
              if(S.solutions&&R.length<minRects){
                minRects=R.length; thin={a,b,c,d,servo,off,scale:+scale.toFixed(2)}; }
              let hits=0;
              for(let i=0;i<R.length;i++) for(let j=i+1;j<R.length;j++) if(hit(R[i],R[j])) hits++;
              if(hits>worst){ worst=hits; at={a,b,c,d,servo,off,scale:+scale.toFixed(2)}; }
              zoomBy(0.82);
            }
          }
        }
      });
      return {ok: worst===0 && minRects>=10 && minRects<1e9
                  && angTot>0 && angBelow===angTot
                  && perShape.every(v=>v>0)           // 형상 4개가 전부 라벨을 냈는가
                  // 각도 라벨마다 지시선이 하나씩, 전부 **제** 관절에서 끝나고, 링크 미교차.
                  // 등호는 '224개가 전부 22px 게이트를 넘는다' 는 실측까지 함께 고정한다 —
                  // 후보 간격을 손대 게이트 아래로 들어가는 라벨이 생기면 여기서 먼저 걸린다.
                  && leadN===angTot && leadOff===0 && leadCross===0,
              검사:n, 최대겹침:worst, 지점:at, 최소예약:minRects, 최소지점:thin,
              각도라벨:angTot, 고정링크아래:angBelow, 형상별:perShape,
              지시선:leadN, 관절밖끝남:leadOff, 링크교차:leadCross, 교차지점:leadAt};
    }catch(e){ return {err:e.message}; }
    finally{ const g=id=>document.getElementById(id);
      g('cbServo').checked=false; onServoToggle();
      g('ia').value=_sv.a; g('ib').value=_sv.b; g('ic').value=_sv.c; g('id').value=_sv.d;
      g('iServoOffY').value=_sv.off; onLink(); onServoOffset(); setT4(_sv.t4); zoomReset(); draw(); } });
    rec('linkage: 캔버스 라벨 — 겹침 0 · 예약 누락 없음 · 각도는 고정링크 아래 · 지시선 링크 미교차', lbl.ok===true, JSON.stringify(lbl));

    // 토크 그래프 x축에 θ₄ 대응 조종면 각도(δ) 줄이 있는가.
    // 끝단 마커가 없는 조건(타각 8° → 버림 0)으로 두어 δ 줄만 분리 검증한다.
    const dax = await f.evaluate(()=>{ try{
      const sig=t40=>{ setDeflectMode('asym');
        document.getElementById('iDeflectP').value=8;      // 버림 0 → 끝단 마커 없음
        document.getElementById('iDeflectM').value=8;
        document.getElementById('iT4Neutral').value=t40;
        updateCSUI(); drawTorquePlot();
        return document.getElementById('torquePlot').toDataURL(); };
      const a=sig(100), b=sig(90), a2=sig(100);
      // θ₄₀ 만 바꿨는데 그래프가 달라져야 = δ 눈금이 중립각에 연동됨
      return {ok: a!==b && a===a2, shifts:a!==b, stable:a===a2};
    }catch(e){ return {err:e.message}; } });
    rec('linkage: 토크 그래프 x축에 조종면 각도(δ) 눈금 — 중립각 연동', dax.ok===true, JSON.stringify(dax));

    // 입력측 전달각(크랭크 a ↔ 커플러 b).
    // |MA| = (c/a)·sin(μ입력)·sin(μ출력) 항등으로 정의가 맞는지 검증하고,
    // 47/47 통일 이후 muIn 이 '참조값' 이 아니라 제약이라는 것(mu=min(입력,출력))과
    // 조종면 각도(δ) 카드에 입력측·출력측이 함께 표시되는지 확인한다.
    const mi = await f.evaluate(()=>{ try{
      let worst=0;
      for(const t4 of [80,95,110,125]){
        setT4(t4); draw();
        const t=calcTorque();
        if(!t||t.muIn===undefined) return {err:'no-muIn at '+t4};
        if(!(t.muIn>0&&t.muIn<=90)) return {err:'muIn out of range: '+t.muIn};
        const pred=(S.c/S.a)*Math.sin(t.muIn*Math.PI/180)*Math.sin(t.mu*Math.PI/180);
        worst=Math.max(worst, Math.abs(Math.abs(t.ma)-pred));
      }
      // calcMAatT4 가 제약용 mu 를 두 측의 최소로 내는지 (옵티마이저가 그 mu 를 실제로
      // 게이트에 쓰는지는 build/test_optvars.js 가 추천 결과의 muIn·muOut 로 따로 단언한다).
      // 입력측이 더 나쁜 자세가 표본에 실제로 있어야 공허하지 않다
      // 앞선 테스트가 남긴 기하에 기대지 않도록 명시적으로 세운다(끝나면 복원)
      let minIsBoth=true, sawInBinding=false;
      const _sv={a:S.a,b:S.b,c:S.c,d:S.d,offY:S.offY};
      try{
        S.a=20; S.b=100; S.c=30; S.d=100; S.offY=0;   // gLen() 이 offY 도 읽는다
        for(let t4=75;t4<=135;t4+=10){
          const r=calcMAatT4(S.a,S.b,S.c,gLen(),t4,S.sol);
          if(!r||!isFinite(r.mu)) continue;
          if(Math.abs(r.mu-Math.min(r.muIn,r.muOut))>1e-6) minIsBoth=false;
          if(r.muIn<r.muOut-1e-6) sawInBinding=true;
        }
      } finally { Object.assign(S,_sv); }
      setT4(100); draw();
      const dIn =document.getElementById('lCSMuIn')?.textContent||'';
      const dOut=document.getElementById('lCSMuOut')?.textContent||'';
      return {ok: worst<1e-9 && /°/.test(dIn) && /°/.test(dOut) && minIsBoth && sawInBinding,
              worst:+worst.toExponential(1), dIn, dOut, minIsBoth, sawInBinding};
    }catch(e){ return {err:e.message}; } });
    rec('linkage: 입력측 전달각 — MA 항등 · calcMAatT4 의 mu=min(입력,출력) · δ 카드 표시', mi.ok===true, JSON.stringify(mi));

    // 불변식: '도달 불가 경고가 꺼져 있으면 θ₂ 판독값은 실제 자세와 일치'.
    // lT2 갱신이 포커스 가드 안에 있으면, 도달 불가 값을 친 채 draw() 가 한 번 돌 때
    // 배너만 꺼지고 거짓 각도가 판독값에 남는다(캔버스 hover 만으로 재현).
    const rd = await f.evaluate(()=>{ const _sv={a:S.a,b:S.b,c:S.c,d:S.d}; try{
      const g=id=>document.getElementById(id);
      g('ia').value=100; g('ib').value=100; g('ic').value=40; g('id').value=100; onLink();
      setT4(100); draw();
      if(!S.solutions) return {err:'기준 자세에 해가 없음'};
      const real=(S.solutions.find(x=>x.type===S.sol)||S.solutions[0]).t2;
      // 이 형상에서 도달 불가한 θ₂ 를 찾아, 포커스를 쥔 채 입력한다
      let bad=null;
      for(let t=0;t<360;t+=1) if(fwdSolveEx(S.a,S.b,S.c,gLen(),t)===null){ bad=t; break; }
      if(bad===null) return {err:'도달 불가 θ₂ 가 없는 형상'};
      // nT2 는 '원시 각' 접이 안에 있다. 숨겨진 요소는 포커스를 못 받아 activeElement 가
      // body 로 남고, 그러면 타이핑 보호 가드가 아예 안 걸린 채로 통과해 버린다 — 펼치고
      // 포커스가 정말 걸렸는지까지 단언한다.
      if(document.getElementById('rawAngFold').style.display==='none') toggleRawAng();
      g('nT2').focus();
      const focused=document.activeElement===g('nT2');
      g('nT2').value=String(bad); onT2num(bad);
      const warned=getComputedStyle(g('noSolAng')).display==='block';
      draw();                                   // 포커스를 유지한 채 리드로
      const off=getComputedStyle(g('noSolAng')).display!=='block';
      const shown=parseFloat(g('lT2').textContent);
      const kept=g('nT2').value;
      g('nT2').blur();
      return {ok: warned && off && Math.abs(shown-real)<0.15
                  && focused && kept===String(bad),   // 편집 중인 칸을 덮어쓰지 않는다
              bad, real:+real.toFixed(2), shown, warned, bannerOff:off, focused, kept};
    }catch(e){ return {err:e.message}; }
    finally{ const g=id=>document.getElementById(id);
      if(g('rawAngFold').style.display!=='none') toggleRawAng();
      g('ia').value=_sv.a; g('ib').value=_sv.b; g('ic').value=_sv.c; g('id').value=_sv.d;
      onLink(); setT4(100); draw(); } });
    rec('linkage: 도달 불가 θ₂ — 경고 · 판독값은 실제 자세 · 편집 중인 칸 보호', rd.ok===true, JSON.stringify(rd));
  } else rec('linkage: 프레임 로드', false);

  // 4) CROSS-TOOL: linkage -> hinge handoff (window.open shim + localStorage)
  if(f){
    await page.evaluate(()=>{ localStorage.removeItem('hm_linkage_v1'); });
    const sent = await f.evaluate(()=>{ try{ if(typeof sendToHM==='function'){ sendToHM(); return 'called'; } const b=document.getElementById('sendHM'); if(b){ b.click(); return 'clicked'; } return 'no-target'; }catch(e){ return 'ERR:'+e.message; } });
    await sleep(600);
    const cur = await page.evaluate(()=>{ const fr=document.querySelector('iframe.active'); return fr?fr.getAttribute('data-name'):'?'; });
    const ls  = await page.evaluate(()=>localStorage.getItem('hm_linkage_v1'));
    rec('연동: 4-Bar→힌지 window.open이 부모 탭전환', cur==='hinge', 'sent='+sent+' activeTool='+cur);
    // dir 은 UI 가 사라져 이제 부호 규약(δ+ = 하향 = θ₄ 감소)의 유일한 표현식이다.
    // ls.length>2 만으로는 +1 로 뒤집혀도 통과하므로 값 자체를 고정한다.
    try{ const _p=ls?JSON.parse(ls):null;
      rec('연동: 페이로드 dir=−1 (δ+ = 하향 = θ₄ 감소) · t4n 전달',
          !!_p && _p.dir===-1
          && typeof _p.t4n==='number' && Number.isFinite(_p.t4n), ls);   // JSON 은 NaN 을 null 로 쓴다
    }catch(e){ rec('연동: 페이로드 dir=−1 (δ+ = 하향 = θ₄ 감소) · t4n 전달', false, String(e)); }
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
    rec('rigging: 조종면 UI/JSON(FCA_RIG) 구조 존재', base.hasJSON && base.tabs, JSON.stringify(base));
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
