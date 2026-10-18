# Pingoose · 42 Intra Companion

GNOME Shell 42에서 Intra 프로필, 프로젝트, 학습시간, 평가, 아젠다와 알림을 확인하고 평가 슬롯 및 클러스터 채팅을 관리하는 확장입니다.

## 설치

Ubuntu GNOME 데스크톱 터미널에서 sudo 없이 실행합니다.

```sh
./install.sh
```

GNOME Shell 42, GJS, GTK 3, WebKit2 4.0, Soup 2.4, Python 3 GI가 필요합니다. 현재 소스를 패키징해 사용자 확장 경로에 설치합니다. **세션을 자동으로 재시작하지 않습니다.** 설치 후 직접 Shell을 리로드하거나 재로그인하세요. 첫 설치에서는 GNOME Extensions에서 Pingoose를 활성화하세요.

`main`은 제출용 제한 버전이며, 일반 채팅·슬롯 자동 오픈·개발 옵션을 숨기고 차단합니다. `dev`는 Hidden Options를 표시하며 세 기능이 기본 활성화됩니다. 두 브랜치 모두 `./install.sh`로 설치합니다.

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
  models/evaluations.js         평가·아젠다 데이터 정규화 및 상태 모델
  assets/42intra.png            웹뷰 앱 아이콘
  schemas/                     사용자 설정 스키마
  tests/                       회귀 검증 및 로컬 채팅 테스트
  scripts/package.sh           배포 ZIP 생성
```

`ui`의 Controller 모듈은 extension의 공유 상태를 사용하지만 각 기능의 렌더링과 동작을 독립적으로 관리합니다. GNOME 진입 파일과 메타데이터·스타일·스키마는 확장 규약에 맞춰 `src` 최상위에 둡니다.

## 동작과 설정

- 로그인은 별도 WebKit 창의 Intra 세션을 사용하며 로그인 계정과 PC 사용자명을 확인합니다.
- 프로필·프로젝트·학습시간·평가·아젠다는 해당 세션으로 조회합니다. 개인 OAuth 앱 키를 입력하는 초기 계획과 현재 구현은 다릅니다.
- General: 색상 모드, 화면 점등. Appearance: 각 영역 표시 여부.
- 평가 채팅: 평가 카드에서 확인된 상대와 시작 14분 50초 이내에만 연결합니다. 일반 채팅은 Hidden Options에서 별도로 활성화합니다.
- 채팅은 캠퍼스 좌석 PC 간 TCP 연결을 사용합니다. 계정 인증 기반 메신저가 아니며 상대 PC에서도 호환 수신 기능이 실행 중이어야 합니다.
- Intra 로그아웃 시 대화·입력·연결을 정리합니다.
- 설정은 GSettings, 로그인 및 조회 상태는 사용자 전용 데이터/상태 디렉토리에 저장됩니다. 소스나 배포 ZIP에 인증 데이터를 넣지 마세요.

## 프로젝트 메모

My Projects의 프로젝트를 클릭하면 왼쪽에 프로젝트 제목과 TODO List / Note 탭이 있는 패널이 열립니다. Add Note로 제목과 내용을 입력하고 Save를 누르면 로컬에 저장됩니다. TODO는 한 줄에 할 일 하나를 입력하고 저장 후 체크할 수 있습니다. Edit로 수정하며, 웹페이지는 하단 Visit Project Page로 엽니다.

Settings → Projects는 Appearance 바로 옆에 있습니다. Open project page directly를 켜면 메모 패널 대신 프로젝트 웹뷰를 바로 엽니다. 저장 목록은 생성일 오름차순이며 개별 Delete 및 확인 후 Delete All이 가능합니다. Default project tab에서 Note 또는 TODO List 중 먼저 표시할 탭을 선택합니다.

메모는 `$XDG_STATE_HOME/pingoose/notes/projects.json` (기본 `~/.local/state/pingoose/notes/projects.json`)에 사용자 전용 권한으로 저장됩니다. 프로젝트·로그인 계정별로 구분되며 Intra 로그아웃이나 재로그인으로 삭제하지 않습니다. 저장 전 초안은 현재 실행 중인 확장의 메모리에만 유지되므로 로그아웃·리로드 전에 Save가 필요합니다. 날짜별 알림이나 캘린더 연동은 없으며, TODO에 일정 텍스트를 적는 간단한 관리 기능입니다.

## 42 Services

메인페이지에서 `42 Services`를 열면 서비스 패널이 왼쪽에 표시됩니다. 채팅도 열려 있다면 서비스 → 채팅 → 메인페이지 순서입니다. ×로 닫기 전에는 메뉴를 다시 열어도 패널 열림 상태를 유지합니다.

- 기본 사이트: PeerFinder (`https://peerfinder.org/`), SUBAK (`https://subak.site/`).
- 기본 이름·URL은 `src/models/serviceSites.js`의 `DEFAULT_SITES`에서 편집합니다.
- Settings → 42 Services: 기능 활성화, 사이트 추가·수정·삭제, 기본 목록 복원. HTTPS 사이트를 최대 30개 저장합니다.
- Appearance → 42 Services: 버튼·패널 표시 여부. 기능 비활성화 시 열려 있는 서비스 웹뷰도 닫습니다.
- 카드는 공개 공유 이미지 또는 사이트 아이콘을 표시합니다. 이미지를 가져오지 못하면 기본 웹 아이콘을 표시합니다. 미리보기 이미지는 사용자 캐시에 저장됩니다.
- 서비스 창은 기존 Intra WebKit 컨텍스트를 공유합니다. 인증 서버 쿠키를 재사용하되 브라우저의 도메인별 쿠키 규칙을 따릅니다. 최초 서비스 권한 동의나 추가 인증은 사용자가 직접 진행합니다.
- Intra 로그아웃 시 서비스 창을 닫고 공유 웹뷰 데이터를 정리합니다.

