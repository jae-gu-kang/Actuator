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
    rec('linkage: 캔버스/결과/최적화·연동 UI', info.cv && info.hasResults && info.optBtn && info.sendHM, JSON.stringify(info));
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
              θ40:99.6, curCard, curPlot, upCard, upPlot, pillT4, curPill};
    }catch(e){ return {err:e.message}; }
    finally{ const g=id=>document.getElementById(id);
      if(_ctx&&_orig) delete _ctx.fillText;     // 예외가 나도 몽키패치를 반드시 되돌린다(프로토타입 복귀)
      g('ia').value=_sv.a; g('ib').value=_sv.b; g('ic').value=_sv.c; g('id').value=_sv.d;
      g('iDeflectP').value=_sv.dp; g('iDeflectM').value=_sv.dm;
      setDeflectMode('sym'); g('iT4Neutral').value=100; onLink(); setT4(100); draw(); } });
    rec('linkage: 플롯 마커·알약이 조종면 각도 카드와 같은 θ₄·T₄ (비정수 중립각)', mk.ok===true, JSON.stringify(mk));

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
      g('nT2').focus(); g('nT2').value=String(bad); onT2num(bad);
      const warned=getComputedStyle(g('noSolAng')).display==='block';
      draw();                                   // 포커스를 유지한 채 리드로
      const off=getComputedStyle(g('noSolAng')).display!=='block';
      const shown=parseFloat(g('lT2').textContent);
      g('nT2').blur();
      return {ok: warned && off && Math.abs(shown-real)<0.15,
              bad, real:+real.toFixed(2), shown, warned, bannerOff:off, kept:g('nT2').value};
    }catch(e){ return {err:e.message}; }
    finally{ const g=id=>document.getElementById(id);
      g('ia').value=_sv.a; g('ib').value=_sv.b; g('ic').value=_sv.c; g('id').value=_sv.d;
      onLink(); setT4(100); draw(); } });
    rec('linkage: 도달 불가 θ₂ — 경고 표시 · 경고가 꺼지면 판독값은 실제 자세', rd.ok===true, JSON.stringify(rd));
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
          !!_p && _p.dir===-1 && isFinite(_p.t4n), ls);
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
