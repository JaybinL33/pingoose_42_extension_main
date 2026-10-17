# Pingoose · 42 Intra Companion

GNOME Shell 42에서 Intra 프로필, 프로젝트, 학습시간, 평가, 아젠다와 알림을 확인하고 평가 슬롯 및 클러스터 채팅을 관리하는 확장입니다.

## 설치

Ubuntu GNOME 데스크톱 터미널에서 sudo 없이 실행합니다.

```sh
./install.sh
```

GNOME Shell 42, GJS, GTK 3, WebKit2 4.0, Soup 2.4, Python 3 GI가 필요합니다. 현재 소스를 패키징해 사용자 확장 경로에 설치합니다. **세션을 자동으로 재시작하지 않습니다.** 설치 후 직접 Shell을 리로드하거나 재로그인하세요. 첫 설치에서는 GNOME Extensions에서 Pingoose를 활성화하세요.

개발용 알림·평가 카드 생성 메뉴를 포함하려면:

```sh
./install.sh --dev
```

일반 설치와 배포 ZIP에는 개발용 UI와 테스트가 포함되지 않습니다.

## 소스 구조

```text
README.md
install.sh
presentation/                  발표자료 및 기존 개발 계획서
src/
  extension.js                 GNOME 진입점, 수명주기, worker IPC
  prefs.js                     별도 설정 창
  metadata.json                확장 정보
  stylesheet.css               화면 스타일
  ui/
    indicator.js               탑바 및 메인페이지, 프로필·프로젝트
    settings.js                메뉴와 로그아웃 확인
    evaluations.js             평가 카드 및 피드백 확인
    slots.js                   슬롯 목록과 닫기 요청
    agenda.js                  아젠다 카드
    notifications.js           알림 카드·시스템 알림·화면 점등
    visibility.js              영역 표시와 높이, 탑바 카운트
    chatPanel.js               좌측 채팅 패널
  services/
    chat.js                    좌석 TCP 통신·차단 규칙
    slotsService.js            WebKit 세션 기반 슬롯 API
    systemSessionHook.js       PC 로그아웃 시 열린 슬롯 확인
  worker/
    webview.js                 별도 GTK/WebKit 프로세스, 인증·폴링·캐시
    profile.js                 DOM 프로필 및 학습시간 파싱
    token_refresher.py          인증 갱신 보조
  models/evaluations.js         평가·아젠다 데이터 정규화 및 상태 모델
  assets/42intra.png            웹뷰 앱 아이콘
  schemas/                     사용자 설정 스키마
  dev/devOptions.js            개발용 알림·더미 평가 메뉴
  tests/                       회귀 검증 및 로컬 채팅 테스트
  scripts/package.sh           배포 ZIP 생성
```

`ui`의 Controller 모듈은 extension의 공유 상태를 사용하지만 각 기능의 렌더링과 동작을 독립적으로 관리합니다. GNOME 진입 파일과 메타데이터·스타일·스키마는 확장 규약에 맞춰 `src` 최상위에 둡니다.

## 동작과 설정

- 로그인은 별도 WebKit 창의 Intra 세션을 사용하며 로그인 계정과 PC 사용자명을 확인합니다.
- 프로필·프로젝트·학습시간·평가·아젠다는 해당 세션으로 조회합니다. 개인 OAuth 앱 키를 입력하는 초기 계획과 현재 구현은 다릅니다.
- General: 색상 모드, 화면 점등. Appearance: 각 영역 표시 여부.
- Cluster Chat: 송수신 활성화, 좌석(`c2r3s4`)·라인(`c2r3`)·클러스터(`c2`) 단위 차단.
- 채팅은 캠퍼스 좌석 PC 간 TCP 연결을 사용합니다. 계정 인증 기반 메신저가 아니며 상대 PC에서도 호환 수신 기능이 실행 중이어야 합니다.
- Intra 로그아웃 시 대화·입력·연결을 정리합니다. 차단 규칙은 설정에 보존합니다.
- 설정은 GSettings, 로그인 및 조회 상태는 사용자 전용 데이터/상태 디렉토리에 저장됩니다. 소스나 배포 ZIP에 인증 데이터를 넣지 마세요.

## 검증 및 배포

프로젝트 루트에서:

```sh
for test in src/tests/*-*.cjs; do node "$test" || exit; done
gjs src/tests/chat-loopback.js
src/scripts/package.sh /tmp/pingoose-release
```

Node 검증은 GNOME UI 일부를 모의 환경에서 검사합니다. GJS 채팅 검증은 로컬 주소로만 연결합니다. 실제 Shell 화면 배치와 다른 PC 사이 통신은 별도로 확인해야 합니다. 패키징 결과에는 `ui`, `services`, `worker`, `models`, `assets`와 GNOME 기본 파일만 포함됩니다.