## 채팅 보호 제한

다음 제한은 클러스터 채팅에 적용됩니다. 평가·아젠다 알림의 수신 빈도에는 적용하지 않습니다.

| 항목 | 제한 | 초과 시 동작 |
| --- | --- | --- |
| 수신 메시지 크기 | 메시지당 4,096바이트 | 해당 연결 종료 |
| 상대별 수신 빈도 | 10초 동안 20개 | 21번째 메시지를 처리하지 않고 해당 연결 종료 |
| 전체 수신 빈도 | 모든 상대 합산 10초 동안 100개 | 한도를 넘긴 메시지의 연결 종료 |
| 시스템 채팅 알림 | 전체 채팅에서 3초에 최대 1번 | 추가 팝업 생략. 메시지와 읽지 않은 수는 유지 |
| 대화 이력 | 상대별 최근 200개 | 오래된 기록부터 삭제. 연결 상태 안내도 포함 |
| 화면 메시지 요소 | 최대 200개 | 오래된 말풍선·상태 안내부터 제거 |
| 동시 연결 | 연결 시도 포함 16개 | 추가 연결 거절 |
| 상대 목록 | 최대 64개 | 새 상대 추가·수신 거절 |
| 전송 대기열 | 상대별 32개 | 추가 전송 요청 거절 |
| 수신 연결 확인 | 최대 15초 | 상대 주소 확인이 끝나지 않으면 종료 |
| 연결 유휴 시간 | 수신 데이터 없이 60초 | 연결 종료. 대화 내역은 유지 |

### 구현 방식과 한계

