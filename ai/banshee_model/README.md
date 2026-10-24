# Banshee Twin Jet — Blender 모델

첫 번째 사진에 맞춰 긴 기수, 가는 동체, 작은 수직미익으로 수정한 Banshee 외형 모델입니다. 후방 쌍제트 표시는 유지했습니다.

엘러본은 앞뒤 폭을 줄이고 인보드와 아웃보드의 폭 차이를 작게 조정했습니다. 기수는 도색 경계에서 형상이 꺾이지 않는 하나의 연속 곡면으로 동체에 이어집니다.

- **Banshee_TwinJet.blend**: 조종면과 러더의 회전 장치를 포함한 편집용 원본입니다.
- **Banshee_TwinJet.glb**: 다른 3D 프로그램에서 사용할 수 있는 중립 자세의 기체 단독 모델입니다. 회전 조작은 Blender 원본에서 지원합니다.
- **previews/**: 뒤쪽 사선, 앞쪽 사선, 상면, 측면 렌더 이미지와 조종면 작동 미리보기입니다.

## 편집

`BANSHEE · aircraft assembly`를 이동하면 기체 전체가 함께 움직입니다. 고정 주익과 동체는 `AIRFRAME · joined fuselage and wings`라는 하나의 연결 메시로 합쳤습니다. 양쪽 조종면과 러더는 각각 별도 힌지에 연결돼 있습니다.

## 조종면 움직이기

1. `CONTROLS · select me`를 선택합니다. 파일을 열면 이 개체가 선택돼 있습니다.
2. 오른쪽 **오브젝트 속성 → 사용자 정의 속성**에서 각도를 바꿉니다.
3. `Left_Elevon`은 왼쪽 조종면, `Right_Elevon`은 오른쪽 조종면, `Rudder`는 러더입니다.

각도 범위는 **−25° ~ +25°**, 중립은 **0°**입니다. 양쪽 조종면은 양수일 때 위로 움직입니다. 조종면 위 글자와 돌출 부품도 함께 움직입니다.

`DEMO · elevons and rudder`라는 시연 Action도 보관했습니다. 수동으로 각도를 조절할 수 있도록 기본 상태에서는 이 Action을 연결하지 않았습니다.

`07 · TRANSPORT TROLLEY (optional)` 컬렉션의 표시를 끄면 운반대를 숨길 수 있습니다. 렌더에서 제외하려면 해당 컬렉션의 카메라 아이콘도 끄세요.

`08 · STUDIO & CAMERAS`에 사선·상면·측면·후면 카메라가 있습니다. 작업 화면에서는 조명과 카메라를 숨겨 두었으며 렌더에는 정상적으로 사용됩니다.

`09 · PHOTO REFERENCES (hidden)`에 원본 참조 사진 3장을 파일에 포함했습니다.

사진을 보고 비율을 재구성한 시각화 모델이며 실측 도면 기반 모델은 아닙니다. 수정 전 Blender 파일은 `versions/Banshee_before_revision.blend`에 보관했습니다.

제작 및 저장: Blender 5.2.1. 원본 생성 스크립트는 같은 폴더의 `build_banshee.py`, `build_cart.py`입니다.
