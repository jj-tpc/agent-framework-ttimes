# Supabase 설정 — 여러 사람이 각자 계정으로 쓰기

환경 변수에 Supabase 를 넣으면 앱이 **여러 사용자 모드**로 바뀝니다.

- Google 계정으로 로그인해야 들어올 수 있습니다.
- 프로젝트 · 메모리 · 대화 기록 · LLM API 키 · 커넥터 토큰 · MCP 서버가 로그인한 사람별로 따로 저장됩니다.
- 환경 변수를 빼면 지금처럼 로그인 없이 `data/` 폴더에 저장하는 모드로 돌아갑니다. 두 모드의 데이터는 서로 옮겨지지 않습니다.

아래 1~5 는 직접 하셔야 합니다(계정 생성과 키 입력).

## 1. Supabase 프로젝트 만들기

1. <https://supabase.com> 에서 프로젝트를 새로 만듭니다. 리전은 가까운 곳(예: Seoul)을 고릅니다.
2. **Project Settings → API** 에서 두 값을 적어 둡니다.
   - Project URL (`https://<프로젝트>.supabase.co`)
   - Publishable key (예전 이름: anon public key)

`service_role` 키는 쓰지 않습니다. 넣지 마세요.

## 2. 테이블 만들기

**SQL Editor** 에 [`supabase/schema.sql`](../supabase/schema.sql) 내용을 붙여 넣고 실행합니다. 테이블 하나(`app_files`)와 "자기 행만 읽고 쓴다"는 보안 정책이 만들어집니다.

## 3. Google OAuth 클라이언트 만들기

Google Cloud 콘솔(<https://console.cloud.google.com>)에서 합니다. 로그인과 커넥터가 같은 클라이언트를 씁니다.

1. 프로젝트를 만들고 **API 및 서비스 → 라이브러리** 에서 Gmail API · Google Calendar API · Google Drive API · Google Sheets API · Google Docs API 를 사용 설정합니다.
2. **OAuth 동의 화면** 을 만듭니다. 게시 상태가 "테스트"인 동안에는 **테스트 사용자** 에 쓸 사람의 Google 계정을 모두 추가해야 합니다.
3. **사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션** 을 만들고, **승인된 리디렉션 URI** 에 두 주소를 넣습니다.

   | 용도 | 주소 |
   |---|---|
   | 로그인 (Supabase 가 받음) | `https://<프로젝트>.supabase.co/auth/v1/callback` |
   | 커넥터 (이 앱이 받음) | `<앱 주소>/api/connectors/google/callback` |

   앱 주소는 로컬이면 `http://localhost:3000`, 배포했으면 그 도메인입니다. 포트나 도메인이 여럿이면 각각 넣습니다.
4. 클라이언트 ID 와 보안 비밀번호를 적어 둡니다.

## 4. Supabase 에 Google 로그인 켜기

1. **Authentication → Sign In / Providers → Google** 을 켜고, 3번의 클라이언트 ID 와 보안 비밀번호를 넣습니다.
2. **Authentication → URL Configuration** 에서
   - Site URL: 앱 주소
   - Redirect URLs: `<앱 주소>/auth/callback` (로컬과 배포 주소를 모두 추가)

## 5. 환경 변수 넣기

프로젝트 폴더에 `.env.local` 파일을 만들고 넣습니다(이 파일은 git 에 올라가지 않습니다).

```
NEXT_PUBLIC_SUPABASE_URL=https://<프로젝트>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>

# 커넥터용 Google OAuth 앱. 넣어 두면 사용자는 등록 폼 없이 '연결'만 누릅니다.
GOOGLE_OAUTH_CLIENT_ID=<클라이언트 ID>
GOOGLE_OAUTH_CLIENT_SECRET=<보안 비밀번호>

# (선택) 모든 사용자가 함께 쓸 LLM 키. 사용자가 자기 키를 넣으면 그 키가 우선합니다.
# ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
# GEMINI_API_KEY=
```

서버를 다시 시작하면 로그인 화면이 뜹니다.

## 동작 확인

1. 첫 화면이 `/login` 으로 바뀌고 "Google 계정으로 로그인"이 보이는지.
2. 로그인하면 프로젝트 목록이 비어 있는지(파일 모드의 프로젝트는 넘어오지 않습니다).
3. 프로젝트를 하나 만들고 Supabase **Table Editor → app_files** 에 `projects/….json` 행이 생기는지.
4. 다른 Google 계정으로 로그인했을 때 앞 계정의 프로젝트가 보이지 않는지.
5. 설정 → 커넥터에서 "연결"을 눌러 Google 동의 창이 뜨는지.

## 알아 둘 점

- **토큰과 API 키는 DB 에 평문 JSON 으로 저장됩니다.** 보호는 Supabase 의 저장 암호화와 행 수준 보안에 맡깁니다. Supabase 대시보드에 들어올 수 있는 사람은 볼 수 있습니다.
- **코드 노드와 직접 만든 도구는 서버에서 JavaScript 를 실행합니다.** 믿을 수 없는 사람에게 공개하는 서버라면 이 기능이 위험합니다. 인원이 정해진 시연이나 사내용을 전제로 하세요.
- **스킬 · 플러그인 · 지식베이스 · 템플릿은 공용**입니다. 한 사람이 만든 스킬은 모두에게 보입니다.
- **로컬(stdio) MCP 서버는 여러 사용자 모드에서 꺼집니다.** 서버에서 명령을 실행하기 때문입니다.
- **Google 심사**: 동의 화면이 "테스트"면 테스트 사용자(최대 100명)만 로그인할 수 있고 토큰이 7일 뒤 만료됩니다. 공개하려면 Google 심사가 필요하고, Gmail 읽기 권한은 보안 평가까지 요구됩니다. 공개 전에 Google 문서로 조건을 확인하세요.
