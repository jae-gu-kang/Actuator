#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Merge all Engineering Tools HTML files into ONE self-contained, OFFLINE-capable file.

  python3 build/build_merged.py        # writes ../engineering_tools_all_in_one.html

- Each tool is embedded as an isolated <iframe srcdoc> (shared origin -> shared localStorage,
  so the 4-Bar <-> hinge <-> rigging handoff keeps working inside the single file).
- External libs (Chart.js, html2canvas) are inlined from build/libs; Google Fonts links are
  neutralized (the pages fall back to the system Korean font, so everything works offline).
- window.open('other.html#...') and href="index.html" are intercepted -> parent tab switch.
"""
import json, re, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LIBS = os.path.join(HERE, "libs")
OUT  = os.path.join(ROOT, "engineering_tools_all_in_one.html")

def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()

CHART_400 = read(os.path.join(LIBS, "chart.umd.min.js"))   # jsdelivr 4.4.0 (hinge, servo)
CHART_441 = read(os.path.join(LIBS, "chart.umd.js"))        # cdnjs 4.4.1 (regression)
H2C       = read(os.path.join(LIBS, "html2canvas.min.js"))  # 1.4.1 (hinge)

# name -> (filename, label) in nav order
TOOLS = [
    ("home",       "index.html",                  "홈"),
    ("linkage",    "4-bar-linkage-torque.html",   "4-Bar 링크"),
    ("hinge",      "hinge_moment_calculator.html","힌지모멘트"),
    ("regression", "regression_analysis.html",    "회귀분석"),
    ("servo",      "servo_fra.html",              "주파수응답"),
    ("rigging",    "cs_rigging.html",             "CS Rigging"),
    ("manual",     "manual.html",                 "매뉴얼"),
]

FONT_LINK_RE  = re.compile(r'<link[^>]*fonts\.googleapis\.com[^>]*>', re.I)
CHART_400_TAG = '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>'
CHART_441_TAG = '<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>'

SHIM = """
<script>
/* merged-shell navigation shim: intercept cross-tool navigation */
(function(){
  var MAP = {
    'index.html':'home','4-bar-linkage-torque.html':'linkage','hinge_moment_calculator.html':'hinge',
    'regression_analysis.html':'regression','servo_fra.html':'servo','cs_rigging.html':'rigging','manual.html':'manual'
  };
  function resolve(u){ if(!u) return null; u=String(u); for(var k in MAP){ if(u.indexOf(k)!==-1) return MAP[k]; } return null; }
  var _open = window.open;
  window.open = function(u){
    var t = resolve(u);
    if(t){ try{ parent.postMessage({__mergedNav:true, target:t, reload:true}, '*'); }catch(e){} return null; }
    return _open.apply(window, arguments);
  };
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if(!a) return;
    var href = a.getAttribute('href');
    if(!href || href.charAt(0)==='#') return;
    var t = resolve(href);
    if(t){ e.preventDefault(); try{ parent.postMessage({__mergedNav:true, target:t, reload:false}, '*'); }catch(err){} }
  }, true);
})();
</script>
"""

def process(name, filename):
    html = read(os.path.join(ROOT, filename))
    html = FONT_LINK_RE.sub('<!-- google-fonts removed for offline -->', html)
    if CHART_400_TAG in html:
        html = html.replace(CHART_400_TAG, '<script>/*chart.js 4.4.0*/\n'+CHART_400+'\n</script>')
    if CHART_441_TAG in html:
        html = html.replace(CHART_441_TAG, '<script>/*chart.js 4.4.1*/\n'+CHART_441+'\n</script>')
    if name == 'hinge':  # inline html2canvas so the dynamic-load guard skips the network fetch
        html = html.replace('</head>', '<script>/*html2canvas 1.4.1 inline (offline)*/\n'+H2C+'\n</script>\n</head>', 1)
    idx = html.rfind('</body>')
    html = (html[:idx] + SHIM + html[idx:]) if idx != -1 else (html + SHIM)
    return html

data = {name: process(name, fn) for name, fn, _ in TOOLS}
tools_js = ("const TOOLS = " + json.dumps(data, ensure_ascii=False) + ";").replace("</", "<\\/")
nav_buttons = "\n".join('    <button class="tab" data-tool="{n}">{l}</button>'.format(n=n, l=label) for n, fn, label in TOOLS)

SHELL = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Engineering Tools — All-in-One</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{height:100%;}
  body{font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;
       background:#f5f5f7;color:#1d1d1f;display:flex;flex-direction:column;height:100vh;overflow:hidden;-webkit-font-smoothing:antialiased;}
  header{flex:0 0 auto;display:flex;align-items:center;gap:14px;height:52px;padding:0 16px;
         background:rgba(245,245,247,0.92);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);
         border-bottom:1px solid rgba(0,0,0,0.08);z-index:10;}
  .brand{display:flex;align-items:center;gap:9px;font-size:15px;font-weight:700;letter-spacing:-0.2px;white-space:nowrap;}
  .brand .ic{width:26px;height:26px;border-radius:7px;background:#0071e3;display:flex;align-items:center;justify-content:center;}
  .brand .ic svg{width:15px;height:15px;fill:#fff;}
  .tabs{display:flex;gap:4px;overflow-x:auto;flex:1;scrollbar-width:thin;}
  .tab{flex:0 0 auto;border:none;background:transparent;color:#6e6e73;font-size:13.5px;font-weight:600;font-family:inherit;
       padding:7px 13px;border-radius:9px;cursor:pointer;white-space:nowrap;transition:all .15s;}
  .tab:hover{background:rgba(0,0,0,0.05);color:#1d1d1f;}
  .tab.active{background:#0071e3;color:#fff;}
  .offline{flex:0 0 auto;font-size:11px;font-weight:600;color:#28a745;background:rgba(40,167,69,0.1);padding:4px 10px;border-radius:100px;white-space:nowrap;}
  main{flex:1 1 auto;position:relative;background:#fff;}
  iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff;display:none;}
  iframe.active{display:block;}
  .loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#aeaeb2;font-size:14px;}
  @media (max-width:640px){ .brand span{display:none;} }
</style>
</head>
<body>
<header>
  <a class="brand" href="#" onclick="return false;">
    <span class="ic"><svg viewBox="0 0 16 16"><path d="M2 3h12v2H2zm0 4h8v2H2zm0 4h10v2H2z"/></svg></span>
    <span>Engineering Tools</span>
  </a>
  <nav class="tabs" id="tabs">
""" + nav_buttons + """
  </nav>
  <span class="offline">● OFFLINE READY</span>
</header>
<main id="stage">
  <div class="loading" id="loading">도구를 불러오는 중…</div>
</main>

<script>
""" + tools_js + """
const ORDER = """ + json.dumps([n for n,_,_ in TOOLS], ensure_ascii=False) + """;
const stage = document.getElementById('stage');
const loading = document.getElementById('loading');
const frames = {};
let current = null;
function ensureFrame(name){
  if(frames[name]) return frames[name];
  const f = document.createElement('iframe');
  f.setAttribute('title', name);
  f.name = 'frame-' + name;
  f.setAttribute('data-name', name);
  f.srcdoc = TOOLS[name];
  stage.appendChild(f);
  frames[name] = f;
  return f;
}
function showTool(name, reload){
  if(!TOOLS[name]) return;
  if(loading) loading.style.display='none';
  const f = ensureFrame(name);
  if(reload){ f.srcdoc = TOOLS[name]; }
  Object.keys(frames).forEach(k=>frames[k].classList.toggle('active', k===name));
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tool===name));
  current = name;
  try{ location.hash = name; }catch(e){}
}
document.getElementById('tabs').addEventListener('click', function(e){
  const b = e.target.closest('.tab'); if(!b) return;
  showTool(b.dataset.tool, false);
});
window.addEventListener('message', function(e){
  const d = e.data; if(!d || !d.__mergedNav) return;
  showTool(d.target, !!d.reload);
});
const initial = (location.hash||'').replace('#','');
showTool(ORDER.indexOf(initial)!==-1 ? initial : 'home', false);
</script>
</body>
</html>
"""

with open(OUT, "w", encoding="utf-8") as f:
    f.write(SHELL)
print("WROTE", OUT, "(", os.path.getsize(OUT), "bytes )")
