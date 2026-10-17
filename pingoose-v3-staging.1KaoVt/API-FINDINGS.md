# 예약된 평가 조회 API 조사 — 2026-10-16

## 확인된 실제 인트라 요청

공개된 **실제 profile-v3 프런트엔드 번들**에서 `Pending evaluations` 카드의 데이터 요청을 찾았다.

```http
GET https://intrapy.intra.42.fr/api/v1/users/me/scale_teams
Content-Type: application/json
Authorization: Bearer <인트라 화면의 access_token>
```

이 호출에는 `filter[future]`나 `campus_id` 쿼리 파라미터가 붙지 않는다.
지금까지 Pingoose가 조회한 `https://api.intra.42.fr/v2/users/{id}/scale_teams`와 **서버·경로가 다르다**.

### 1차 자료: 실제 배포 코드

- 페이지: https://profile-v3.intra.42.fr/
- 메인 번들: https://profile-v3.intra.42.fr/assets/index-1bf7d3bc.js
- 홈 번들: https://profile-v3.intra.42.fr/assets/Home-f4561059.js

홈 번들의 `qT` 함수에서 다음 부분을 확인했다. 아래는 공개 코드의 해당 부분이며 개인 토큰이 아니다.

```javascript
const l = new URL("/api/v1/users/me/scale_teams", "https://intrapy.intra.42.fr");
o.append("Content-Type", "application/json");
o.append("Authorization", `Bearer ${(n == null ? void 0 : n.access_token) || ""}`);
const s = await fetch(l, {headers: o, method: "GET"});
const c = await s.json();
return ca(c);
```

호출 관계도 확인했다:

- `KT`: 제목이 `Pending evaluations`인 `evaluations` 카드.
- `VT`: `qT()`의 결과 배열을 `HT` 컴포넌트로 전달.
- `HT`: `id`, `user`, `kind`, `projectName`, `beginAt`, `canCancel`, `canReport`를 읽음.
- `kind === "evaluator"`이면 `You will evaluate` / `You are ready to evaluate`를 표시.
- 다른 역할이면 `You will be evaluated by`를 표시.
- 위 필드명은 **프런트의 키 변환 이후 이름**이다. 인증된 실제 응답의 원본 JSON 스키마는 아직 수집하지 않았다.
- 훅에는 `refetchOnMount: false`, `refetchOnWindowFocus: false`, `refetchOnReconnect: false`가 명시돼 있다.

## 인증도 구분해야 함

메인 번들의 학생 로그인 설정:

```javascript
{
  authority: "https://auth.42.fr/auth/realms/students-42",
  client_id: "frontend-react"
}
```

프런트의 OIDC 리디렉트 주소는 `https://profile-v3.intra.42.fr`이다.
이는 Pingoose용 기존 v2 API 앱의 `http://localhost:4343/auth/callback` 등록과 별개다.
**공식 프런트의 client_id에 임의의 localhost 리디렉트를 붙여 우회하면 안 된다.**

공개 OIDC 메타데이터:

https://auth.42.fr/auth/realms/students-42/.well-known/openid-configuration

- Authorization: `/auth/realms/students-42/protocol/openid-connect/auth`
- Token: `/auth/realms/students-42/protocol/openid-connect/token`
- PKCE: `S256` 지원.

화면은 이 OIDC 로그인에서 얻는 access token을 API 요청에 사용한다.
기존 `api.intra.42.fr/oauth/token`에서 발급한 앱/사용자 토큰을 같은 인증으로 취급하면 안 된다.
이 조사에서는 기존 토큰을 새 서비스로 전달하거나 브라우저의 쿠키·토큰을 추출하지 않았다.

## 실제 HTTP 확인 범위

자격 증명 없이 해당 주소로 GET 요청한 결과:

```http
HTTP 401
{"detail":"No token provided"}
```

경로의 근거는 401 자체가 아니라 **실제 배포 프런트의 호출 코드**다.
공개 스키마 확인 시 `/openapi.json`은 Not Found, `/api/v1/openapi.json`은 토큰 요구 응답이었다.

## 남은 작업 / 과장하면 안 되는 부분

- 인트라 로그인 세션으로 위 GET의 실제 예약 응답을 확인하고, 그 데이터에 감지기를 연결해야 한다.
- 사용자가 직접 로그인한 전용 웹뷰 안에서 이 요청을 관찰/조회하는 방법을 쓸 수 있다. 일반 브라우저의 쿠키나 비밀번호를 복사할 필요는 없다.
- 현재 이 경로는 **본인 목록**이다. 캠퍼스 일괄 조회 경로·필터·권한은 확인하지 못했다.
- 레거시 v2의 `filter[campus_id]=69` 지원 사실을 이 새 API에 그대로 적용할 수 없다.
- 새 서비스의 호출 제한과 제3자 앱용 정식 인증 방법도 별도로 확인해야 한다.
- 기존 `api.py`와 설치된 확장은 아직 레거시 v2 API를 사용한다. 이번 조사는 런타임 코드나 예약·알림 기준 목록을 변경하지 않았다.

인증된 실제 예약 데이터 수신은 아직 검증하지 않았으며, 이 문서에는 자격 증명·토큰·다른 사용자의 평가 상세를 저장하지 않았다.
