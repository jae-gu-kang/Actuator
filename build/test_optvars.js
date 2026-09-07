#!/usr/bin/env node
/* 4-bar-linkage-torque.html — 설계 변수(링크별 고정/변수) 불변식 회귀 테스트
 *
 * 이 파일이 지키는 핵심 계약: **기본 변수집합(c·b 변수, a·d 고정) 에서는
 * optimizeForVars 가 기존 optimizeForDeltaWithC 와 완전히 같은 결과를 낸다.**
 * 두 함수를 같은 프로세스에서 직접 비교하므로 예전 빌드를 따로 보관할 필요가 없다
 * (= 이 계약이 깨지면 외부 기준 없이도 바로 잡힌다).
 *
 * 실행:  node build/test_optvars.js [경로/4-bar-linkage-torque.html]
 * 브라우저 없이 <script> 본문만 vm 으로 올려 옵티마이저를 직접 호출한다. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const FILE = path.resolve(process.argv[2] || path.join(__dirname, '..', '4-bar-linkage-torque.html'));

const results = [];
function rec(name, pass, detail){ results.push({name, pass, detail: detail||''});
  console.log((pass?'  \x1b[32mPASS\x1b[0m ':'  \x1b[31mFAIL\x1b[0m ')+name+(detail?('  — '+detail):'')); }

// ── DOM 최소 스텁: 옵티마이저는 입력칸 읽기/결과 innerHTML 쓰기만 한다 ──
function load(file){
  const body = fs.readFileSync(file,'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
  const mk = () => new Proxy(function(){}, {
    get:(t,p)=>p==='measureText'?(()=>({width:10})):mk(), apply:()=>mk(), set:()=>true });
  const el = () => {
    const o = { _v:'', style:new Proxy({},{
      get:(t,p)=>(p==='setProperty'||p==='removeProperty')?(()=>{}):'', set:()=>true }),
      classList:{add(){},remove(){},toggle(){},contains(){return false}},
      getContext:()=>mk(), addEventListener(){},
      getBoundingClientRect:()=>({left:0,top:0,width:800,height:600}),
      width:800, height:600, offsetWidth:800, checked:false,
      innerHTML:'', textContent:'', dataset:{}, disabled:false };
    return new Proxy(o,{
      get:(t,p)=>p==='value'?t._v:(p in t?t[p]:(typeof p==='string'?()=>{}:undefined)),
      set:(t,p,v)=>{ if(p==='value') t._v=v; else t[p]=v; return true; } });
  };
  const store = {};
  const absent = new Set();   // 고정된 링크의 편집칸이 '아예 없는' 상태를 재현
  const doc = { getElementById:id=>(absent.has(id)?null:(store[id]||(store[id]=el()))), querySelector:()=>el(),
    querySelectorAll:()=>[], createElement:()=>el(), addEventListener(){},
    body:el(), documentElement:el(), activeElement:null };
  const ctx = { document:doc,
    window:{addEventListener(){},devicePixelRatio:1,open(){},matchMedia:()=>({matches:false,addEventListener(){}}),
            requestAnimationFrame:()=>0,getComputedStyle:()=>({getPropertyValue:()=>''}),location:{hash:''}},
    navigator:{clipboard:{}}, localStorage:{getItem:()=>null,setItem(){}},
    requestAnimationFrame:()=>0, setTimeout:()=>0, clearTimeout:()=>{},
    console, Math, JSON, Array, Object, Number, String, Boolean,
    isNaN, parseFloat, parseInt, isFinite, Date, Set, Map, Infinity, NaN };
  ctx.globalThis = ctx;
  // S / OPTVARS 는 const 라 컨텍스트 속성이 아니다 → 같은 스코프에 드라이버를 붙여 노출
  const drv = "\n;globalThis.__api={"
    + "setS:o=>Object.assign(S,o), getS:()=>({a:S.a,b:S.b,c:S.c,d:S.d}),"
    + "setVars:o=>{for(const k in o) Object.assign(OPTVARS[k],o[k]);},"
    + "resetVars:()=>{OPTVARS.d={v:false,lo:null,hi:null,user:false};OPTVARS.a={v:false,lo:null,hi:null,user:false};"
    +   "OPTVARS.b={v:true,lo:null,hi:null,user:false};OPTVARS.c={v:true,lo:null,hi:null,user:false};},"
    + "getVars:()=>({d:OPTVARS.d.v,a:OPTVARS.a.v,b:OPTVARS.b.v,c:OPTVARS.c.v}),"
    + "setOptVar:(k,v)=>setOptVar(k,v), optVarRange:k=>optVarRange(k),"
    + "cRange:()=>readCRange(),"
    + "withC:(dm,dp,T2,m,lo,hi,opt)=>optimizeForDeltaWithC(dm,dp,T2,m,lo,hi,opt),"
    + "vars:(dm,dp,T2,m,opt)=>optimizeForVars(dm,dp,T2,m,opt),"
    // applyOpt 는 draw() 까지 부르므로 캔버스 전역을 먼저 채워둔다
    + "initCanvas:()=>{cv=document.getElementById('__cv');ctx=cv.getContext('2d');W=800;H=600;},"
    + "setCtx:o=>{_optCtx=o;},"
    + "evalDesign:(cv,bv,t0,dm,dp,T2,m,mode,av,dv)=>evalDesign(cv,bv,t0,dm,dp,T2,m,mode,av,dv),"
    + "field:id=>{const e=document.getElementById(id);return e?e.value:null;},"
    + "applyFromCard:()=>applyOptFromCard()};";
  vm.runInNewContext(body+drv, ctx, {filename:file});
  ctx.__api.setAbsent = ids => { absent.clear(); (ids||[]).forEach(i=>absent.add(i)); };
  ctx.__api.setField  = (id,v) => { const e=doc.getElementById(id); if(e) e.value=v; };
  return ctx.__api;
}

const A = load(FILE);
const FIELDS = ['cOpt','b','t0','tm','tp','worst','wmax','wargDeg','tn','imbal',
                'muMin','score','physLo','physHi','fbType','fallback'];
const pick = r => { if(!r) return null; const o={}; for(const f of FIELDS) o[f]=(r[f]===undefined?null:r[f]); return o; };

const BASE = {a:20,b:100,c:40,d:100,offY:0,sol:'open',t4:100};
// 기본 경로 동일성만 확인하면 되므로 대표 조합만 (편심 offY, cross 해, 비대칭 포함)
const GEO = [
  {a:20,d:100,c:40,offY:0, sol:'open'},
  {a:12,d:100,c:40,offY:25,sol:'open'},
  {a:20,d:60, c:30,offY:0, sol:'cross'},
];
const DEFL = [ {dm:25,dp:25}, {dm:40,dp:40}, {dm:30,dp:20} ];

// ── 1) 기본 변수집합 = 기존 함수와 완전 동일 (이 저장소의 핵심 계약) ──
{
  let n=0, bad=0, firstBad=null;
  for(const g of GEO) for(const df of DEFL){
    const sym = df.dm===df.dp;
    // 비대칭은 doOptimize 와 동일하게 2-패스: 패스A(margin) 로 M* 를 구해 실제 floor 를 만든다.
    // floor:0 으로 두면 okFloor 가 항상 참이라 여유하한 제약이 아예 안 걸린다.
    let modes = [undefined];
    if(!sym){
      A.resetVars(); A.setS({...BASE, ...g});
      const cR0 = A.cRange();
      const passA = A.withC(df.dm, df.dp, 3, 5, cR0.lo, cR0.hi, {mode:'margin'});
      modes = [{mode:'margin'}];
      if(passA) modes.push({mode:'torque', floor:0.9*passA.score});
    }
    for(const mode of modes){
      A.resetVars(); A.setS({...BASE, ...g});
      const cR = A.cRange();
      const legacy = A.withC(df.dm, df.dp, 3, 5, cR.lo, cR.hi, mode);
      A.resetVars(); A.setS({...BASE, ...g});
      const now = A.vars(df.dm, df.dp, 3, 5, mode);
      n++;
      const l=JSON.stringify(pick(legacy)), q=JSON.stringify(pick(now));
      if(l!==q && !bad++) firstBad = JSON.stringify({g,df,mode})+'\n    legacy='+l+'\n    vars  ='+q;
    }
  }
  rec('기본 변수집합(c·b 변수, a·d 고정) = optimizeForDeltaWithC 와 동일',
      bad===0, bad===0 ? (n+'개 조합 전 필드 일치') : (bad+'/'+n+' 불일치\n    '+firstBad));
}

// ── 2) 어떤 조합에서도 S.a/S.b/S.c/S.d 누수 없음 ──
{
  const COMBOS = [ {}, {a:{v:true}}, {d:{v:true}}, {b:{v:false}}, {c:{v:false}},
                   {a:{v:true},d:{v:true},c:{v:false}},
                   {a:{v:false},b:{v:false},c:{v:false},d:{v:false}} ];
  // 좌표강하(a·d 변수)는 편심 지상링크·cross 해에서도 S 를 되돌려야 한다
  const ENVS = [ BASE, {...BASE, offY:25}, {...BASE, sol:'cross'} ];
  let leaked = null, n = 0;
  outer:
  for(const env of ENVS) for(const spec of COMBOS){
    A.resetVars(); A.setVars(spec); A.setS(env); n++;
    try { A.vars(25,25,3,5); } catch(e){ leaked = '예외: '+e.message; break outer; }
    const g = A.getS();
    if(g.a!==env.a||g.b!==env.b||g.c!==env.c||g.d!==env.d){
      leaked = JSON.stringify(spec)+' @offY='+env.offY+'/'+env.sol+' → '+JSON.stringify(g); break outer;
    }
  }
  rec('모든 고정/변수 조합에서 S.a·b·c·d 복원 (편심·cross 포함, 전역 변이 누수 없음)',
      !leaked, leaked || n+'개 조합');
}

// ── 3) 스케일 불변성 → 최소 1개는 고정이어야 한다 ──
{
  A.resetVars();                      // b·c 변수, d·a 고정
  A.setOptVar('d', true);             // 고정 1개(a) 남음 — 허용
  const afterD = A.getVars();
  A.setOptVar('a', true);             // 마지막 고정 → 거부돼야 함
  const afterA = A.getVars();
  const fixed = ['a','b','c','d'].filter(k=>!afterA[k]);
  rec('최소 1개 고정 강제 (네 링크 전부 변수 = 스케일 축퇴)',
      afterD.d===true && afterA.a===false && fixed.length===1,
      '고정 남은 링크: '+JSON.stringify(fixed));
}

// ── 4) 네 링크 전부 고정 → θ₄₀ 만 최적화 (링크는 그대로) ──
{
  A.resetVars(); A.setVars({a:{v:false},b:{v:false},c:{v:false},d:{v:false}}); A.setS(BASE);
  const r = A.vars(25,25,3,5);
  rec('전부 고정 → 링크 불변, θ₄₀ 만 탐색',
      !!r && r.cOpt===BASE.c && r.b===BASE.b && typeof r.t0==='number',
      r ? ('c='+r.cOpt+' b='+r.b+' θ₄₀='+(+r.t0).toFixed(1)) : '해 없음');
}

// ── 5) b 고정 → 추천 b 는 반드시 입력값 그대로 ──
{
  A.resetVars(); A.setVars({b:{v:false}}); A.setS(BASE);
  const r = A.vars(25,25,3,5);
  rec('b 고정 → 추천 b == 입력 b', !!r && r.b===BASE.b, r ? ('b='+r.b) : '해 없음');
}

// ── 6) 뒤집힌 탐색범위(min>max)는 자동 범위로 폴백 (c·b 동일 규칙) ──
{
  let okAll = true, detail = [];
  for(const k of ['b','c']){
    A.resetVars(); A.setS(BASE);
    A.setVars({[k]:{v:true, lo:200, hi:50, user:true}});
    const rg = A.optVarRange(k);
    if(rg.lo > rg.hi){ okAll=false; }
    detail.push(k+'→'+rg.lo+'~'+rg.hi);
  }
  rec('뒤집힌 탐색범위는 자동 범위로 폴백 (탐색이 빈 구간으로 붕괴하지 않음)',
      okAll, detail.join(', '));
}

// ── 7) 정상 사용자 범위는 실제로 강제된다 ──
{
  A.resetVars(); A.setS(BASE);
  A.setVars({c:{v:true, lo:30, hi:36, user:true}});
  const r = A.vars(25,25,3,5);
  rec('사용자 지정 c 범위가 탐색에 강제됨',
      !!r && r.cOpt>=30 && r.cOpt<=36, r ? ('c*='+r.cOpt+' (지정 30~36)') : '해 없음');
}

// ── 8) 적용 경로: 고정 링크는 건너뛰고, 렌더된 칸이 비면 '부분 적용' 없이 전체 취소 ──
//    (1~3차 리뷰에서 발견된 버그가 전부 이 경로에 있었다)
{
  A.initCanvas();
  const CTX = {dm:25,dp:25,sym:true,mode:'margin',floor:0,Mstar:null,
               T2:3,margin:5,motorVal:NaN,hasMotor:false,c0:40,a0:20,d0:100};

  // (a) c 고정(편집칸 없음) → c 는 그대로, b·θ₄₀ 만 적용
  A.resetVars(); A.setS(BASE); A.setCtx(CTX);
  A.setAbsent(['optEditC','optEditA','optEditD']);
  A.setField('optEditB',111); A.setField('optEditT0',95);
  let err=null; try{ A.applyFromCard(); }catch(e){ err=e.message; }
  const g1 = A.getS();
  rec('적용: 고정 링크(c)는 건너뛰고 변수 링크(b)만 반영',
      !err && g1.c===BASE.c && g1.b===111,
      err ? ('예외: '+err) : ('c='+g1.c+'(불변) b='+g1.b));

  // (b) c 칸이 렌더돼 있는데 비어 있으면 → 아무것도 적용하지 않음
  A.resetVars(); A.setS(BASE); A.setCtx(CTX);
  A.setAbsent(['optEditA','optEditD']);          // c·b·θ₄₀ 는 렌더됨
  A.setField('optEditC','');                     // 비어 있는 칸
  A.setField('optEditB',123); A.setField('optEditT0',95);
  err=null; try{ A.applyFromCard(); }catch(e){ err=e.message; }
  const g2 = A.getS();
  rec('적용: 렌더된 칸이 비면 부분 적용 없이 전체 취소',
      !err && g2.b===BASE.b && g2.c===BASE.c,
      err ? ('예외: '+err) : ('b='+g2.b+' c='+g2.c+' (둘 다 불변)'));

  // (c) 범위 밖 값도 클램프가 아니라 전체 취소
  A.resetVars(); A.setS(BASE); A.setCtx(CTX);
  A.setAbsent(['optEditA','optEditD']);
  A.setField('optEditC',500); A.setField('optEditB',123); A.setField('optEditT0',95);
  err=null; try{ A.applyFromCard(); }catch(e){ err=e.message; }
  const g3 = A.getS();
  rec('적용: 범위 밖 값(c=500)은 클램프 아닌 전체 취소',
      !err && g3.b===BASE.b && g3.c===BASE.c,
      err ? ('예외: '+err) : ('b='+g3.b+' c='+g3.c+' (둘 다 불변)'));

  // (d) a·d 도 렌더된 경우 — d 의 10mm 하한과 a 의 서보암 연동까지 실제로 태운다
  A.resetVars(); A.setS(BASE); A.setCtx(CTX);
  A.setAbsent([]);
  A.setField('optEditA',26); A.setField('optEditD',120);
  A.setField('optEditC',45); A.setField('optEditB',105); A.setField('optEditT0',95);
  err=null; try{ A.applyFromCard(); }catch(e){ err=e.message; }
  const g4 = A.getS();
  rec('적용: a·d 도 변수면 네 링크가 모두 반영됨',
      !err && g4.a===26 && g4.d===120 && g4.c===45 && g4.b===105 && A.field('ia')===26 && A.field('id')===120,
      err ? ('예외: '+err) : ('a='+g4.a+' d='+g4.d+' c='+g4.c+' b='+g4.b+' #ia='+A.field('ia')+' #id='+A.field('id')));
  A.setAbsent([]);
}

// ── 9) 비유한 θ₄₀ 는 evalDesign 이 즉시 거부 (0.25° 스윕이 t+=0.25 로 전진 못해 UI 정지) ──
{
  A.resetVars(); A.setS(BASE);          // 앞 테스트가 바꾼 S 를 되돌리고 시작
  const t0s = [Infinity, -Infinity, NaN];
  let allRejected = true, slow = null;
  for(const t0 of t0s){
    const st = Date.now();
    const m = A.evalDesign(40, 100, t0, 25, 25, 3, 5, 'margin');
    const ms = Date.now() - st;
    if(!m || !m.err) allRejected = false;
    if(ms > 500) slow = t0+' → '+ms+'ms';
  }
  const good = A.evalDesign(40, 100, 95, 25, 25, 3, 5, 'margin');
  rec('비유한 θ₄₀(±Infinity·NaN)는 무한루프 없이 즉시 거부, 정상값은 계산됨',
      allRejected && !slow && good && !good.err && isFinite(good.score),
      slow ? ('느림: '+slow) : ('거부 3종 OK · 정상 score='+(good&&good.score!==undefined?(+good.score).toFixed(3):'—')));
}

const passed = results.filter(r=>r.pass).length;
console.log('\n== 결과: '+passed+'/'+results.length+' 통과 ==');
process.exit(passed===results.length ? 0 : 1);
