#!/usr/bin/env node
/* Verification of sase2026_rigging.html (SASE 2026 발표 장표)
 *
 * 발표 중에 실제로 일어나는 조작을 재현한다. 앞으로만 넘겨보는 테스트는
 * (1) 뒤로 갈 때의 정렬 깨짐과 (2) 번호 입력 잔류를 둘 다 놓쳤다.
 *
 *   node build/test_deck.js [경로]
 *
 * 종료 코드: 0 = 통과, 1 = 장표에 결함, 2 = 테스트 자체가 깨짐 */
const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE = 'file://' + path.resolve(process.argv[2] ||
  path.join(__dirname, '..', 'sase2026_rigging.html'));
const SLIDES = 19;

const results = [];
function rec(name, pass, detail){
  results.push({ name, pass, detail: detail || '' });
  console.log((pass ? '  \x1b[32mPASS\x1b[0m ' : '  \x1b[31mFAIL\x1b[0m ') + name + (detail ? ('  — ' + detail) : ''));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
/* 정지 상태의 변환만 통과시킨다. 회귀값(-34px)도, 전환 중간값도 거른다. */
const NONE = t => t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)';
const idx   = page => page.evaluate(() =>
  [...document.querySelectorAll('.slide')].findIndex(s => s.classList.contains('active')));
const panel = page => page.evaluate(() => ({
  open: document.getElementById('jump').classList.contains('on'),
  hint: document.getElementById('jump-hint').textContent
}));
const isRev = page => page.evaluate(() => document.body.classList.contains('rev'));
/* 끊긴 네트워크가 내는 잡음은 장표의 결함이 아니다. 인터넷 없는 곳에서도
 * 이 테스트가 돌아야 한다 — 장표가 실제로 쓰이는 곳이 그런 곳이다.
 * 진짜 오류는 page.on('pageerror') 로 들어오며 여기서 걸러지지 않는다. */
const netNoise = /net::ERR_|Failed to load resource/i;

/* 등장 모션이 끝날 때까지 기다린다. 고정 대기시간을 쓰면 장표가 늘어날 때
 * 조용히 한계를 넘고, 넘지 않아도 수십 초를 그냥 잔다.
 * .flowline/.rocker/.blink 는 영원히 도는 모션이라 제외해야 한다. */
async function settle(page, i){
  await page.waitForFunction(n => {
    const sl = [...document.querySelectorAll('.slide')][n];
    return [...sl.getAnimations({ subtree: true })].every(a =>
      a.playState !== 'running' || a.effect.getTiming().iterations === Infinity);
  }, { timeout: 8000 }, i);
  await sleep(80);
}

/* 배치 검사는 goTo() 를 우회해 클래스를 직접 바꾼다. 그래서 스크립트의 cur 가
 * DOM 과 어긋난다 — 이 검사는 해당 페이지의 마지막 단계여야 한다. */
