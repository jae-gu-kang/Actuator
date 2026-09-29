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
    /* [data-loop] 안은 계속 도는 재생(전환이 끝없이 새로 생김)이라 기다릴 대상이 아니다 */
    return [...sl.getAnimations({ subtree: true })].every(a =>
      a.playState !== 'running' || a.effect.getTiming().iterations === Infinity ||
      (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition && a.effect.target && a.effect.target.closest && a.effect.target.closest('[data-loop]')));
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
    /* 아웃트로 장(끝에서 두 번째)은 들어와서 한 번 멈춘다 — 그다음 → 는 넘기지 않고 영상을 튼다 */
    /* 인트로(0)는 첫 → 에 이름만 띄우고 머문다. 아웃트로 장(끝에서 두 번째)은 들어와서 한 번 멈춘다 */
    const expect = [0].concat([...Array(SLIDES - 2)].map((_, i) => i + 1));
    rec('→ 1회 = 1장 전진 (인트로는 이름 먼저, 아웃트로는 한 번 더 눌러 재생)', JSON.stringify(seq) === JSON.stringify(expect), seq.join(','));
    await page.keyboard.press('ArrowRight'); await sleep(90);          /* 대기 중인 아웃트로: 이름 */
    await page.keyboard.press('ArrowRight'); await sleep(90);          /* 재생 */
    await page.keyboard.press('ArrowRight'); await sleep(90);          /* 재생 중인 아웃트로 → 마지막 장 */
    rec('아웃트로 재생 중 → : 마지막 장', (await idx(page)) === SLIDES - 1);
    await page.keyboard.press('ArrowRight'); await sleep(90);          /* 마지막 장에서 한 번 더 */
    rec('마지막에서 더 안 넘어감', (await idx(page)) === SLIDES - 1);
    await page.keyboard.press('ArrowLeft'); await sleep(90);
    rec('← 1회 = 1장 후진', (await idx(page)) === SLIDES - 2);
    await page.keyboard.press('Home'); await sleep(90);
    await page.keyboard.press('ArrowLeft'); await sleep(90);
    rec('첫 장에서 더 안 넘어감', (await idx(page)) === 0);
    await page.evaluate(() => window.__deck.goTo(1)); await sleep(90);
    for(const k of ['Space', 'PageDown', 'Enter']){
      const before = await idx(page);
      await page.keyboard.press(k); await sleep(90);
      rec(k + ' 도 한 장 전진', (await idx(page)) === before + 1);
    }
    /* 키를 누르고 있으면(자동 반복) 여러 장이 넘어가면 안 된다 */
    await page.evaluate(() => window.__deck.goTo(1)); await sleep(90);
    await page.keyboard.down('ArrowRight'); await sleep(40);
    for(let i = 0; i < 4; i++){ await page.keyboard.down('ArrowRight', { autoRepeat: true }); await sleep(30); }
    await page.keyboard.up('ArrowRight'); await sleep(90);
    rec('키를 누르고 있어도 한 장만', (await idx(page)) === 2, 'idx=' + await idx(page));

    /* ── 인트로: 넘기면 이름만 먼저, 잠시 뒤 표지로 자동 ── */
    await page.keyboard.press('Home'); await sleep(300);
    await page.keyboard.press('ArrowRight'); await sleep(1000);
    const nm = await page.evaluate(() => { const s = document.querySelectorAll('.slide')[0], n = s.querySelector('.intro-name');
      return { cur: window.__deck.cur(), named: s.classList.contains('named'), op: +getComputedStyle(n).opacity, name: n.textContent, vid: document.body.classList.contains('vid') }; });
    rec('인트로에서 넘기면 영상 위에 이름만 먼저', nm.cur === 0 && nm.named && nm.op > .9 && /강재구/.test(nm.name) && nm.vid, JSON.stringify(nm));
    await sleep(1500);
    const nm2 = await page.evaluate(() => ({ cur: window.__deck.cur(), named: document.querySelectorAll('.slide')[0].classList.contains('named') }));
    rec('잠시 뒤 표지로 자동으로 넘어감', nm2.cur === 1 && !nm2.named, JSON.stringify(nm2));
    await page.keyboard.press('ArrowLeft'); await sleep(200);
    await page.keyboard.press('ArrowRight'); await sleep(150); await page.keyboard.press('ArrowRight'); await sleep(200);
    rec('이름이 떠 있을 때 한 번 더 누르면 바로 표지', (await idx(page)) === 1);
    await sleep(2400);
    rec('바로 넘긴 뒤 남은 타이머가 한 장 더 넘기지 않음', (await idx(page)) === 1);
    await page.keyboard.press('ArrowLeft'); await sleep(200);
    await page.keyboard.press('ArrowRight'); await sleep(300); await page.keyboard.press('ArrowLeft'); await sleep(2400);
    const cancel = await page.evaluate(() => ({ cur: window.__deck.cur(), named: document.querySelectorAll('.slide')[0].classList.contains('named') }));
    rec('이름이 뜬 뒤 ← : 이름을 거두고 자동 넘김 취소', cancel.cur === 0 && !cancel.named, JSON.stringify(cancel));
    await page.keyboard.press('ArrowRight'); await sleep(300); await page.keyboard.press('Home'); await sleep(2400);
    rec('이름이 뜬 뒤 Home : 초기화하고 자동 넘김 취소', await page.evaluate(() => window.__deck.cur() === 0 && !document.querySelectorAll('.slide')[0].classList.contains('named')));
    await page.keyboard.press('ArrowRight'); await sleep(300); await page.keyboard.press('KeyP'); await sleep(2400);
    rec('이름이 뜬 뒤 QR 창을 열면 자동 넘김 멈춤', await page.evaluate(() => window.__deck.cur() === 0));
    await page.keyboard.press('Escape'); await sleep(200);

    /* ── 발표 리모컨: PageDown/PageUp · F5 · B/. ── */
    await page.evaluate(() => window.__deck.goTo(3)); await sleep(100);
    await page.keyboard.press('PageDown'); await sleep(90);
    await page.keyboard.press('PageUp'); await sleep(90);
    rec('리모컨 다음/이전(PageDown/PageUp)', (await idx(page)) === 3);
    const f5 = await page.evaluate(() => { const e = new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true }); document.dispatchEvent(e); return e.defaultPrevented; });
    rec('리모컨 슬라이드쇼(F5): 새로 고침 막고 전체 화면으로', f5);
    await page.keyboard.press('KeyB'); await sleep(90);
    const bk = await page.evaluate(() => { const b = document.getElementById('blackout'); return b && getComputedStyle(b).display === 'block'; });
    await page.keyboard.press('PageDown'); await sleep(90);
    const bk2 = await page.evaluate(() => ({ black: getComputedStyle(document.getElementById('blackout')).display === 'block', cur: window.__deck.cur() }));
    rec('리모컨 화면 가리기(B): 검은 화면, 넘기기 키는 화면만 되돌림', bk && !bk2.black && bk2.cur === 3, JSON.stringify({ bk, bk2 }));
    await page.keyboard.press('Period'); await sleep(90); await page.keyboard.press('Period'); await sleep(90);
    rec('리모컨 화면 가리기(.): 켜고 끔', await page.evaluate(() => getComputedStyle(document.getElementById('blackout')).display === 'none' && window.__deck.cur() === 3));

    /* ── 쪽 번호 ── */
    const foots = await page.$$eval('.slide', ss => ss.map((s, i) => { const r = s.querySelector('.foot .r'); return !r || r.textContent === String(i + 1).padStart(2, '0') + ' / ' + ss.length; }));
    rec('쪽 번호가 실제 순서와 일치', foots.every(Boolean));

    /* ── 인트로: 소리 없이 반복 재생 ── */
    await page.keyboard.press('Home'); await sleep(1200);
    const v1 = await page.evaluate(() => { const v = document.getElementById('v-intro'); return {
      vid: document.body.classList.contains('vid'), on: v.classList.contains('on'), playing: !v.paused && v.currentTime > 0,
      loop: v.loop, muted: v.muted, ph: document.querySelector('.vph[data-for="intro"]').classList.contains('on'), w: v.videoWidth }; });
    rec('인트로: 화면 가득 소리 없이 반복 재생', v1.vid && v1.on && v1.playing && v1.loop && v1.muted && !v1.ph && v1.w === 1920, JSON.stringify(v1));
    await page.keyboard.press('ArrowRight'); await sleep(2900);          /* 이름 → 자동으로 표지 */
    const v1b = await page.evaluate(() => ({ vid: document.body.classList.contains('vid'), paused: document.getElementById('v-intro').paused }));
    rec('다음 장으로 가면 영상 층 꺼지고 인트로 멈춤', !v1b.vid && v1b.paused, JSON.stringify(v1b));

    /* ── 아웃트로: 마무리 장 앞, 처음부터 소리와 함께 한 번 → 끝나면 마무리 장 ── */
    const outroIdx = await page.evaluate(() => [...document.querySelectorAll('.slide')].findIndex(s => s.getAttribute('data-video') === 'outro'));
    rec('아웃트로는 마지막 장 바로 앞', outroIdx === SLIDES - 2, 'idx=' + outroIdx);
    await page.evaluate(n => window.__deck.goTo(n - 1), outroIdx); await sleep(300);
    await page.keyboard.press('ArrowRight'); await sleep(800);
    const v2a = await page.evaluate(() => { const v = document.getElementById('v-outro'); return {
      cur: window.__deck.cur(), on: v.classList.contains('on'), paused: v.paused, t: +v.currentTime.toFixed(2) }; });
    rec('아웃트로 장으로 넘어가면 첫 장면에서 대기', v2a.cur === outroIdx && v2a.on && v2a.paused && v2a.t === 0, JSON.stringify(v2a));
    await page.keyboard.press('ArrowRight'); await sleep(1200);
    const onm = await page.evaluate(() => { const s = document.querySelectorAll('.slide')[14], n = s.querySelector('.outro-name'), v = document.getElementById('v-outro');
      return { cur: window.__deck.cur(), named: s.classList.contains('named'), op: +getComputedStyle(n).opacity, paused: v.paused, left: n.getBoundingClientRect().left, bottom: innerHeight - n.getBoundingClientRect().bottom }; });
    rec('아웃트로에서 한 번 넘기면 왼쪽 아래에 이름 (영상은 대기)', onm.cur === 14 && onm.named && onm.op > .9 && onm.paused && onm.left < 200 && onm.bottom < 200, JSON.stringify(onm));
    await page.keyboard.press('ArrowRight'); await sleep(1500);
    rec('한 번 더 넘기면 재생되고 이름은 사라짐', await page.evaluate(() => !document.querySelectorAll('.slide')[14].classList.contains('named')));
    const sgs = () => page.evaluate(() => { const v = document.getElementById('v-outro'), a = document.getElementById('a-outro'); return {
      cur: window.__deck.cur(), vOn: v.classList.contains('on'), vPlaying: !v.paused, vMuted: v.muted, vt: +v.currentTime.toFixed(2),
      sPlaying: !a.paused, st: +a.currentTime.toFixed(2), sd: Math.round(a.duration), loop: v.loop }; });
    const v2 = await sgs();
    rec('한 번 더 넘기면 영상과 노래가 함께 시작 (장은 그대로)', v2.cur === outroIdx && v2.vOn && v2.vPlaying && v2.sPlaying && v2.vMuted && !v2.loop
        && v2.vt > 0 && v2.vt < 3 && Math.abs(v2.st - v2.vt) < .3 && v2.sd === 40, JSON.stringify(v2));
    /* 노래 28.81 s(8마디 첫 박)에서 마무리 장으로 — 영상 끝(29.04) 직전 */
    await page.evaluate(() => { const v = document.getElementById('v-outro'), a = document.getElementById('a-outro'); v.currentTime = 28.3; a.currentTime = 28.3; });
    await page.waitForFunction(n => window.__deck.cur() === n, { timeout: 5000 }, SLIDES - 1).catch(() => {});
    const cutAt = await page.evaluate(() => +document.getElementById('a-outro').currentTime.toFixed(2));
    rec('노래 박자(28.81 s)에 맞춰 마무리 장으로', cutAt >= 28.8 && cutAt < 29.2, 't=' + cutAt);
    const syn = await page.evaluate(() => { const e = document.querySelector('.slide.end');
      const d = sel => parseFloat(getComputedStyle(e.querySelector(sel)).getPropertyValue('--d'));
      return { synced: e.classList.contains('synced'), verse: d('.verse'), lead: d('.lead'), tf: d('.tf') }; });
    rec('마무리 장 글이 박자에 맞춰 나옴 (문장 → 8마디 넷째 박 → 9마디 셋째 박)', syn.synced && syn.verse < 1 && Math.abs(syn.lead - 2.63) < .3 && Math.abs(syn.tf - 5.26) < .3, JSON.stringify(syn));
    await sleep(1500);
    const v3 = await sgs();
    rec('영상 화면은 사라지고 노래는 이어짐', v3.cur === SLIDES - 1 && !(await page.evaluate(() => document.body.classList.contains('vid'))) && v3.sPlaying && v3.st > 29.5, JSON.stringify(v3));
    await page.evaluate(() => { document.getElementById('a-outro').currentTime = 38.9; }); await sleep(480);   /* 헤이 구간 */
    rec('끝부분에 번쩍이는 효과 없음', await page.evaluate(() => { const e = document.querySelector('.slide.end'); return !e.classList.contains('lift') && !e.hasAttribute('data-hey') && window.__deck.cur() === 15; }));
    await page.evaluate(() => { const a = document.getElementById('a-outro'); a.currentTime = a.duration - .3; }); await sleep(1200);
    rec('노래는 약 39초에 페이드로 끝나고 장은 그대로', await page.evaluate(() => document.getElementById('a-outro').ended && window.__deck.cur()) === SLIDES - 1);
    /* 다시 들어오면 처음 장면에서 대기, 노래도 멈추고 처음으로 */
    await page.keyboard.press('ArrowLeft'); await sleep(900);
    const v4 = await sgs();
    rec('아웃트로로 돌아오면 영상 · 노래 모두 처음에서 대기', v4.cur === SLIDES - 2 && v4.vt === 0 && !v4.vPlaying && !v4.sPlaying && v4.st === 0, JSON.stringify(v4));
    await page.keyboard.press('ArrowRight'); await sleep(200); await page.keyboard.press('ArrowRight'); await sleep(900);
    rec('다시 넘기면 처음부터 재생', await page.evaluate(() => { const v = document.getElementById('v-outro'); return !v.paused && v.currentTime > 0 && v.currentTime < 2; }));
    /* 재생 도중 넘기면 마무리 장 — 영상은 멈추고 노래는 이어진다 */
    await page.keyboard.press('ArrowRight'); await sleep(900);
    const v5 = await sgs();
    rec('재생 도중 마무리 장으로 넘겨도 노래는 이어짐', v5.cur === SLIDES - 1 && !v5.vPlaying && v5.sPlaying, JSON.stringify(v5));
    const man = await page.evaluate(() => { const e = document.querySelector('.slide.end'); return { synced: e.classList.contains('synced'), lead: parseFloat(getComputedStyle(e.querySelector('.lead')).getPropertyValue('--d')) }; });
    rec('직접 넘기면 마무리 장은 평소 순서(동기화 없음)', !man.synced && Math.abs(man.lead - 1.2) < .05, JSON.stringify(man));
    /* 노래가 끝나도 장은 그대로 */
    await page.evaluate(() => { const a = document.getElementById('a-outro'); a.currentTime = a.duration - .4; }); await sleep(1200);
    const v5b = await page.evaluate(() => ({ cur: window.__deck.cur(), ended: document.getElementById('a-outro').ended }));
    rec('마무리 장에서 노래가 끝나도 장은 그대로', v5b.cur === SLIDES - 1 && v5b.ended, JSON.stringify(v5b));
    /* 마무리 장에서 다른 장으로 가면 노래 멈춤 */
    await page.keyboard.press('ArrowLeft'); await sleep(300); await page.keyboard.press('ArrowRight'); await sleep(200); await page.keyboard.press('ArrowRight'); await sleep(900);
    await page.keyboard.press('ArrowRight'); await sleep(300);
    await page.keyboard.press('Home'); await sleep(300);
    rec('마무리 장에서 다른 장으로 가면 노래 멈춤', await page.evaluate(() => document.getElementById('a-outro').paused));
    /* 들어오자마자 떠나기 (재생 약속이 아직 안 끝났을 때) */
    await page.evaluate(n => { window.__deck.goTo(n); window.__deck.goTo(n + 1); }, SLIDES - 2); await sleep(900);
    const v6 = await page.evaluate(() => ({ cur: window.__deck.cur(), paused: document.getElementById('v-outro').paused }));
    rec('아웃트로에 들어오자마자 떠나도 영상이 뒤에서 돌지 않음', v6.paused, JSON.stringify(v6));
    /* 소리 재생이 막힌 브라우저(기본 정책)에서 바로 아웃트로로 열면: 소리 없이라도 재생 */
    const ap = await browser.newPage();
    await ap.setViewport({ width: 1280, height: 720 });
    const ctx = ap;  /* 같은 브라우저라 정책 플래그를 공유하므로 play() 를 NotAllowedError 로 막아 흉내 낸다 */
    await ctx.evaluateOnNewDocument(() => {
      const orig = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function(){ if(!this.muted) return Promise.reject(new DOMException('blocked', 'NotAllowedError')); return orig.call(this); };
    });
    await ctx.goto(FILE.replace(/#.*$/, '') + '#' + (SLIDES - 1), { waitUntil: 'networkidle2' }); await sleep(600);
    await ctx.keyboard.press('ArrowRight'); await sleep(200); await ctx.keyboard.press('ArrowRight'); await sleep(800);
    const v7 = await ctx.evaluate(() => { const v = document.getElementById('v-outro'); return { cur: window.__deck.cur(), paused: v.paused, muted: v.muted }; });
    rec('노래가 막혀도 아웃트로 영상은 재생', v7.cur === SLIDES - 2 && !v7.paused && v7.muted, JSON.stringify(v7));
    await ctx.close();
    /* 노래 파일이 없을 때 (공개 사이트에 노래를 올리지 않는 경우): 영상 자체 소리로 재생 */
    for(const blocked of [false, true]){
      const nb = await browser.newPage();
      await nb.setViewport({ width: 1280, height: 720 });
      await nb.evaluateOnNewDocument(blk => {
        document.addEventListener('DOMContentLoaded', () => { const a = document.getElementById('a-outro'); if(a){ a.setAttribute('data-missing', ''); a.removeAttribute('src'); } });
        if(blk){ const orig = HTMLMediaElement.prototype.play;
          HTMLMediaElement.prototype.play = function(){ if(!this.muted) return Promise.reject(new DOMException('blocked', 'NotAllowedError')); return orig.call(this); }; }
      }, blocked);
      await nb.goto(FILE.replace(/#.*$/, '') + '#' + (SLIDES - 1), { waitUntil: 'networkidle2' }); await sleep(600);
      await nb.keyboard.press('ArrowRight'); await sleep(200); await nb.keyboard.press('ArrowRight'); await sleep(900);
      const r = await nb.evaluate(() => { const v = document.getElementById('v-outro'); return { cur: window.__deck.cur(), paused: v.paused, muted: v.muted }; });
      rec(blocked ? '노래 파일 없음 + 소리 막힘: 영상을 소리 없이 재생' : '노래 파일 없음: 영상 자체 소리로 재생',
          r.cur === SLIDES - 2 && !r.paused && r.muted === blocked, JSON.stringify(r));
      await nb.close();
    }

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
    const dm = await page.evaluate(() => { const v = document.querySelector('#demo video'); return { on: document.getElementById('demo').classList.contains('on'),
      miss: document.getElementById('demo').classList.contains('missing'), playing: !v.paused && v.currentTime > 0, src: v.getAttribute('src') }; });
    rec('녹화 영상 버튼: 자동점검 녹화가 재생됨', dm.on && !dm.miss && dm.playing && dm.src === 'media/demo-te.mp4', JSON.stringify(dm));
    await page.keyboard.press('ArrowRight'); await sleep(120);
    rec('영상 창이 열려 있으면 장이 안 넘어감', (await idx(page)) === 4);
    await page.keyboard.press('Escape'); await sleep(120);
    /* 설계툴 녹화도 재생, 아직 없는 brain · CLAW 는 안내 */
    for(const [n, src, has] of [[5, 'media/demo-tools.mp4', true], [6, 'media/demo-brain.mp4', true], [9, 'media/demo-claw.mp4?v=3', true]]){
      await page.evaluate(k => window.__deck.goTo(k), n); await sleep(1200);
      await page.click('.slide.active [data-demo]'); await sleep(900);
      const d2 = await page.evaluate(() => { const v = document.querySelector('#demo video'); return { miss: document.getElementById('demo').classList.contains('missing'), playing: !v.paused, src: v.getAttribute('src') }; });
      rec('녹화 영상: ' + src + (has ? ' 재생' : ' 없음 안내'), d2.src === src && (has ? (!d2.miss && d2.playing) : d2.miss), JSON.stringify(d2));
      await page.keyboard.press('Escape'); await sleep(150);
    }
    await page.evaluate(() => window.__deck.goTo(4)); await sleep(300);
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
    rec('프로젝트 장마다 녹화 영상 버튼', ['media/demo-te.mp4', 'media/demo-tools.mp4', 'media/demo-brain.mp4', 'media/demo-claw.mp4?v=3'].every(d => demos.includes(d)), demos.join(','));

    /* ── 링크를 누른 뒤 Space 가 링크를 다시 열지 않아야 한다 ── */
    await page.evaluate(() => window.__deck.goTo(5)); await sleep(1500);
    /* 스크립트 click() 은 포커스를 옮기지 않으므로 먼저 focus() 로 실제 클릭 뒤 상태를 만든다 */
    await page.evaluate(() => { const a = document.querySelector('.slide.active a.card'); a.addEventListener('click', e => e.preventDefault(), { once: true }); a.focus(); a.click(); });
    await sleep(50);
    const focusLeft = await page.evaluate(() => document.activeElement && document.activeElement.tagName);
    rec('링크 클릭 뒤 포커스가 남지 않음', focusLeft !== 'A', focusLeft);
    rec('링크를 눌러도 장은 그대로', (await idx(page)) === 5);

    /* ── 마우스: 화면 오른쪽 절반 = 다음, 왼쪽 절반 = 이전 ── */
    await page.evaluate(() => window.__deck.goTo(2)); await sleep(1200);
    await page.mouse.click(1750, 760); await sleep(150);
    rec('화면 오른쪽 클릭 = 다음 장', (await idx(page)) === 3, 'idx=' + await idx(page));
    await page.mouse.click(160, 850); await sleep(150);
    rec('화면 왼쪽 클릭 = 이전 장', (await idx(page)) === 2, 'idx=' + await idx(page));
    /* Chrome 은 오른쪽 버튼에 click 을 보내지 않으므로, 가드를 확인하려면 직접 만든 click 을 보낸다 */
    await page.evaluate(() => document.elementFromPoint(1750, 760).dispatchEvent(new MouseEvent('click', { button: 2, clientX: 1750, clientY: 760, bubbles: true })));
    await sleep(150);
    rec('마우스 오른쪽 버튼 click 은 넘기지 않음', (await idx(page)) === 2);
    /* 대본 글자를 드래그해 골라 둔 뒤에도 무대 클릭으로 넘길 수 있어야 한다 */
    await page.keyboard.press('KeyN'); await sleep(150);
    const nb = await page.evaluate(() => { const r = document.querySelector('#notes .txt p').getBoundingClientRect(); return { x: r.left + 4, y: r.top + r.height / 2, w: r.width }; });
    await page.mouse.move(nb.x, nb.y); await page.mouse.down(); await page.mouse.move(nb.x + Math.min(300, nb.w - 8), nb.y, { steps: 6 }); await page.mouse.up();
    await sleep(100);
    const selLen = await page.evaluate(() => String(getSelection()).length);
    rec('대본 글자 드래그 선택은 장을 넘기지 않음', selLen > 0 && (await idx(page)) === 2, 'sel=' + selLen);
    await page.mouse.click(1750, 300); await sleep(150);
    rec('대본 글자를 골라 둔 채 오른쪽 클릭 = 다음 장', (await idx(page)) === 3, 'idx=' + await idx(page));
    await page.keyboard.press('KeyN'); await sleep(100);
    await page.keyboard.press('ArrowLeft'); await sleep(150);
    await page.evaluate(() => window.__deck.goTo(4)); await sleep(1500);
    await page.click('.slide.active [data-demo]'); await sleep(300);
    rec('녹화 영상 버튼을 눌러도 장은 그대로', (await idx(page)) === 4);
    await page.mouse.click(1850, 1000); await sleep(200);
    const afterClose = await page.evaluate(() => ({ open: document.getElementById('demo').classList.contains('on'), i: window.__deck.cur() }));
    rec('영상 창 바깥 클릭은 창만 닫고 장은 그대로', !afterClose.open && afterClose.i === 4, JSON.stringify(afterClose));

    /* ── 12장: CLAW 영향성 — 엔진이 내놓은 실제 그래프 ── */
    await page.evaluate(() => window.__deck.goTo(11)); await sleep(5600);
    const cw = await page.evaluate(() => ({
      nodes: document.querySelectorAll('#clawgraph .nd').length,
      hot: document.querySelectorAll('#clawgraph .hot').length,
      src: [...document.querySelectorAll('#clawgraph .nd.src')].length,
      lit: document.querySelectorAll('#clawgraph .nd.lit').length,
      on: document.querySelectorAll('#clawgraph .hot.on').length,
      tag: document.querySelector('#clawgraph .sl').textContent,
      read: document.getElementById('clawread').textContent,
      rail: document.querySelector('.slide.active .rail li.on').textContent }));
    rec('12장: 실제 그래프 노드 220 · 간선 373', cw.nodes === 220 && cw.hot === 373, cw.nodes + ' / ' + cw.hot);
    rec('12장: CLAW 장으로 표시 (목표 아님)', cw.rail === 'CLAW', cw.rail);
    rec('12장: 파라미터 하나에서 영향이 층을 타고 번짐', cw.src === 1 && cw.lit >= 20 && cw.on >= 20 && cw.tag === 'ki_hdg', JSON.stringify({ src: cw.src, lit: cw.lit, on: cw.on, tag: cw.tag }));
    rec('12장: 판독 문구', /^ki_hdg \(오토파일럿\)/.test(cw.read), cw.read);
    await page.keyboard.press('ArrowRight'); await sleep(300);
    const cwOff = await page.evaluate(() => ({ dim: document.getElementById('clawgraph').classList.contains('dim'),
      lit: document.querySelectorAll('#clawgraph .nd.lit, #clawgraph .nd.src').length, pts: document.querySelectorAll('#clawgraph .pt').length,
      tag: document.querySelector('#clawgraph .sl').classList.contains('on') }));
    rec('12장을 떠나면 재생이 멈춤', !cwOff.dim && cwOff.lit === 0 && cwOff.pts === 0 && !cwOff.tag, JSON.stringify(cwOff));

    /* ── 13장: 항공기 전체 노드 그래프 재생 (CLAW 영향성 방식) ── */
    await page.evaluate(() => window.__deck.goTo(12)); await sleep(5200);
    const ac1 = await page.evaluate(() => ({
      nodes: document.querySelectorAll('#acgraph .nd').length,
      tools: document.querySelectorAll('#acgraph .nd.tool').length,
      src: document.querySelectorAll('#acgraph .nd.src').length,
      lit: document.querySelectorAll('#acgraph .nd.lit').length,
      dim: document.getElementById('acgraph').classList.contains('dim'),
      hot: document.querySelectorAll('#acgraph .hot.on').length,
      read: document.getElementById('acread').textContent }));
    rec('13장: 노드 24개 중 네 도구 노드 10개', ac1.nodes === 24 && ac1.tools === 10, ac1.nodes + ' / ' + ac1.tools);
    rec('13장: 선택 노드 하나에서 영향이 번짐', ac1.src === 1 && ac1.lit >= 5 && ac1.dim && ac1.hot >= 5, JSON.stringify(ac1));
    rec('13장: 재생 판독 문구', /링크 · 힌지모멘트 변경 →/.test(ac1.read), ac1.read);
    await sleep(700);                    /* 층이 다 켜진 뒤(약 5.2 s)부터 입자가 흐른다 */
    /* 세로 간선 위 입자는 x 가 그대로라 x·y 를 함께 본다 */
    const ptsMoving = await page.evaluate(() => new Promise(r => { const c = document.querySelector('#acgraph .pt'); if(!c) return r(false); const at = () => c.getAttribute('cx') + ',' + c.getAttribute('cy'); const x = at(); setTimeout(() => r(at() !== x), 300); }));
    rec('13장: 켜진 선을 따라 입자가 흐름', ptsMoving);
    /* 입자가 흐르는 중에 떠나면 즉시 멈춰야 한다 */
    const acState = () => page.evaluate(() => ({ dim: document.getElementById('acgraph').classList.contains('dim'),
      lit: document.querySelectorAll('#acgraph .nd.lit, #acgraph .nd.src').length,
      on: document.querySelectorAll('#acgraph .hot.on').length, pts: document.querySelectorAll('#acgraph .pt').length }));
    await page.keyboard.press('ArrowRight'); await sleep(300);
    const off1 = await acState();
    rec('13장: 입자 재생 중 떠나면 즉시 멈춤', !off1.dim && off1.lit === 0 && off1.on === 0 && off1.pts === 0, JSON.stringify(off1));
    /* 바로 돌아와 층이 번지는 도중(3.6–5.2 s)에 다시 떠나면, 남은 점등 타이머가 나중에 켜면 안 된다 */
    await page.keyboard.press('ArrowLeft'); await sleep(200);
    const back0 = await acState();
    rec('13장: 다시 들어오면 깨끗한 상태', !back0.dim && back0.lit === 0 && back0.pts === 0, JSON.stringify(back0));
    await sleep(3900);
    await page.keyboard.press('ArrowRight'); await sleep(2500);
    const off2 = await acState();
    rec('13장: 번지는 도중 떠나면 남은 타이머가 켜지 않음', !off2.dim && off2.lit === 0 && off2.on === 0 && off2.pts === 0, JSON.stringify(off2));
    /* 곧바로 돌아오면 이전 회차의 play() 가 아직 예약돼 있을 수 있다 — 회차가 겹치면 선택 노드가 둘이 된다 */
    await page.keyboard.press('ArrowLeft'); await sleep(5300);
    const back1 = await page.evaluate(() => ({ src: [...document.querySelectorAll('#acgraph .nd.src')].map(g => g.textContent),
      read: document.getElementById('acread').textContent }));
    rec('13장: 다시 들어오면 첫 노드부터 한 회차만 재생', back1.src.length === 1 && /^링크 · 힌지모멘트/.test(back1.read), JSON.stringify(back1));
    /* 회차가 바뀌는 순간 지난 선이 되살아나며 거꾸로 줄어들면 안 된다 — 매 프레임 표본을 뜬다 */
    const ghost = await page.evaluate(() => new Promise(resolve => {
      let max = 0, seenDimOff = false, t0 = performance.now();
      const g = document.getElementById('acgraph');
      (function f(){
        if(!g.classList.contains('dim')) seenDimOff = true;
        if(seenDimOff){
          const n = [...g.querySelectorAll('.hot:not(.on)')].filter(h => parseFloat(getComputedStyle(h).opacity) > .05 && parseFloat(getComputedStyle(h).strokeDashoffset) < .95).length;
          max = Math.max(max, n);
        }
        if(seenDimOff && /^공력 DB/.test(document.getElementById('acread').textContent) || performance.now() - t0 > 14000) return resolve({ max, seenDimOff });
        requestAnimationFrame(f);
      })();
    }));
    rec('13장: 다음 회차에 지난 선이 되살아나지 않음', ghost.seenDimOff && ghost.max === 0, JSON.stringify(ghost));

    /* ── 배치 · 표시 ── */
    await sweep(page, '[1920]');
    await page.setViewport({ width: 1440, height: 900 }); await sleep(300);
    const fit = await page.evaluate(() => { const b = document.getElementById('stage').getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), l: Math.round(b.left), t: Math.round(b.top) }; });
    rec('1440×900 에서 무대가 화면에 맞음', fit.w <= 1440 && fit.h <= 900 && fit.l >= 0 && fit.t >= 0, JSON.stringify(fit));
    await page.setViewport({ width: 1280, height: 1024 }); await sleep(300);
    const fit2 = await page.evaluate(() => { const b = document.getElementById('stage').getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), t: Math.round(b.top) }; });
    rec('5:4 화면(1280×1024)에서도 잘리지 않음', fit2.w <= 1280 && fit2.h <= 1024 && fit2.t >= 0, JSON.stringify(fit2));

    /* ── 폰(가로): 밀어서 넘기기 · 좌우 탭 ── */
    const ph = await browser.newPage();
    await ph.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
    await ph.goto(FILE, { waitUntil: 'networkidle2' }); await sleep(300);
    async function swipe(x0, x1, y0 = 200, y1 = 205){
      await ph.touchscreen.touchStart(x0, y0);
      for(let k = 1; k <= 5; k++){ await ph.touchscreen.touchMove(x0 + (x1 - x0) * k / 5, y0 + (y1 - y0) * k / 5); await sleep(16); }
      await ph.touchscreen.touchEnd(); await sleep(250);
    }
    const pidx = () => ph.evaluate(() => window.__deck.cur());
    await ph.evaluate(() => window.__deck.goTo(1)); await sleep(200);
    await swipe(640, 200);
    rec('폰: 왼쪽으로 밀면 다음 장', (await pidx()) === 2, 'idx=' + await pidx());
    await swipe(200, 640);
    rec('폰: 오른쪽으로 밀면 이전 장', (await pidx()) === 1, 'idx=' + await pidx());
    await swipe(420, 440, 60, 330);
    rec('폰: 세로로 밀면 넘기지 않음', (await pidx()) === 1);
    /* 두 손가락으로 확대한 상태에서 한 손가락으로 화면을 옮기면 넘기지 않는다 (확대 배율을 흉내 낸다) */
    await ph.evaluate(() => Object.defineProperty(window.visualViewport, 'scale', { configurable: true, get: () => 2 }));
    await swipe(640, 200);
    rec('폰: 확대한 채 밀면 넘기지 않음', (await pidx()) === 1);
    await ph.evaluate(() => delete window.visualViewport.scale);
    await ph.touchscreen.tap(780, 200); await sleep(250);
    rec('폰: 오른쪽 탭 = 다음 장', (await pidx()) === 2);
    await ph.touchscreen.tap(60, 200); await sleep(250);
    rec('폰: 왼쪽 탭 = 이전 장', (await pidx()) === 1);
    const pfit = await ph.evaluate(() => { const b = document.getElementById('stage').getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; });
    rec('폰 가로 화면에 무대가 맞음', pfit.w <= 844 && pfit.h <= 390, JSON.stringify(pfit));
    /* 세로로 들고 있으면 가로로 돌리라는 안내, 넘기면 사라짐 */
    await ph.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await ph.reload({ waitUntil: 'networkidle2' }); await sleep(300);     /* 안내는 처음 열 때만 나온다 */
    const rot1 = await ph.evaluate(() => { const r = document.getElementById('rot'); return getComputedStyle(r).display !== 'none' && !r.classList.contains('gone'); });
    await ph.touchscreen.tap(350, 420); await sleep(700);
    const rot2 = await ph.evaluate(() => getComputedStyle(document.getElementById('rot')).visibility === 'hidden');
    rec('폰 세로: 가로 안내가 보였다가 넘기면 사라짐', rot1 && rot2, JSON.stringify({ rot1, rot2 }));
    await ph.close();

    /* ── 장표의 P: 폰으로 대본 볼 QR 과 주소 ── */
    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluate(() => window.__deck.goTo(3)); await sleep(200);
    await page.keyboard.press('KeyP'); await sleep(300);
    const qr1 = await page.evaluate(() => ({ on: document.getElementById('qr').classList.contains('on'), url: document.querySelector('#qr .qu').textContent }));
    rec('P: 폰 대본 QR 창과 공개 주소', qr1.on && qr1.url === 'jaegukang.com/ai/?script', JSON.stringify(qr1));
    await page.keyboard.press('ArrowRight'); await sleep(150);
    rec('QR 창이 열려 있으면 장이 안 넘어감', (await page.evaluate(() => window.__deck.cur())) === 3);
    await page.mouse.click(1850, 540); await sleep(150);
    const qrClick = await page.evaluate(() => ({ cur: window.__deck.cur(), on: document.getElementById('qr').classList.contains('on') }));
    rec('QR 창 바깥 클릭: 창만 닫히고 장은 그대로', qrClick.cur === 3 && !qrClick.on, JSON.stringify(qrClick));
    /* P 를 꾹 눌러도 열린 채로 */
    await page.keyboard.down('KeyP'); await sleep(40);
    for(let i = 0; i < 3; i++){ await page.keyboard.down('KeyP', { autoRepeat: true }); await sleep(40); }
    await page.keyboard.up('KeyP'); await sleep(150);
    rec('P 를 꾹 눌러도 QR 창이 열린 채', await page.evaluate(() => document.getElementById('qr').classList.contains('on')));
    await page.keyboard.press('Escape'); await sleep(150);
    rec('Esc: QR 창 닫힘', !(await page.evaluate(() => document.getElementById('qr').classList.contains('on'))));
    await page.keyboard.press('ArrowRight'); await sleep(150);
    rec('QR 창을 닫으면 다시 넘어감', (await page.evaluate(() => window.__deck.cur())) === 4);

    /* ── 폰 대본 (?script): 모든 장의 대본 · 이전/다음 · 시계 · 새로 고쳐도 유지 ── */
    const sp = await browser.newPage();
    sp.on('pageerror', e => errs.push('script pageerror: ' + e.message));
    await sp.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await sp.goto(FILE.replace(/#.*$/, '') + '?script', { waitUntil: 'networkidle2' });
    await sp.evaluate(() => { try { localStorage.removeItem('ai-script-v1'); } catch(e){} });
    await sp.reload({ waitUntil: 'networkidle2' }); await sleep(400);
    const sc0 = await sp.evaluate(() => ({
      cards: document.querySelectorAll('#scr .s-list li').length,
      notes: [...document.querySelectorAll('#scr .c-b')].filter(b => b.textContent.trim().length > 10).length,
      stage: getComputedStyle(document.getElementById('stage')).display,
      sw: document.documentElement.scrollWidth, cur: window.__script.cur() }));
    rec('폰 대본: 16장 모두 대본이 있음', sc0.cards === 16 && sc0.notes === 16, JSON.stringify(sc0));
    rec('폰 대본: 무대는 숨김 · 가로 넘침 없음', sc0.stage === 'none' && sc0.sw <= 390, JSON.stringify(sc0));
    await sp.tap('[data-s="next"]'); await sleep(200); await sp.tap('[data-s="next"]'); await sleep(200); await sp.tap('[data-s="prev"]'); await sleep(200);
    rec('폰 대본: 다음 · 이전', (await sp.evaluate(() => window.__script.cur())) === 1);
    await sp.tap('#scr .s-list li:nth-child(6)'); await sleep(300);
    rec('폰 대본: 카드를 누르면 그 장이 지금 장', (await sp.evaluate(() => window.__script.cur())) === 5);
    await sp.tap('[data-s="run"]'); await sleep(2200);
    const e1 = await sp.evaluate(() => window.__script.elapsed());
    rec('폰 대본: 시작하면 시계가 감', e1 >= 1.8 && e1 < 4, e1.toFixed(2));
    await sp.evaluate(() => window.scrollTo(0, 3000)); await sleep(300);
    const stick = await sp.evaluate(() => { const r = document.querySelector('#scr .s-top').getBoundingClientRect(); return Math.round(r.top); });
    rec('폰 대본: 스크롤해도 위쪽 시계 줄이 붙어 있음', stick === 0, 'top=' + stick);
    await sp.reload({ waitUntil: 'networkidle2' }); await sleep(600);
    const kept = await sp.evaluate(() => ({ cur: window.__script.cur(), el: window.__script.elapsed() }));
    rec('폰 대본: 새로 고쳐도 지금 장 · 시계 유지', kept.cur === 5 && kept.el >= e1, JSON.stringify(kept));
    await sp.tap('[data-s="run"]'); await sleep(200);
    const paused = await sp.evaluate(() => window.__script.elapsed()); await sleep(1200);
    rec('폰 대본: 멈추면 시계가 서 있음', Math.abs((await sp.evaluate(() => window.__script.elapsed())) - paused) < .05);
    await sp.tap('[data-s="reset"]'); await sleep(200);
    rec('폰 대본: 다시 → 0', (await sp.evaluate(() => window.__script.elapsed())) === 0);
    /* 깨진 · 범위 밖 저장값: 기본값으로 떨어져 NaN 없이 움직여야 한다 */
    for(const bad of ['{"cur":20,"acc":5,"since":null}', '{"cur":3}', '{"cur":2,"acc":-4,"since":9e15}', 'not json']){
      await sp.evaluate(v => localStorage.setItem('ai-script-v1', v), bad);
      await sp.reload({ waitUntil: 'networkidle2' }); await sleep(300);
      await sp.tap('[data-s="prev"]'); await sleep(150);
      const r = await sp.evaluate(() => ({ cur: window.__script.cur(), el: window.__script.elapsed(),
        diff: document.querySelector('#scr .s-diff').textContent, pos: document.querySelector('#scr .s-pos').textContent,
        top: document.querySelector('#scr .s-el').textContent }));
      rec('폰 대본: 깨진 저장값 ' + bad.slice(0, 28), Number.isFinite(r.el) && r.el >= 0 && !/NaN/.test(r.diff + r.top) && /^\d\d \/ 16$/.test(r.pos) && r.cur >= 0 && r.cur < 16, JSON.stringify(r));
    }
    /* 키보드: 버튼을 누른 뒤 Enter 가 그 버튼을 다시 누르거나 장을 넘기지 않아야 한다 */
    await sp.evaluate(() => localStorage.removeItem('ai-script-v1')); await sp.reload({ waitUntil: 'networkidle2' }); await sleep(300);
    await sp.click('[data-s="run"]'); await sleep(150);
    const fb = await sp.evaluate(() => document.activeElement && document.activeElement.tagName);
    rec('폰 대본: 버튼을 누른 뒤 포커스가 남지 않음', fb !== 'BUTTON', fb);
    await sp.close();

    /* ── 백그라운드 탭: 타이머가 몰려 한꺼번에 실행돼도, 13장을 떠난 뒤 선이 켜지면 안 된다 ──
       Chrome 은 숨은 탭의 타이머를 모아 드문드문 깨운다. 8초마다 한 번 몰아서 실행하는 가짜 setTimeout 으로 흉내 낸다. */
    const bg = await browser.newPage();
    await bg.setViewport({ width: 1920, height: 1080 });
    await bg.evaluateOnNewDocument(() => {
      const natClear = window.clearTimeout.bind(window);
      let q = [], seq = 0;
      window.setTimeout = (fn, ms, ...a) => { const id = 1e6 + (++seq); q.push({ id, due: performance.now() + (ms || 0), fn, a }); return id; };
      window.clearTimeout = id => { q = q.filter(t => t.id !== id); natClear(id); };
      setInterval(() => {
        const now = performance.now();
        for(;;){
          const due = q.filter(t => t.due <= now).sort((x, y) => x.due - y.due)[0];
          if(!due) break;
          q = q.filter(t => t !== due);
          try { if(typeof due.fn === 'function') due.fn(...due.a); } catch(e){}
        }
      }, 8000);
    });
    await bg.goto(FILE, { waitUntil: 'networkidle2' });
    await bg.evaluate(() => window.__deck.goTo(12)); await sleep(26000);
    await bg.evaluate(() => window.__deck.goTo(13)); await sleep(9000);
    const bgOn = await bg.evaluate(() => document.querySelectorAll('#acgraph .hot.on, #acgraph .nd.lit').length);
    rec('백그라운드 탭: 13장을 떠난 뒤 늦게 터진 타이머가 선을 켜지 않음', bgOn === 0, bgOn + '개');
    await bg.close();

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
