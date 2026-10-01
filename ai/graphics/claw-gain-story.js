/* Presentation illustrations, not flight results or an optimizer running in the deck.
 * Capability sources: CLAW evaluate.py, improve.py, prescribe.py, influence.js.
 * Every numeric value below is explicitly labeled as illustrative on both slides.
 */
(function(){
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var PAPER = '#F4F1E8', ORANGE = '#FF6C2B', CYAN = '#36D1DD';
  var reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
  function node(parent, name, attrs, content){
    var e = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function(k){ e.setAttribute(k, attrs[k]); });
    if(content !== undefined) e.textContent = content;
    parent.appendChild(e); return e;
  }
  function text(parent, x, y, content, cls, anchor){
    return node(parent, 'text', {x:x, y:y, 'class':cls || '', 'text-anchor':anchor || 'start'}, content);
  }
  function line(parent, x1, y1, x2, y2, cls, color){
    return node(parent, 'line', {x1:x1, y1:y1, x2:x2, y2:y2, 'class':cls || 'chart-axis', stroke:color || ''});
  }
  function path(parent, d, cls, color){
    return node(parent, 'path', {d:d, 'class':cls || 'chart-curve', stroke:color || CYAN});
  }
  function signed(value, decimals, unit){
    return (value < 0 ? '−' : value > 0 ? '+' : '') + Math.abs(value).toFixed(decimals || 0) + (unit || '%');
  }
  function glow(svg, id){
    var defs = node(svg, 'defs');
    var filter = node(defs, 'filter', {id:id, x:'-50%', y:'-50%', width:'200%', height:'200%'});
    node(filter, 'feGaussianBlur', {stdDeviation:5, result:'blur'});
    var merge = node(filter, 'feMerge');
    node(merge, 'feMergeNode', {in:'blur'}); node(merge, 'feMergeNode', {in:'SourceGraphic'});
  }

  // A player belongs to its slide. Leaving, hiding the tab, and printing stop RAF.
  function player(svg, draw, seconds){
    var slide = svg.closest('.slide'), raf = 0, started = 0, printing = false, cycle = -1;
    function stop(){ cancelAnimationFrame(raf); raf = 0; svg.removeAttribute('data-playing'); }
    function frame(now){
      if(!slide.classList.contains('active') || document.hidden || printing){ stop(); return; }
      var elapsed = (now - started) / 1000, nextCycle = Math.floor(elapsed / seconds);
      if(nextCycle !== cycle){ cycle = nextCycle; svg.setAttribute('data-cycle', cycle); }
      var t = elapsed % seconds;
      draw(t); raf = requestAnimationFrame(frame);
    }
    function sync(){
      stop();
      if(!slide.classList.contains('active')) return;
      if(reduce || printing){ draw(seconds - 2); return; }
      if(document.hidden) return;
      started = performance.now(); cycle = 0; draw(0);
      svg.setAttribute('data-cycle', '0'); svg.setAttribute('data-playing', 'true');
      raf = requestAnimationFrame(frame);
    }
    draw(seconds - 2);
    document.addEventListener('deck:slide', sync);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('beforeprint', function(){ printing = true; stop(); draw(seconds - 2); });
    window.addEventListener('afterprint', function(){ printing = false; sync(); });
  }

  function evaluation(){
    var svg = document.getElementById('gain-evaluation'); if(!svg) return;
    glow(svg, 'eval-glow');
    node(svg, 'desc', {}, '설명용 가상 데이터. 게인을 10% 올렸을 때 운용점별 지표 변화와 추종 성능·안정여유의 경향을 보여 줍니다.');
    // Input and the recorded sweep: two metrics can fall for different reasons.
    text(svg, 0, 38, '01 게인 변경', 'chart-k');
    text(svg, 0, 84, '비례 게인 Kp', 'chart-h');
    var gainValue = text(svg, 0, 170, '+10%', 'chart-big chart-o');
    text(svg, 0, 212, '기준 게인에 대한 상대 변화', 'chart-small');
    line(svg, 0, 250, 425, 250);
    text(svg, 0, 294, '스윕으로 경향을 읽는다', 'chart-h');
    text(svg, 0, 324, '기준값 = 100으로 정규화', 'chart-small');
    var x0 = 42, y0 = 366, w = 360, h = 190;
    [60, 80, 100, 120, 140].forEach(function(v){
      var y = y0 + (140 - v) / 80 * h;
      line(svg, x0, y, x0 + w, y, 'chart-grid'); text(svg, x0 - 12, y + 5, String(v), 'chart-small', 'end');
    });
    var rms = [132, 116, 100, 77, 69], pm = [110, 106, 100, 92, 80];
    function point(i, v){ return [x0 + i * w / 4, y0 + (140 - v) / 80 * h]; }
    function curve(values, color){
      var points = values.map(function(v, i){ return point(i, v); });
      path(svg, points.map(function(p, i){ return (i ? 'L' : 'M') + p.join(' '); }).join(' '), 'chart-curve', color);
      points.forEach(function(p){ node(svg, 'circle', {cx:p[0], cy:p[1], r:4, fill:color}); });
    }
    curve(rms, CYAN); curve(pm, ORANGE);
    [-20,-10,0,10,20].forEach(function(v, i){
      text(svg, x0 + i * w / 4, y0 + h + 26, signed(v, 0, ''), 'chart-small', 'middle');
    });
    text(svg, x0 + w, 616, '게인 변화 (%)', 'chart-small', 'end');
    text(svg, 0, 646, 'RMS ↓ 개선', 'chart-c');
    text(svg, 215, 646, 'PM ↓ 여유 감소', 'chart-o');
    var sweepLine = line(svg, point(3, 140)[0], y0, point(3, 140)[0], y0 + h, 'chart-link');
    var rmsDot = node(svg, 'circle', {cx:point(3,77)[0], cy:point(3,77)[1], r:7, fill:CYAN, filter:'url(#eval-glow)'});
    var pmDot = node(svg, 'circle', {cx:point(3,92)[0], cy:point(3,92)[1], r:7, fill:ORANGE, filter:'url(#eval-glow)'});
    var transfer = path(svg, 'M430 175 C470 175 470 210 508 210', 'chart-link', ORANGE);
    var transferDot = node(svg, 'circle', {r:5, fill:ORANGE, filter:'url(#eval-glow)'});

    // Case-by-metric matrix, not a single operating point pretending to be the whole grid.
    text(svg, 530, 38, '02 선택 운용점 전체 평가', 'chart-k');
    var cols = ['추종 RMS', '정착 Ts', 'PM', '제어권한'];
    var shifts = [[-23,-20,-4,-5],[-18,-15,-7,-8],[-8,-12,-3,-4],[-14,-6,-5,-6]];
    cols.forEach(function(label, j){ text(svg, 664 + j * 108, 92, label, 'chart-small', 'middle'); });
    var cells = [];
    shifts.forEach(function(row, i){
      var y = 113 + i * 67;
      text(svg, 530, y + 34, '운용점 ' + 'ABCD'[i], 'chart-small');
      row.forEach(function(v, j){
        var x = 615 + j * 108, color = j < 2 ? CYAN : ORANGE;
        var rect = node(svg, 'rect', {x:x, y:y, width:98, height:52, rx:3, fill:color, 'fill-opacity':.16});
        var label = text(svg, x + 49, y + 34, signed(v, 0, j === 2 ? '°' : j === 3 ? '%p' : '%'), j < 2 ? 'chart-c' : 'chart-o', 'middle');
        cells.push({rect:rect, label:label, row:i});
      });
    });
    line(svg, 530, 416, 1039, 416);
    text(svg, 530, 461, 'RMS 평균 변화', 'chart-k');
    var average = text(svg, 1039, 470, '−16%', 'chart-num chart-c', 'end');
    text(svg, 530, 508, '개선이 가장 작은 운용점 C', 'chart-small');
    text(svg, 1039, 509, '−8%', 'chart-c', 'end');
    text(svg, 530, 563, '평균뿐 아니라 최악 조건도 확인', 'chart-h');
    text(svg, 530, 601, '기준 위반과 미측정을 함께 표시', 'chart-small');

    // Representative case A retains physical units alongside every relative change.
    text(svg, 1142, 38, '03 얼마나 변했나 · 운용점 A', 'chart-k');
    var metrics = [
      {name:'추종 RMS', from:8.2, to:6.3, unit:' m', change:-23, suffix:'%', color:CYAN},
      {name:'정착시간 Ts', from:8.4, to:6.7, unit:' s', change:-20, suffix:'%', color:CYAN},
      {name:'위상여유 PM', from:52, to:48, unit:'°', change:-4, suffix:'°', color:ORANGE},
      {name:'잔여 제어권한', from:36, to:31, unit:'%', change:-5, suffix:'%p', color:ORANGE}
    ];
    metrics.forEach(function(m, i){
      var y = 94 + i * 96;
      text(svg, 1142, y, m.name, 'chart-k');
      m.value = text(svg, 1142, y + 36, m.from + m.unit + ' → ' + m.to + m.unit);
      m.delta = text(svg, 1672, y + 37, signed(m.change, 0, m.suffix), 'chart-num ' + (i < 2 ? 'chart-c' : 'chart-o'), 'end');
      line(svg, 1142, y + 59, 1672, y + 59, 'chart-grid');
      m.bar = node(svg, 'rect', {x:1142, y:y + 57, width:300, height:4, fill:m.color});
    });
    text(svg, 1142, 542, '성능과 제약을 함께 판정', 'chart-h');
    text(svg, 1142, 581, '추종이 좋아져도 안정여유는 줄 수 있습니다.', 'chart-small');
    var status = text(svg, 1142, 623, '변화량 확인 · 다음은 목표성능 개선', 'chart-c');

    player(svg, function(t){
      var u = Math.min(1, Math.max(0, (t - .8) / 3)), eased = u * u * (3 - 2 * u);
      gainValue.textContent = signed(10 * eased);
      metrics.forEach(function(m, i){
        var decimals = i < 2 ? 1 : 0, v = m.from + (m.to - m.from) * eased;
        m.value.textContent = m.from + m.unit + ' → ' + v.toFixed(decimals) + m.unit;
        m.delta.textContent = signed(m.change * eased, 0, m.suffix);
        m.bar.setAttribute('width', (Math.abs(m.change) / 25 * 430 * eased).toFixed(1));
      });
      cells.forEach(function(c){
        var k = Math.min(1, Math.max(0, (t - 1.2 - c.row * .55) / .6));
        c.rect.setAttribute('fill-opacity', (.07 + .2 * k).toFixed(3)); c.label.setAttribute('opacity', (.25 + .75 * k).toFixed(3));
      });
      average.textContent = signed(-15.75 * eased);
      var x = x0 + (2 + eased) * w / 4;
      sweepLine.setAttribute('x1', x); sweepLine.setAttribute('x2', x);
      rmsDot.setAttribute('cx', x); rmsDot.setAttribute('cy', point(2, 100 - 23 * eased)[1]);
      pmDot.setAttribute('cx', x); pmDot.setAttribute('cy', point(2, 100 - 8 * eased)[1]);
      var p = transfer.getPointAtLength(t % 1.5 / 1.5 * transfer.getTotalLength());
      transferDot.setAttribute('cx', p.x); transferDot.setAttribute('cy', p.y);
      status.textContent = u < 1 ? '변경 후 지표를 비교 중' : '변화량 확인 · 다음은 목표성능 개선';
      svg.setAttribute('data-phase', u < 1 ? 'evaluate' : 'compared');
    }, 14);
  }

  function optimization(){
    var svg = document.getElementById('gain-optimization'); if(!svg) return;
    glow(svg, 'opt-glow');
    node(svg, 'desc', {}, '가상 목표와 탐색 지형으로 설명하는 다중 게인 조정. 변경량 예측 후보를 선택 운용점 전체에서 재평가한 뒤 저장한다.');
    text(svg, 0, 38, '01 목표와 조정 범위', 'chart-k');
    text(svg, 0, 94, '목표성능', 'chart-h');
    [['추종 RMS', '≤ 5.0 m'], ['정착시간 Ts', '≤ 6.0 s'], ['위상여유 PM', '≥ 45°']].forEach(function(row, i){
      var y = 152 + i * 57;
      text(svg, 0, y, row[0]); text(svg, 422, y, row[1], 'chart-num chart-c', 'end');
      line(svg, 0, y + 18, 422, y + 18, 'chart-grid');
    });
    text(svg, 0, 354, '얼마나 올릴 수 있나', 'chart-h');
    text(svg, 0, 389, 'Kp 변화폭 · 목표와 제약을 함께 확인', 'chart-small');
    var rx = 28, rw = 374, ry = 430;
    node(svg, 'rect', {x:rx, y:ry, width:rw, height:20, rx:10, fill:'#333331'});
    node(svg, 'rect', {x:rx + rw * .34, y:ry, width:rw * .52, height:20, rx:10, fill:CYAN, 'fill-opacity':.4});
    node(svg, 'rect', {x:rx + rw * .86, y:ry, width:rw * .14, height:20, rx:10, fill:ORANGE, 'fill-opacity':.4});
    [-20,0,20].forEach(function(v, i){ text(svg, rx + rw * i / 2, ry + 49, signed(v, 0, '%'), 'chart-small', 'middle'); });
    var rangeDot = node(svg, 'circle', {cx:rx + rw * .8, cy:ry + 10, r:10, fill:PAPER, stroke:CYAN, 'stroke-width':4, filter:'url(#opt-glow)'});
    text(svg, 0, 498, '청록: 후보 영역 · 주황: 제약 경계', 'chart-small');
    text(svg, 0, 527, '측정 표본과 제약 안에서 탐색', 'chart-small');
    text(svg, 0, 563, '최대 변화폭과 변경 개수 상한을 설정', 'chart-small');
    text(svg, 0, 607, '목표 충족 / 성능 최적화 선택', 'chart-o');

    // A qualitative objective landscape, not a claimed global optimum or measured map.
    text(svg, 509, 38, '02 여러 게인을 동시에 탐색', 'chart-k');
    text(svg, 509, 77, 'Kp · Ki · K_rate를 함께 조정', 'chart-h');
    var gx = 560, gy = 118, gw = 486, gh = 363;
    var defs = node(svg, 'defs'), clip = node(defs, 'clipPath', {id:'opt-plot-clip'});
    node(clip, 'rect', {x:gx, y:gy, width:gw, height:gh});
    var field = node(svg, 'g', {'clip-path':'url(#opt-plot-clip)'});
    node(field, 'rect', {x:gx, y:gy, width:gw, height:gh, fill:'#182628'});
    // These contours explain a search direction; they carry no numerical objective labels.
    var cx = gx + gw * .78, cy = gy + gh * .7;
    [390,320,250,190,130,70].forEach(function(radius, i){
      node(field, 'ellipse', {cx:cx, cy:cy, rx:radius, ry:radius * .54,
        transform:'rotate(-28 ' + cx + ' ' + cy + ')', fill:i < 2 ? '#102025' : '#133f40',
        'fill-opacity':.18, stroke:CYAN, 'stroke-opacity':.15 + i * .08, 'stroke-width':1.5});
    });
    path(field, 'M560 118 H1046 V245 C893 200 779 159 560 187 Z', '', ORANGE).setAttribute('fill', 'rgba(255,108,43,.16)');
    for(var j = 0; j <= 4; j++){
      line(svg, gx + j * gw / 4, gy, gx + j * gw / 4, gy + gh, 'chart-grid');
      line(svg, gx, gy + j * gh / 4, gx + gw, gy + j * gh / 4, 'chart-grid');
    }
    line(svg, gx, gy + gh, gx + gw, gy + gh); line(svg, gx, gy, gx, gy + gh);
    [-20,-10,0,10,20].forEach(function(v, i){ text(svg, gx + i * gw / 4, gy + gh + 26, signed(v, 0, ''), 'chart-small', 'middle'); });
    text(svg, gx + gw, gy + gh + 56, 'Kp 변화 (%)', 'chart-small', 'end');
    text(svg, gx - 17, gy + 18, 'Ki', 'chart-small', 'end');
    text(svg, gx - 17, gy + 52, '+20%', 'chart-small', 'end');
    text(svg, gx - 17, gy + gh / 2 + 6, '0', 'chart-small', 'end');
    text(svg, gx - 17, gy + gh - 3, '−20%', 'chart-small', 'end');
    text(svg, gx + 22, gy + 39, '제약 위반 후보 제외', 'chart-o');
    text(svg, gx + 22, gy + gh - 26, '목표를 만족하는 조합 탐색', 'chart-c');
    function position(kp, ki){ return [gx + (kp + 20) / 40 * gw, gy + (20 - ki) / 40 * gh]; }
    var candidates = [[0,0],[6,-2],[10,-4],[12,-6]];
    var points = candidates.map(function(p){ return position(p[0], p[1]); });
    var route = path(svg, points.map(function(p, i){ return (i ? 'L' : 'M') + p.join(' '); }).join(' '), 'chart-curve', ORANGE);
    route.setAttribute('filter', 'url(#opt-glow)');
    var rings = [];
    points.forEach(function(p, i){
      var c = node(svg, 'circle', {cx:p[0], cy:p[1], r:i === 3 ? 9 : 5, fill:i === 3 ? CYAN : PAPER, stroke:i === 3 ? CYAN : ORANGE, 'stroke-width':2});
      rings.push(c);
    });
    text(svg, points[0][0] - 18, points[0][1] - 19, '현재', 'chart-small', 'end');
    text(svg, points[3][0] + 16, points[3][1] - 15, '후보 조합', 'chart-c');
    var cursor = node(svg, 'circle', {r:10, fill:PAPER, stroke:ORANGE, 'stroke-width':4, filter:'url(#opt-glow)'});
    text(svg, 509, 578, '1–8개 조정변수 · 변경 개수 상한 지정', 'chart-small');
    var searchState = text(svg, 509, 622, '변경량 예측은 후보 · 재평가로 확인', 'chart-o');

    text(svg, 1145, 38, '03 변경량 제안 후 재평가', 'chart-k');
    var gains = [{name:'Kp', to:12, color:CYAN}, {name:'Ki', to:-6, color:ORANGE}, {name:'K_rate', to:8, color:CYAN}];
    gains.forEach(function(g, i){
      var y = 106 + i * 89;
      text(svg, 1145, y, g.name, 'chart-h');
      g.label = text(svg, 1672, y, signed(g.to), 'chart-num ' + (g.to < 0 ? 'chart-o' : 'chart-c'), 'end');
      line(svg, 1145, y + 30, 1672, y + 30, 'chart-grid');
      line(svg, 1350, y + 21, 1350, y + 39);
      g.bar = node(svg, 'rect', {x:1350, y:y + 26, width:0, height:8, rx:4, fill:g.color});
    });
    text(svg, 1145, 364, '선택 운용점 전체를 재평가', 'chart-h');
    var outcome = text(svg, 1145, 405, 'RMS 4.8 m · Ts 5.6 s · PM 47°', 'chart-small');
    var checked = text(svg, 1145, 454, '목표 + 하드 제약 통과', 'chart-num chart-c');
    text(svg, 1145, 501, '목표 미달이면 다시 측정하고 조정', 'chart-small');
    var save = text(svg, 1145, 564, '통과 후보만 설계안으로 저장', 'chart-h chart-c');
    text(svg, 1145, 606, '최소 수정으로 목표 충족 또는 성능 최적화', 'chart-small');

    player(svg, function(t){
      /* 10초에 결과를 거두고 처음 상태로 돌아간 뒤 같은 탐색을 다시 시작한다. */
      var restarting = t >= 10;
      var u = restarting ? 0 : Math.min(1, Math.max(0, (t - 1) / 5));
      var section = Math.min(2, Math.floor(u * 3)), local = u * 3 - section;
      var kp = candidates[section][0] + (candidates[section + 1][0] - candidates[section][0]) * local;
      var ki = candidates[section][1] + (candidates[section + 1][1] - candidates[section][1]) * local;
      var p = position(kp, ki);
      cursor.setAttribute('cx', p[0]); cursor.setAttribute('cy', p[1]);
      route.setAttribute('stroke-dasharray', route.getTotalLength());
      route.setAttribute('stroke-dashoffset', (1 - u) * route.getTotalLength());
      rings.forEach(function(c, i){ c.setAttribute('opacity', u * 3 + .05 >= i ? 1 : .18); });
      gains.forEach(function(g, i){
        var v = i === 0 ? kp : i === 1 ? ki : 8 * u;
        g.label.textContent = signed(v);
        g.bar.setAttribute('x', v < 0 ? 1350 + v * 11 : 1350);
        g.bar.setAttribute('width', Math.abs(v) * 11);
      });
      rangeDot.setAttribute('cx', rx + rw * (kp + 20) / 40);
      var confirming = t >= 6 && t < 8, confirmed = t >= 8 && t < 10;
      outcome.textContent = confirmed ? 'RMS 4.8 m · Ts 5.6 s · PM 47°' : confirming ? '선택 운용점 전체에서 확인 중' : restarting ? '다음 탐색을 준비하는 중' : '후보 변경량을 계산하는 중';
      checked.textContent = confirmed ? '목표 + 하드 제약 통과' : confirming ? '재평가 중' : restarting ? '초기화 중' : '후보 탐색 중';
      checked.setAttribute('class', 'chart-num ' + (confirmed ? 'chart-c' : 'chart-o'));
      save.setAttribute('opacity', confirmed ? 1 : .25);
      searchState.textContent = confirmed ? '재평가 통과 · 설계안으로 저장 가능' : confirming ? '예측 후보를 실제 계산으로 확인' : restarting ? '같은 과정을 처음부터 반복' : '감도를 바탕으로 게인 조합을 탐색';
      svg.setAttribute('data-phase', confirmed ? 'accepted' : confirming ? 'confirm' : restarting ? 'restart' : 'search');
    }, 12);
  }
  evaluation(); optimization();
})();
