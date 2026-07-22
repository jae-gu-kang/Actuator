# Engineering Tools — 병합 빌드 & 검증

`engineering_tools_all_in_one.html` (저장소 루트)은 6개 도구 + 매뉴얼을 **하나의 오프라인
단일 HTML 파일**로 합친 결과물입니다. 이 폴더는 그 파일을 **재현 가능하게 생성**하고
**기능별로 검증**하는 스크립트를 담습니다.

## 구성

| 파일 | 설명 |
|---|---|
| `build_merged.py` | 병합 빌드 스크립트 (표준 라이브러리만 사용) |
| `test_merged.js` | puppeteer-core 기반 오프라인 검증 테스트 |
| `libs/chart.umd.min.js` | Chart.js 4.4.0 (hinge·servo용, 오프라인 인라인) |
| `libs/chart.umd.js` | Chart.js 4.4.1 (regression용, 오프라인 인라인) |
| `libs/html2canvas.min.js` | html2canvas 1.4.1 (hinge 테이블 이미지 저장용) |

## 병합 빌드

```bash
python3 build/build_merged.py
# → engineering_tools_all_in_one.html 생성
```

### 병합 방식
- 각 도구를 **격리된 `<iframe srcdoc>`** 로 임베드 → CSS/JS 전역 충돌 없음.
- iframe들은 부모와 **같은 origin** 이라 `localStorage` 를 공유 →
  4-Bar → 힌지(`hm_linkage_v1`) / 4-Bar → 리깅(`rig_linkage_v1`) **연동이 그대로 작동**.
- 외부 의존성(**Chart.js, html2canvas**)을 파일 안에 **인라인** → 완전 오프라인.
  Google Fonts 링크는 제거하고 시스템 한글 폰트로 폴백(오프라인에서도 정상 표시).
- 도구 안의 `window.open('...html#...')` 과 `href="index.html"` 을 가로채
  부모 셸의 **탭 전환**으로 변환(연동 시 대상 iframe 을 리로드해 localStorage 재수신).
- `</script>` 는 `<\/script>` 로 이스케이프해 부모 파서가 조기 종료되지 않도록 처리.

## 기능별 검증 (오프라인)

```bash
# 1) 테스트 러너 의존성 (인터넷 필요, 1회) — 시스템 Chrome 사용
npm install puppeteer-core

# 2) 실행 (외부 http/https 요청을 전부 차단한 상태로 검증 = 오프라인 증명)
node build/test_merged.js
```

> Chrome 경로는 `test_merged.js` 상단 `CHROME` 상수에서 조정할 수 있습니다.
> (기본값: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`)

### 검증 항목 (25종, 모두 통과)
- **셸**: 7개 탭 존재/전환
- **오프라인**: 외부(http/https) 요청 **0건**, 상위 프레임 JS 오류 0건
- **4-Bar**: 캔버스/결과 UI, 토크·기계이득 계산, AI 최적값 계산 실행,
  기구·출력토크·커플러 **그래프 렌더**
- **연동**: 4-Bar → 힌지 `window.open` 이 부모 탭전환 + `localStorage` 핸드오프
- **힌지모멘트**: Chart.js·html2canvas 인라인 로드, H KPI 계산, 링키지 수신,
  감도차트 + **풍동 시뮬레이션 애니메이션 동작**
- **회귀분석**: Chart.js 인라인, 샘플 → R² 산출, 산점도/잔차 **차트 렌더**
- **FRA**: Chart.js 인라인, 샘플 → 분석 → 대역폭/고유진동수 지표, Bode/파형 **차트 렌더**
- **CS Rigging**: 조종면/JSON(FCA_RIG) 구조, 예시 → 회귀식 계산 결과
- **매뉴얼**: 5개 섹션 + 검색 인덱스 74항목

## 재빌드가 필요할 때
도구 HTML(`*.html`) 을 수정하면 병합 파일을 다시 생성하세요:
```bash
python3 build/build_merged.py && node build/test_merged.js
```