- 수신 데이터는 1,024바이트 단위로 읽습니다. 줄바꿈까지 누적한 메시지가 4,096바이트를 넘으면 연결을 종료하므로, 긴 데이터를 모두 읽은 뒤 잘라내는 방식이 아닙니다. 바이트 제한은 한글 글자 수와 다릅니다.
- 빈도 제한은 상대별·전체 카운터를 사용하며, 10초가 지난 뒤 다음 메시지를 처리할 때 초기화합니다. 이동 시간창(sliding window) 방식은 아니므로 시간창 경계에서 순간적으로 메시지가 몰릴 수 있습니다.
- 제한 초과에 따른 연결 종료는 영구 차단이 아닙니다. IP별 재접속 속도 제한은 아직 없습니다. 일반 채팅을 끄면 해당 일반 연결과 기록을 제거합니다.
- 시스템 알림은 3초 이내 추가 팝업을 생략합니다. 메시지를 합쳐 나중에 알리는 방식이 아니며, 생략된 알림을 다시 띄우지도 않습니다.
- 60초 유휴 종료는 정상 대화에도 적용됩니다. 다음 메시지를 보낼 때 필요하면 재연결합니다. 이 타이머는 마지막 완성 메시지가 아닌 수신 데이터 기준이므로, 데이터를 조금씩 보내는 연결에 대한 절대 유지시간 제한은 아닙니다.
- 채팅은 일반 TCP입니다. 암호화 및 상대 계정 인증은 아직 없으며, 좌석 주소·차단 규칙이 사용자의 신원을 보장하지 않습니다.
- 채팅 알림을 클릭하면 익스텐션과 해당 대화가 열립니다. 평가·아젠다 알림은 익스텐션 메뉴를 엽니다.
- 인증 갱신은 WebKit 세션을 다시 로드해 얻는 토큰으로 처리합니다. 별도 Python 토큰 갱신 파일 및 외부 `session.json` 탐색 경로는 제거했습니다. Intra 로그아웃 시 확장 전용 상태 디렉토리의 `session.json`과 평가 캐시도 삭제합니다. 과거 다른 경로에 저장된 파일을 찾아 삭제하거나 서버의 토큰을 폐기하는 기능은 아닙니다.

관련 구현: `src/services/chat.js`, `src/ui/chatPanel.js`, `src/ui/notifications.js`, `src/worker/webview.js`.

## 검증 및 배포

프로젝트 루트에서:

```sh
for test in src/tests/*-*.cjs; do node "$test" || exit; done
gjs src/tests/chat-loopback.js
src/scripts/package.sh /tmp/pingoose-release
```

Node 검증은 GNOME UI 일부를 모의 환경에서 검사합니다. GJS 채팅 검증은 로컬 주소로만 연결합니다. 실제 Shell 화면 배치와 다른 PC 사이 통신은 별도로 확인해야 합니다. 패키징 결과에는 `ui`, `services`, `worker`, `models`, `assets`와 GNOME 기본 파일만 포함됩니다.

### 설정 초기화와 코드 구조

- Settings → General → Reset All Data: 확인 후 설정을 기본값으로 복원하고, 저장된 노트/TODO, 채팅 내역, 알림, 프로필·이미지 캐시와 웹뷰 로그인 데이터를 삭제하며 Intra에서 로그아웃합니다. 서버의 프로젝트나 평가 슬롯은 변경하지 않습니다.
- 웹뷰 데이터 삭제가 성공하고 웹뷰 프로세스가 종료된 다음 확장 전용 XDG state/cache/data의 `pingoose` 내부 파일을 지웁니다. 심볼릭 링크의 대상은 따라가지 않습니다. 로그아웃 상태 표식과 빈 디렉터리는 유지되며, 웹뷰를 다시 시작할 때 빈 저장소가 생성될 수 있습니다.
- 초기화 기능을 추가한 버전으로 세션을 리로드한 뒤 사용합니다. 확장이 비활성 상태라면 초기화 요청은 다음 활성화 때 처리됩니다. 완료/실패 상태는 General에서 확인합니다.
- `src/prefs.js`는 탭 조립만 담당하고, 기능별 UI는 `src/preferences/{general,appearance,projects,services,hidden,layout}.js`, 공통 행·확인창은 `common.js`로 분리했습니다.
- 설정 초기값의 단일 원본은 `src/schemas/org.gnome.shell.extensions.pingoose.gschema.xml`입니다. `src/models/settingsDefaults.js`는 기본 서비스 목록과 스키마 기반 초기화 정책을 담당합니다. 초기값을 중복 선언하지 않습니다.
- 전체 초기화 흐름은 `src/ui/reset.js`, 파일 정리는 `src/services/resetData.js`에 분리했습니다. 개발용 테스트는 임시 XDG 디렉터리와 메모리 설정으로 실행합니다.

