#!/usr/bin/env node
/* Verification of ai/index.html (「기억에서 데이터로」 AI 활용 성과발표 장표)
 *
 * 발표 중에 실제로 일어나는 조작을 재현한다: 화살표로 넘기기, 대본 열기,
 * 녹화 영상 열고 닫기, 영상 파일이 아직 없는 상태.
 *
 *   node build/test_ai_deck.js [경로]
 *
 * 종료 코드: 0 = 통과, 1 = 장표에 결함, 2 = 테스트 자체가 깨짐 */
const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE = 'file://' + path.resolve(process.argv[2] ||
  path.join(__dirname, '..', 'ai', 'index.html'));
const SLIDES = 16;
const LIMIT = 15 * 60;                 /* 발표 시간 15분 */

const results = [];
function rec(name, pass, detail){
  results.push({ name, pass, detail: detail || '' });
  console.log((pass ? '  \x1b[32mPASS\x1b[0m ' : '  \x1b[31mFAIL\x1b[0m ') + name + (detail ? ('  — ' + detail) : ''));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const idx = page => page.evaluate(() => window.__deck.cur());
/* 영상 파일이 아직 없어서 나는 404 와 끊긴 네트워크 잡음은 장표의 결함이 아니다.
 * 진짜 오류는 page.on('pageerror') 로 들어오며 여기서 걸러지지 않는다. */
const netNoise = /net::ERR_|Failed to load resource/i;

/* 등장 모션이 끝날 때까지 기다린다. 흐르는 점·깜빡이는 점처럼 영원히 도는 모션은 제외. */
async function settle(page, i){
  await page.waitForFunction(n => {
    const sl = document.querySelectorAll('.slide')[n];
    return [...sl.getAnimations({ subtree: true })].every(a =>
      a.playState !== 'running' || a.effect.getTiming().iterations === Infinity);
  }, { timeout: 12000 }, i);
  await sleep(80);
}

/* 한 장씩 활성화해 두 가지를 잰다:
 * (1) 무대(1920×1080) 밖으로 나간 요소 — 기하 검사
 * (2) 모션이 끝난 뒤에도 투명한 요소 — 기하 검사는 opacity 를 못 본다 */
async function sweep(page, tag){
  let hidMax = 0, hidWhere = '', seenAll = 0;
  for(let i = 0; i < SLIDES; i++){
    await page.evaluate(n => window.__deck.goTo(n), i);
    await settle(page, i);
    const r = await page.evaluate(n => {
      const sl = document.querySelectorAll('.slide')[n], box = sl.getBoundingClientRect();
      let worst = 0, who = '', hid = 0, seen = 0, hidWho = '';
      sl.querySelectorAll('*').forEach(el => {
        if(el.matches('[data-a],.g-in,.g-up,.gn')){
          seen++;
          if(parseFloat(getComputedStyle(el).opacity) < 0.5){ hid++; hidWho = el.tagName + '.' + (el.getAttribute('class') || ''); }
        }
        /* 흐르는 띠는 일부러 넓고 .marquee 의 overflow:hidden 으로 잘린다 */
        if(el.closest('svg') || el.closest('aside.note') || el.closest('.marquee .track')) return;
        const b = el.getBoundingClientRect();
        if(!b.width && !b.height) return;
        const d = Math.max(b.bottom - box.bottom, b.right - box.right, box.top - b.top, box.left - b.left);
        if(d > worst){ worst = d; who = el.tagName + '.' + (el.className || '').toString().slice(0, 30); }
      });
      /* SVG 는 viewBox 가 figure 안에 맞춰지므로 svg 요소 자체만 무대 안에 있으면 된다 */
      sl.querySelectorAll('svg').forEach(s => {
        const b = s.getBoundingClientRect();
        const d = Math.max(b.bottom - box.bottom, b.right - box.right, box.top - b.top, box.left - b.left);
        if(d > worst){ worst = d; who = 'svg'; }
      });
      return { worst: Math.round(worst), who, hid, seen, hidWho };
    }, i);
    rec(tag + ' ' + (i + 1) + '장 무대 안 배치', r.worst <= 2, r.worst > 2 ? ('+' + r.worst + 'px ' + r.who) : '');
    seenAll += r.seen;
    if(r.hid > hidMax){ hidMax = r.hid; hidWhere = (i + 1) + '장 ' + r.hidWho; }
  }
  rec(tag + ' 모션이 끝나면 모든 요소가 보임', hidMax === 0 && seenAll > 150,
      hidMax ? (hidMax + '개 안 보임 @' + hidWhere) : (seenAll + '개 요소 확인'));
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--allow-file-access-from-files', '--force-device-scale-factor=1', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    page.on('console', m => { if(m.type() === 'error' && !netNoise.test(m.text())) errs.push('console: ' + m.text()); });
    await page.goto(FILE, { waitUntil: 'networkidle2' });
    await sleep(600);

    const total = await page.$$eval('.slide', n => n.length);
    rec('슬라이드 ' + SLIDES + '장', total === SLIDES, 'found ' + total);
    if(total !== SLIDES){ console.error('\nSLIDES 상수를 맞추세요.'); process.exitCode = 1; return; }
    rec('시작 시 활성 1장', (await page.$$eval('.slide.active', n => n.length)) === 1);

    /* ── 화살표 한 번에 한 장 ── */
    const seq = [];
    for(let i = 0; i < SLIDES - 1; i++){ await page.keyboard.press('ArrowRight'); await sleep(90); seq.push(await idx(page)); }
    rec('→ 1회 = 1장 전진', JSON.stringify(seq) === JSON.stringify([...Array(SLIDES - 1)].map((_, i) => i + 1)), seq.join(','));
    await page.keyboard.press('ArrowRight'); await sleep(90);
    rec('마지막에서 더 안 넘어감', (await idx(page)) === SLIDES - 1);
    await page.keyboard.press('ArrowLeft'); await sleep(90);
    rec('← 1회 = 1장 후진', (await idx(page)) === SLIDES - 2);
    await page.keyboard.press('Home'); await sleep(90);
    await page.keyboard.press('ArrowLeft'); await sleep(90);
    rec('첫 장에서 더 안 넘어감', (await idx(page)) === 0);
    for(const k of ['Space', 'PageDown', 'Enter']){
      const before = await idx(page);
      await page.keyboard.press(k); await sleep(90);
      rec(k + ' 도 한 장 전진', (await idx(page)) === before + 1);
    }
    /* 키를 누르고 있으면(자동 반복) 여러 장이 넘어가면 안 된다 */
    await page.keyboard.press('Home'); await sleep(90);
    await page.keyboard.down('ArrowRight'); await sleep(40);
    for(let i = 0; i < 4; i++){ await page.keyboard.down('ArrowRight', { autoRepeat: true }); await sleep(30); }
    await page.keyboard.up('ArrowRight'); await sleep(90);
    rec('키를 누르고 있어도 한 장만', (await idx(page)) === 1, 'idx=' + await idx(page));

    /* ── 쪽 번호 ── */
    const foots = await page.$$eval('.slide', ss => ss.map((s, i) => { const r = s.querySelector('.foot .r'); return !r || r.textContent === String(i + 1).padStart(2, '0') + ' / ' + ss.length; }));
    rec('쪽 번호가 실제 순서와 일치', foots.every(Boolean));

    /* ── 영상 자리: 파일이 없으면 자리 표시 ── */
    await page.keyboard.press('Home'); await sleep(700);
    const v1 = await page.evaluate(() => ({ vid: document.body.classList.contains('vid'),
      ph: document.querySelector('.vph[data-for="intro"]').classList.contains('on'),
      phOut: document.querySelector('.vph[data-for="outro"]').classList.contains('on') }));
    rec('인트로: 영상 층 켜짐, 파일 없으면 자리 표시', v1.vid && v1.ph && !v1.phOut, JSON.stringify(v1));
    await page.keyboard.press('ArrowRight'); await sleep(700);
    rec('다음 장으로 가면 영상 층 꺼짐', !(await page.evaluate(() => document.body.classList.contains('vid'))));
    await page.keyboard.press('End'); await sleep(700);
    const v2 = await page.evaluate(() => document.querySelector('.vph[data-for="outro"]').classList.contains('on'));
    rec('아웃트로 자리 표시', v2);

    /* ── 대본 ── */
    await page.evaluate(() => window.__deck.goTo(4)); await sleep(200);
    await page.keyboard.press('KeyN'); await sleep(150);
    const nt = await page.evaluate(() => ({ on: getComputedStyle(document.getElementById('notes')).display !== 'none',
      txt: document.querySelector('#notes .txt').textContent.trim().length, top: document.querySelector('#notes .top').textContent }));
    rec('N: 대본 표시', nt.on && nt.txt > 40, nt.top);
    await page.keyboard.press('ArrowRight'); await sleep(150);
    const nt2 = await page.evaluate(() => document.querySelector('#notes .top b').textContent);
    rec('넘기면 대본도 따라감', nt2.startsWith('06'), nt2);
    await page.keyboard.press('KeyN'); await sleep(150);
    rec('N 다시: 대본 숨김', await page.evaluate(() => getComputedStyle(document.getElementById('notes')).display === 'none'));
    const plan = await page.evaluate(() => window.__deck.planTotal);
    rec('계획 시간 합계 ≤ 15:00', plan <= LIMIT, Math.floor(plan / 60) + ':' + String(plan % 60).padStart(2, '0'));
    const noNote = await page.$$eval('.slide', ss => ss.map((s, i) => s.querySelector('aside.note[data-t]') ? 0 : i + 1).filter(Boolean));
    rec('모든 장에 대본과 시간', noNote.length === 0, noNote.join(','));

    /* ── 녹화 영상 ── */
    await page.evaluate(() => window.__deck.goTo(4)); await sleep(1500);
    await page.click('.slide.active [data-demo]'); await sleep(700);
    const dm = await page.evaluate(() => ({ on: document.getElementById('demo').classList.contains('on'),
      miss: document.getElementById('demo').classList.contains('missing') }));
    rec('녹화 영상 버튼: 창 열림 (파일 없으면 안내)', dm.on && dm.miss, JSON.stringify(dm));
    await page.keyboard.press('ArrowRight'); await sleep(120);
    rec('영상 창이 열려 있으면 장이 안 넘어감', (await idx(page)) === 4);
    await page.keyboard.press('Escape'); await sleep(120);
    rec('Esc: 영상 창 닫힘', !(await page.evaluate(() => document.getElementById('demo').classList.contains('on'))));
    await page.keyboard.press('KeyV'); await sleep(300);
    rec('V: 이 장의 녹화 영상 열기', await page.evaluate(() => document.getElementById('demo').classList.contains('on')));
    await page.keyboard.press('Space'); await sleep(200);      /* 파일 없을 때 재생 시도 — 오류가 나면 마지막 검사에서 걸린다 */
    await page.keyboard.press('Escape'); await sleep(120);
    /* 대본 키를 누르고 있어도 한 번만 켜져야 한다 */
    await page.keyboard.down('KeyN'); await sleep(30);
    for(let i = 0; i < 3; i++){ await page.keyboard.down('KeyN', { autoRepeat: true }); await sleep(30); }
    await page.keyboard.up('KeyN'); await sleep(120);
    rec('N 을 누르고 있어도 대본은 한 번만 켜짐', await page.evaluate(() => document.body.classList.contains('notes')));
    const keep = await page.evaluate(() => { const t = document.querySelector('#notes .txt'); const f = t.firstChild; return new Promise(r => setTimeout(() => r(t.firstChild === f), 1300)); });
    rec('대본 본문은 매초 다시 쓰지 않음', keep);
    await page.keyboard.press('KeyN'); await sleep(120);

    /* ── 링크 ── */
    const links = await page.$$eval('#stage a[href]', as => as.map(a => ({ h: a.href, t: a.target, r: a.rel })));
    const bad = links.filter(l => !/^https:\/\//.test(l.h) || l.t !== '_blank' || !/noopener/.test(l.r));
    rec('라이브 링크 ' + links.length + '개 모두 https · 새 탭 · noopener', links.length >= 20 && bad.length === 0, bad.map(b => b.h).join(' '));
    const demos = await page.$$eval('[data-demo]', bs => bs.map(b => b.getAttribute('data-demo')));
    rec('프로젝트 장마다 녹화 영상 버튼', ['media/demo-te.mp4', 'media/demo-tools.mp4', 'media/demo-brain.mp4', 'media/demo-claw.mp4'].every(d => demos.includes(d)), demos.join(','));

    /* ── 링크를 누른 뒤 Space 가 링크를 다시 열지 않아야 한다 ── */
    await page.evaluate(() => window.__deck.goTo(5)); await sleep(1500);
    /* 스크립트 click() 은 포커스를 옮기지 않으므로 먼저 focus() 로 실제 클릭 뒤 상태를 만든다 */
    await page.evaluate(() => { const a = document.querySelector('.slide.active a.card'); a.addEventListener('click', e => e.preventDefault(), { once: true }); a.focus(); a.click(); });
    await sleep(50);
    const focusLeft = await page.evaluate(() => document.activeElement && document.activeElement.tagName);
    rec('링크 클릭 뒤 포커스가 남지 않음', focusLeft !== 'A', focusLeft);

    /* ── 배치 · 표시 ── */
    await sweep(page, '[1920]');
    await page.setViewport({ width: 1440, height: 900 }); await sleep(300);
    const fit = await page.evaluate(() => { const b = document.getElementById('stage').getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), l: Math.round(b.left), t: Math.round(b.top) }; });
    rec('1440×900 에서 무대가 화면에 맞음', fit.w <= 1440 && fit.h <= 900 && fit.l >= 0 && fit.t >= 0, JSON.stringify(fit));
    await page.setViewport({ width: 1280, height: 1024 }); await sleep(300);
    const fit2 = await page.evaluate(() => { const b = document.getElementById('stage').getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), t: Math.round(b.top) }; });
    rec('5:4 화면(1280×1024)에서도 잘리지 않음', fit2.w <= 1280 && fit2.h <= 1024 && fit2.t >= 0, JSON.stringify(fit2));

    /* ── 모션 감소 설정: 모든 요소가 처음부터 보여야 한다 ── */
    const p2 = await browser.newPage();
    await p2.setViewport({ width: 1920, height: 1080 });
    await p2.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await p2.goto(FILE, { waitUntil: 'networkidle2' });
    let rmHid = 0, rmWhere = '';
    for(let i = 0; i < SLIDES; i++){
      await p2.evaluate(n => window.__deck.goTo(n), i); await sleep(60);
      const h = await p2.evaluate(n => [...document.querySelectorAll('.slide')[n].querySelectorAll('[data-a],.g-in,.g-up,.gn')]
        .filter(el => parseFloat(getComputedStyle(el).opacity) < 0.5).length, i);
      if(h > rmHid){ rmHid = h; rmWhere = (i + 1) + '장'; }
    }
    rec('모션 감소: 즉시 모두 보임', rmHid === 0, rmHid ? (rmHid + '개 @' + rmWhere) : '');
    const rmCount = await p2.evaluate(() => { window.__deck.goTo(3); return document.querySelector('.slide.active [data-count="607"]').textContent; });
    rec('모션 감소: 숫자는 최종값', rmCount === '607', rmCount);
    await p2.close();

    rec('스크립트 오류 없음', errs.length === 0, errs.join(' | '));
  } catch(e){
    console.error(e); process.exitCode = 2; return;
  } finally {
    await browser.close();
  }
  const fail = results.filter(r => !r.pass).length;
  console.log('\n' + (results.length - fail) + ' / ' + results.length + ' 통과');
  if(fail && process.exitCode === undefined) process.exitCode = 1;
})();
