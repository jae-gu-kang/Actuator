# Engineering Tools — 병합 빌드 & 검증

`engineering_tools_all_in_one.html` (저장소 루트)은 6개 도구 + 매뉴얼을 **하나의 오프라인
단일 HTML 파일**로 합친 결과물입니다. 이 폴더는 그 파일을 **재현 가능하게 생성**하고
**기능별로 검증**하는 스크립트를 담습니다.

## 구성

| 파일 | 설명 |
|---|---|
| `build_merged.py` | 병합 빌드 스크립트 (표준 라이브러리만 사용) |
| `test_merged.js` | puppeteer-core 기반 오프라인 검증 테스트 |
| `test_optvars.js` | 4-Bar 설계 변수(고정/변수) 불변식 회귀 테스트 (브라우저 불필요) |
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

### 검증 항목 (32종, 모두 통과)
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

## 4-Bar 설계 변수 회귀 테스트 (`test_optvars.js`)

`4-bar-linkage-torque.html` 의 옵티마이저는 네 링크(고정 d · 입력 a · 커플러 b · 출력 c)를
각각 '고정/변수'로 지정할 수 있습니다. 이 테스트가 지키는 핵심 계약은

> **기본 변수집합(c·b 변수, a·d 고정)에서 `optimizeForVars` 는
> 기존 `optimizeForDeltaWithC` 와 완전히 같은 결과를 낸다.**

두 함수를 같은 프로세스에서 직접 비교하므로 예전 빌드를 따로 보관할 필요가 없습니다.
브라우저 없이 `<script>` 본문만 `vm` 으로 올려 실행합니다(약 40초).

```bash
node build/test_optvars.js            # 기본: ../4-bar-linkage-torque.html
node build/test_optvars.js <파일경로>  # 다른 사본을 검사할 때
```

검증 항목 (14종): 기본 경로 동일성(비대칭 2-패스 실제 floor 포함) · 모든 조합에서 `S.a/b/c/d` 복원
(편심 `offY`·cross 해 포함) · 최소 1개 고정 강제(스케일 불변) · 전부 고정 시 θ₄₀만 탐색 ·
b 고정 시 b 불변 · 뒤집힌 탐색범위 자동 폴백 · 사용자 지정 범위 강제 ·
**적용 경로 4종**(고정 링크 건너뜀 / 빈 칸이면 부분 적용 없이 전체 취소 /
범위 밖은 클램프 아닌 취소 / a·d 가 #ia·#id 입력칸까지 반영) ·
**비유한 θ₄₀ 거부**(±Infinity 는 0.25° 스윕이 전진하지 못해 UI 가 멈춘다).
**전달각 입력·출력 양측 ≥45° 제약** · calcMAatT4 의 muIn/muOut 제공.

## 재빌드가 필요할 때
도구 HTML(`*.html`) 을 수정하면 병합 파일을 다시 생성하세요:
```bash
python3 build/build_merged.py && node build/test_merged.js
```
`4-bar-linkage-torque.html` 의 옵티마이저를 건드렸다면 추가로:
```bash
node build/test_optvars.js
```