async function overflowSweep(page, tag){
  /* getBoundingClientRect 는 opacity 를 보지 않는다. 기하 검사만 두면 화면이
     완전히 비어도 통과한다 — 쪽수만 세던 PDF 검증과 같은 구멍이다.
     이미 모든 요소를 도는 순회이므로 표시 여부를 함께 센다. */
  let hidMax = 0, hidWhere = '', seenAll = 0;
  for(let i = 0; i < SLIDES; i++){
    await page.evaluate(n => {
      const s = [...document.querySelectorAll('.slide')];
      s.forEach(x => x.classList.remove('active', 'leaving'));
      s[n].classList.add('active');
    }, i);
    await settle(page, i);
    const ov = await page.evaluate(n => {
      const sl = [...document.querySelectorAll('.slide')][n], r = sl.getBoundingClientRect();
      let worst = 0, who = '', hid = 0, seen = 0;
      sl.querySelectorAll('*').forEach(el => {
        if(el.matches('.s-lbl,[data-anim],.draw')){
          seen++;
          if(parseFloat(getComputedStyle(el).opacity) < 0.5) hid++;
        }
        if(el.closest('svg')) return;          /* 변형 중인 도형은 기하 잡음이 된다 */
        const b = el.getBoundingClientRect();
        if(!b.width && !b.height) return;
        const d = Math.max(b.bottom - r.bottom, b.right - r.right, r.top - b.top, r.left - b.left);
        if(d > worst){ worst = d; who = el.tagName + '.' + (el.className || '').toString().slice(0, 26); }
      });
      if(parseFloat(getComputedStyle(sl).opacity) < 0.5) hid = Math.max(hid, 1);
      return { worst: Math.round(worst), who, hid, seen };
    }, i);
    rec(tag + ' 슬라이드 ' + (i+1) + ' 여백 내 배치', ov.worst <= 2,
        ov.worst > 2 ? ('+' + ov.worst + 'px ' + ov.who) : '');
    seenAll += ov.seen;
    if(ov.hid > hidMax){ hidMax = ov.hid; hidWhere = (i+1) + '장'; }
  }
  rec(tag + ' 18장 전체 내용이 화면에 보임', hidMax === 0 && seenAll > 100,
      hidMax ? (hidMax + '개 안 보임 @' + hidWhere) : (seenAll + '개 요소 확인'));
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--allow-file-access-from-files', '--force-device-scale-factor=1'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    page.on('console', m => {
      if(m.type() === 'error' && !netNoise.test(m.text())) errs.push('console: ' + m.text());
    });
    await page.goto(FILE, { waitUntil: 'networkidle2' });
    await sleep(900);

    const total = await page.$$eval('.slide', n => n.length);
    rec('슬라이드 ' + SLIDES + '장', total === SLIDES, 'found ' + total);
    if(total !== SLIDES){
      /* process.exit() 을 쓰면 아래 finally 가 건너뛰어진다 (예외가 아니라 즉시 종료라
         스택이 풀리지 않는다). 지금은 puppeteer 자체 exit 훅 덕에 브라우저가 정리되지만,
         그 finally 에 다른 정리 코드가 추가되는 순간 조용히 누락된다.
         exitCode 를 세우고 return 하면 finally 가 정상으로 돈다 — 그냥 return 하면 0 으로 끝난다. */
      console.error('\n장표 수가 ' + SLIDES + '이 아닙니다 (' + total + '). SLIDES 상수를 맞추세요.');
      process.exitCode = 1;
      return;
    }
    rec('시작 시 활성 1장', (await page.$$eval('.slide.active', n => n.length)) === 1);

    /* ── 화살표 한 번에 한 장 ─────────────────────────────── */
    const seq = [];
    for(let i = 0; i < SLIDES - 1; i++){
      await page.keyboard.press('ArrowRight'); await sleep(120);
      seq.push(await idx(page));
    }
    rec('→ 1회 = 1장 전진',
        JSON.stringify(seq) === JSON.stringify([...Array(SLIDES-1)].map((_, i) => i+1)), seq.join(','));

    await page.keyboard.press('ArrowRight'); await sleep(120);
    rec('마지막에서 더 안 넘어감', (await idx(page)) === SLIDES - 1);
    await page.keyboard.press('ArrowLeft'); await sleep(120);
    rec('← 1회 = 1장 후진', (await idx(page)) === SLIDES - 2);

    await page.keyboard.press('Home'); await sleep(450);
    await page.keyboard.press('ArrowLeft'); await sleep(200);
    await page.keyboard.press('PageUp');    await sleep(200);
    const atFirst = await idx(page);
    rec('첫 장에서 더 안 넘어감', atFirst === 0, 'idx=' + atFirst);

    /* ── 뒤로 넘겨도 활성 장표가 제자리에 있어야 한다 ─────────
       body.rev 규칙이 .slide.active 를 이겨 34px 밀리던 회귀를 잡는다. */
    for(let i = 0; i < 4; i++){ await page.keyboard.press('ArrowRight'); await sleep(110); }
    const offs = [];
    for(let i = 0; i < 3; i++){
      await page.keyboard.press('ArrowLeft'); await sleep(520);
      offs.push(await page.evaluate(() => getComputedStyle(document.querySelector('.slide.active')).transform));
    }
    rec('뒤로 이동 후 활성 장표 정렬 유지', offs.every(NONE), offs.join(' | '));

    /* ── 역방향 상태에서 인쇄해도 밀리지 않아야 한다 ──────────
       전제(body.rev)를 먼저 확인한다. 앞 단계가 바뀌어 rev 가 꺼지면
       인쇄 규칙은 싸울 상대가 없어지고, 이 검사는 영원히 헛돈다. */
    rec('인쇄 검증 전제: 역방향 상태', await isRev(page));
    await page.emulateMediaType('print'); await sleep(900);
    const printT = await page.$$eval('.slide', ns => [...new Set(ns.map(n => getComputedStyle(n).transform))]);
    rec('역방향 상태에서 인쇄 시 정렬 유지', printT.every(NONE), printT.join(' | '));
    /* 인쇄 규칙에 .s-lbl 이 빠져 PDF 에서 도형 글자가 전부 사라진 적이 있다.
       활성 장표만 애니메이션이 끝나 보였고 나머지 17장은 opacity:0 그대로였다. */
    const pHid = await page.evaluate(() => {
      let hid = 0, tot = 0;
      document.querySelectorAll('.slide .s-lbl, .slide [data-anim], .slide .draw').forEach(e => {
        tot++; if(parseFloat(getComputedStyle(e).opacity) < 0.5) hid++;
      });
      return { hid, tot };
    });
    rec('인쇄 시 도형 글자·요소가 모두 보임', pHid.hid === 0 && pHid.tot > 50,
        pHid.hid + '/' + pHid.tot + ' 안 보임');
    /* 전환 중(leaving)에 인쇄하면 장표가 통째로 투명해지던 경로.
       자식들은 opacity 1 이라 위 검사로는 안 잡힌다 — 컨테이너를 직접 본다. */
    const lv = await page.evaluate(() => {
      const sl = document.querySelectorAll('.slide')[4];
      sl.classList.add('leaving');
      const op = getComputedStyle(sl).opacity;
      sl.classList.remove('leaving');
      return op;
    });
    rec('인쇄 시 전환 중인 장표도 보임', parseFloat(lv) === 1, 'opacity=' + lv);
    await page.emulateMediaType('screen'); await sleep(200);

    /* 모션 감소 설정에서 animation-delay 가 남아 최대 1.4초 동안 내용이 비어 있었다.
       지연 중에는 fill-mode:both 가 from(opacity:0) 을 잡아 선언적 opacity 로는 못 이긴다. */
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    let rmWorst = 0, rmWhere = '';
    for(const i of [3, 9, 12]){
      await page.evaluate(n => {
        const s = [...document.querySelectorAll('.slide')];
        s.forEach(x => x.classList.remove('active','leaving'));
        s[n].classList.add('active');
      }, i);
      await sleep(120);                      /* 지연이 남아 있으면 아직 안 보일 시점 */
      const h = await page.evaluate(n => {
        const sl = [...document.querySelectorAll('.slide')][n];
        const a = [...sl.querySelectorAll('.s-lbl,[data-anim],.draw')];
        return a.filter(e => parseFloat(getComputedStyle(e).opacity) < 0.5).length;
      }, i);
      if(h > rmWorst){ rmWorst = h; rmWhere = (i+1) + '장'; }
    }
    rec('모션 감소 설정에서 즉시 내용이 보임', rmWorst === 0, rmWorst ? (rmWorst + '개 안 보임 @' + rmWhere) : '');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    /* 위 블록은 goTo 를 우회해 클래스를 직접 바꿨다. 스크립트의 cur 가 DOM 과
       어긋나 .active 가 둘이 될 수 있으므로 다시 읽어 양쪽을 초기화한다. */
    await page.goto(FILE, { waitUntil: 'networkidle2' });
    await sleep(900);
    rec('상태 초기화 후 활성 1장',
        (await page.$$eval('.slide.active', n => n.length)) === 1 && (await idx(page)) === 0);

    /* ── 목차 패널 번호 입력 ──────────────────────────────── */
    await page.keyboard.press('Home'); await sleep(450);
    await page.keyboard.press('KeyO'); await sleep(250);
    await page.keyboard.press('Digit1'); await sleep(120);
    await page.keyboard.press('Digit3'); await sleep(700);
    const j13 = { at: await idx(page), ...(await panel(page)) };
    rec('목차에서 13 입력 → 13장', j13.at === 12 && !j13.open, JSON.stringify(j13));

    await page.keyboard.press('KeyO'); await sleep(250);
    await page.keyboard.press('Digit5'); await sleep(350);
    const j5 = { at: await idx(page), ...(await panel(page)) };
    rec('목차에서 5 입력 → 즉시 5장', j5.at === 4 && !j5.open, JSON.stringify(j5));

    /* 범위 초과 거부(n > total)는 장표가 19장인 지금 도달할 수 없다 —
       한 자리 1~9 도, 두 자리 10~19 도 모두 유효 번호다. 장표 수가 줄면 다시 살아나는
       방어 코드이므로 남겨 두고, 여기서는 실제로 닿는 거부 경로 둘을 고정한다. */
    const gBefore = await idx(page);
    await page.keyboard.press('KeyO'); await sleep(250);
    await page.keyboard.press('Digit0'); await sleep(250);          /* 앞자리 0 은 무시 */
    const g0 = await panel(page);
    rec('앞자리 0 은 번호로 받지 않음',
        g0.open && g0.hint === '' && (await idx(page)) === gBefore, JSON.stringify(g0));
    await page.keyboard.press('Enter'); await sleep(350);           /* 빈 버퍼로 확정 */
    const gE = { at: await idx(page), ...(await panel(page)) };
    rec('빈 번호로 확정해도 이동하지 않음',
        gE.at === gBefore && gE.open, JSON.stringify(gE));
    await page.keyboard.press('Escape'); await sleep(250);

    /* ── 번호를 입력하다 다른 키를 누르면 잔류 이동이 없어야 한다 ──
       0.9초 타이머가 살아남아 발표 도중 표지로 튀던 회귀를 잡는다.
       before 는 항상 5 이므로 Home 행의 -5 가 성립한다. */
    async function abandon(key){
      await page.keyboard.press('Home'); await sleep(450);
      for(let i = 0; i < 5; i++){ await page.keyboard.press('ArrowRight'); await sleep(110); }
      const before = await idx(page);
      await page.keyboard.press('KeyO'); await sleep(220);
      await page.keyboard.press('Digit1'); await sleep(120);
      await page.keyboard.press(key); await sleep(1400);   /* 900ms 타이머보다 넉넉히 */
      return { before, after: await idx(page), ...(await panel(page)) };
    }
    for(const [key, move, stayOpen] of [
      ['ArrowRight', 1, false],   /* 리모컨 다음 */
      ['PageDown',   1, false],   /* 무선 프리젠터가 보내는 키 */
      ['ArrowLeft', -1, false],
      ['Home',      -5, false],
      ['Escape',     0, false],   /* 닫기 경로에 재열림 순서 버그가 없는지 */
      ['KeyO',       0, false],   /* 토글 경로도 마찬가지 */
      ['KeyT',       0, true ],   /* 이동 아닌 키는 패널을 닫지 않는다 */
      ['KeyQ',       0, true ],   /* 아예 처리되지 않는 키도 타이머를 죽여야 한다 */
    ]){
      const r = await abandon(key);
      rec('번호 입력 중 ' + key + ' → 잔류 이동 없음',
          r.after === r.before + move && r.open === stayOpen && r.hint === '', JSON.stringify(r));
      if(r.open){ await page.keyboard.press('Escape'); await sleep(200); }
    }

    /* Backspace 는 동작 자체를 고정할 뿐, 그 안의 clearTimeout 을 지키지는 못한다.
       total=18 에서는 두 자리 버퍼가 항상 즉시 확정되어 타이머가 남지 않고,
       한 자리를 지우면 parseInt('') → NaN 이라 어차피 이동하지 않기 때문이다. */
    await page.keyboard.press('Home'); await sleep(450);
    await page.keyboard.press('KeyO'); await sleep(220);
    await page.keyboard.press('Digit1'); await sleep(120);
    await page.keyboard.press('Backspace'); await sleep(1400);
    const bs = { at: await idx(page), ...(await panel(page)) };
    rec('번호 지운 뒤 잔류 이동 없음', bs.at === 0 && bs.open && bs.hint === '', JSON.stringify(bs));
    await page.keyboard.press('Escape'); await sleep(250);

    /* ── 쪽번호 · 선 길이 ─────────────────────────────────── */
    await page.keyboard.press('Home'); await sleep(400);
    const foot = await page.evaluate(() =>
      document.querySelectorAll('.slide')[2].querySelector('.foot .r').textContent);
    rec('쪽번호 표기', foot === '3 / ' + SLIDES, foot);
    /* 빈 값·0 뿐 아니라 NaN 도 걸러야 한다 */
    const bad = await page.$$eval('.draw', ns =>
      ns.map(n => n.style.getPropertyValue('--len')).filter(v => !(parseFloat(v) > 0)).length);
    rec('모든 선 길이 계산됨', bad === 0, bad + ' 개 미계산');

    await overflowSweep(page, '배치');           /* 이 페이지의 마지막 단계 */
    rec('콘솔 오류 없음', errs.length === 0, errs.slice(0, 3).join(' | '));

    /* ── 오프라인 (학회장에 인터넷이 없을 때) ─────────────────
       웹폰트를 못 받아도 오류 없이 같은 배치가 나와야 한다.
       주의: 이 검사는 '외부 의존성이 없다' 를 고정할 뿐,
       Noto Serif KR 이 설치된 기계에서는 대체 글꼴 차이를 드러내지 못한다. */
    const off = await browser.newPage();
    await off.setViewport({ width: 1440, height: 900 });
    const offErrs = [];
    off.on('pageerror', e => offErrs.push('pageerror: ' + e.message));
    off.on('console', m => {
      if(m.type() === 'error' && !netNoise.test(m.text())) offErrs.push('console: ' + m.text());
    });
    await off.setRequestInterception(true);
    let blocked = 0;
    off.on('request', r => { if(/^https?:/i.test(r.url())){ blocked++; r.abort(); } else r.continue(); });
    await off.goto(FILE, { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    rec('오프라인: 외부 요청 차단됨', blocked > 0, blocked + '건');
    rec('오프라인: 슬라이드 ' + SLIDES + '장', (await off.$$eval('.slide', n => n.length)) === SLIDES);
    await overflowSweep(off, '오프라인');
    rec('오프라인: 콘솔 오류 없음', offErrs.length === 0, offErrs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }

  const pass = results.filter(r => r.pass).length;
  console.log('\n== 결과: ' + pass + '/' + results.length + ' 통과 ==');
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
