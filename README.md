# Sticky

윈도우·맥에서는 메모마다 창이 따로 뜨는 데스크톱 앱으로, 아이폰에서는 홈 화면 웹앱으로 쓰는 스티커 메모.

- **윈도우·맥**: [Releases](https://github.com/limmmmmmn/Sticky/releases/latest)에서 받기
- **아이폰**: 사파리로 <https://limmmmmmn.github.io/Sticky/> → 공유 → 홈 화면에 추가

## 할 수 있는 것

- 메모 한 장 = 창 하나. 위치·크기·열려 있던 메모를 기억해서 다시 켜면 그대로 떠
- 📌 항상 위에 두기, 8가지 색, 굵게·기울임·밑줄·취소선, 글머리 기호, 체크리스트, 사진 붙여넣기
- 목록 창에서 검색, 색 바꾸기, 삭제. 트레이 아이콘, 로그인할 때 자동 실행
- 어디서든 `Ctrl+Alt+N`(맥 `⌘⌥N`)으로 새 메모
- 로그인하면 윈도우·맥·아이폰 메모가 실시간으로 맞춰져 (Firebase)

## 동기화 켜기 (한 번만)

1. <https://console.firebase.google.com> → 프로젝트 추가 (애널리틱스는 꺼도 돼)
2. **Authentication** → 시작하기 → 로그인 방법에서 **이메일/비밀번호** 사용 설정
3. **Firestore Database** → 데이터베이스 만들기 → 위치 `asia-northeast3 (서울)` → 프로덕션 모드
4. Firestore **규칙** 탭에 [`firestore.rules`](firestore.rules) 내용을 붙여넣고 게시
5. 프로젝트 설정 → 내 앱 → 웹(`</>`) 앱 추가 → 나오는 `firebaseConfig` 값을
   [`src/shared/firebase-config.js`](src/shared/firebase-config.js)에 넣기

## 개발

```bash
npm install
npm start          # 데스크톱 앱 실행 (개발용 데이터는 %APPDATA%/Sticky-dev)
npm run build:site # 아이폰 웹앱 → out/site
npm test           # 동기화 규칙 테스트
npm run dist:win   # 윈도우 설치 파일 → release/
```

`v1.2.3` 같은 태그를 올리면 GitHub Actions가 윈도우 설치 파일과 맥 dmg를 만들어 Releases에 올리고,
main에 올리면 아이폰 웹앱이 Pages로 배포돼. 윈도우 앱은 새 버전을 알아서 받아.

```
electron/        메인 프로세스(창·트레이·저장), preload
src/shared/      편집기, 메모 규칙, 동기화, 로그인 화면, 색
src/desktop/     메모 창, 목록 창
src/mobile/      아이폰 웹앱, 서비스 워커
scripts/         빌드, 아이콘 생성
```