Appearance의 섹션 순서는 ↑/↓로 편집한 뒤 Apply를 눌러 저장합니다. 표시 스위치와 하단 Popup Position & Panel Spacing은 즉시 반영됩니다. 기본값은 상단 6px, 좌측 이동 9px, 메인–패널 및 패널–패널 간격 각각 12px이며 간격 0은 맞붙음을 의미합니다.

### 평가 상대 채팅 및 숨김 기능

- 평가 시작 14분 50초 전부터 시작 직전까지, 그 구간에 상대의 닉네임과 좌석을 확인하면 평가 카드의 사용자 정보 아래 Cluster Chat 버튼이 나타납니다. 좌석이 확인되지 않으면 버튼을 표시하지 않습니다.
- 클릭하면 상대 좌석을 직접 선택한 채팅 패널을 엽니다. 양쪽의 평가 ID·닉네임·좌석 정보가 일치해야 합니다. 상대도 이 버전의 확장을 사용해야 하며, 기존 평문 채팅 프로토콜과는 호환되지 않습니다.
- 확인한 좌석은 일시적인 조회 실패에도 시작 전까지 유지합니다. 시작 시각부터 송수신을 거절하고, 최대 다음 UI 타이머 주기(약 1초)에 연결·대기 메시지·메모리 기록·채팅 알림을 지웁니다. 평가는 사용자 확인으로 삭제할 때까지 기존 카드에 남습니다.
- 제출 버전에서는 상시 Cluster Chat 버튼과 관련 일반 설정 탭/Appearance 항목을 표시하지 않습니다. 평가 채팅은 숨김 옵션을 켜지 않아도 작동합니다.
- Hidden Options의 Cluster Chat은 양쪽이 활성화한 경우에만 일반 좌석 채팅을 허용합니다. Auto Open Evaluation Slots는 한 번 클릭하면 현재 시각보다 최소 30분 뒤의 15분 경계부터, 30분 열림/30분 간격으로 5개 슬롯을 요청합니다. Add Developer Options는 테스트 알림 및 더미 평가 메뉴를 표시합니다.
- 브랜치 정책은 `src/models/featureFlags.js`의 `HIDDEN_OPTIONS`와 `DEVELOPMENT_DEFAULTS`로 분리했습니다. main은 둘 다 false, dev는 둘 다 true입니다. 42 Services 탭을 선택한 상태에서 (입력란 없이) `pingoose-hidden-on`을 영문으로 타이핑하면 안내창과 함께 Hidden Options 탭이 즉시 나타납니다. `pingoose-hidden-off`를 입력하면 탭과 관련 기능이 비활성화됩니다(dev에서도 동일). 해금 상태는 로컬 설정에 저장되며 각 기능은 직접 켜야 합니다. Reset All Data를 실행하면 main에서는 다시 잠깁니다. 설정 초기화는 명시적 사용자 값을 제거하고 해당 브랜치 기본값을 복원합니다.
- 숨김 옵션은 제품 기능 구분이며 보안 인증 수단이 아닙니다. 좌석 네트워크·로컬 Intra 평가 정보를 바탕으로 제한하며, TCP 연결에는 TLS나 사용자 서명 인증이 없습니다. 수정된 클라이언트에 대한 암호학적 신원 보장은 하지 않습니다.
