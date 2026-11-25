# Node Trace — Dify 형식 에이전트 편집·실행 추적기

Dify 형식(DSL)의 에이전트 로직을 노드 단위로 만들고, 채팅으로 실행했을 때
**각 노드가 어떤 입력을 받아 → 어떤 과정을 거쳐 → 어떤 결과를 냈는지** 확인하는 웹앱입니다.

```
로비(프로젝트 목록) ──▶ 새 프로젝트 만들기 / 기존 프로젝트 선택 ──▶ 편집기(캔버스 · 노드 설정/실행 기록 · 디버그 채팅)
```

## 실행

```bash
npm install
npm run dev          # http://localhost:3000
```

처음 열면 로비 오른쪽 위 **API 키**에서 쓰려는 공급자(Anthropic · OpenAI · Google)의 키를 넣고 **테스트**를 누르세요.
키는 서버의 `data/settings.json`(.gitignore 대상)에 저장됩니다. 환경변수 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`
(`.env.local`)로 넣어도 되며, 화면에서 저장한 키가 우선합니다. 설정에서는 키만 관리하고, **모델과 하이퍼파라미터는 노드마다** 고릅니다.

키가 없는 공급자의 모델을 쓰는 노드는 "API 키가 없습니다" 오류로 멈추고, 편집기 채팅창 위에 어떤 키가 필요한지 표시됩니다.
키 없이 화면 흐름만 보려면 서버를 `LLM_MODE=mock`으로 실행하세요.

## 화면

### 로비
- 프로젝트 카드(아이콘, 노드 구성, 마지막 수정 시각), 복제·삭제
- **새 프로젝트**: 템플릿(빈 워크플로 / 고객지원 에이전트 / 기사 요약·번역 / 문의 라우터 / 기억하는 비서)에서 시작하거나 **Dify DSL(YAML) 가져오기**.
  고객지원 템플릿에는 환불 처리 노드를 묶은 '환불 판정' 블록이, 문의 라우터 템플릿에는 분기 노드 세 가지 방식이 차례로, 기억하는 비서 템플릿에는 LLM 노드에 붙은 메모리 모듈이 들어 있습니다.

### 편집기
- **캔버스**: 노드 추가(선택한 노드가 있으면 오른쪽에 붙여 자동 연결), 드래그 이동, 핸들을 끌어 연결, Delete 키로 노드·선 삭제.
  편집 내용은 자동 저장됩니다.
- **블록**: 여러 노드를 한 영역으로 묶습니다(아래 "블록" 참고).
- **노드 패널 — 설정 탭**: 노드 타입별 폼
  - LLM: 공급자·모델·하이퍼파라미터, 컨텍스트 주입, 메시지별 프롬프트(“변수 삽입”으로 `{{#노드.변수#}}` 끼워 넣기), 대화 메모리
  - 분기(텍스트 포함 · 코드 · AI 판단), 질문 분류기(클래스 = 출력 핸들), 파라미터 추출, 지식 검색(데이터셋·Top K), IF/ELSE(조건·ELIF), 코드(JS/Python), 템플릿(Jinja2), 시작 변수, 답변
  - 그 밖의 노드와 세부 필드는 "고급: data 블록 YAML로 편집"
- **노드 패널 — 실행 기록 탭**: Dify의 `inputs / process_data / outputs` 구성
  - 입력 — 변수 풀에서 읽은 값 (참조를 "노드 제목 › 변수" 칩으로)
  - 처리 과정 — LLM은 프롬프트 템플릿 ↔ 렌더링 결과 비교, 실제 API 요청 본문, 추론 요약 / 분류기·추출기는 구조화 출력 / IF/ELSE는 조건별 실제 값과 참거짓 / 지식 검색은 후보 점수 / 코드는 인자 바인딩과 표준 출력
  - 출력 — 변수 풀에 기록된 값
- **디버그 채팅**: 저장 전 편집 상태 그대로 실행. 메시지마다 노드 실행 순서·분기·소요 시간, LLM 생성 텍스트 실시간 표시, "변수 풀 보기"
- **앱 설정**: 이름·아이콘·설명, 시작 인사말, 예시 질문, 환경 변수(`env.*`), 대화 변수(`conversation.*`)
- **DSL**: 현재 워크플로를 Dify DSL YAML로 보기·복사·내려받기 (Dify 스튜디오로 다시 가져갈 수 있음)

## 분기 노드

분기마다 출력 점이 하나씩 생기고, 어느 분기에도 맞지 않으면 마지막 '그 외' 점으로 갑니다. 설정 맨 위에서 방식을 고릅니다.
세 방식이 같은 분기 목록을 쓰므로 방식을 바꿔도 연결된 선은 그대로입니다.

| 방식 | 분기마다 정하는 것 | 고르는 규칙 |
|---|---|---|
| 텍스트 포함 | 비교 방법(하나라도 포함 · 모두 포함 · 하나도 포함 안 함 · 시작 · 정확히 일치 · 정규식) + 문구 목록 | 위에서부터 검사해 처음 맞는 분기. 화살표로 순서 변경, 대소문자 구분 선택 |
| 코드 | 분기 이름 | `main({ text, … })`(JavaScript) / `def main(text, …)`(Python)이 돌려준 분기 이름(또는 ID). `null`·`None`·`false` → 그 외, `true` → 첫 분기, `{ branch, reason }` 이면 근거도 기록. 없는 이름이면 오류 |
| AI 판단 | 분기 이름 + 고를 조건 설명 | 노드에서 고른 모델(OpenAI · Gemini · Claude)이 구조화 출력으로 branch_id · reason · confidence 를 냄 |

- 출력 변수: `branch`(분기 이름), `branch_id`, `reason`(고른 이유). 다음 노드에서 `{{#노드.branch#}}` 처럼 씁니다.
- 텍스트 방식은 설정의 **미리 확인**에 예시 문장을 넣으면 어느 분기로 갈지 바로 보여 줍니다.
- 실행 기록: 텍스트 방식은 찾은 문구를 원문에 강조하고 분기별로 문구마다 찾음/없음을, 코드 방식은 인자·코드·표준 출력·반환값을,
  AI 방식은 보낸 프롬프트·판단 근거·확신도·API 요청 본문을 보여 줍니다.
- 기본 AI 모델은 GPT-6 Luna(reasoning.effort low)입니다. Gemini나 Claude로 바꿀 수 있습니다.

## 블록

여러 노드를 이름과 배경색이 있는 영역으로 묶습니다. 블록을 옮기면 안의 노드도 함께 움직입니다.

- **만들기**: Shift+드래그(또는 Ctrl+클릭)로 노드를 여러 개 고른 뒤 위쪽의 **블록으로 묶기**, 또는 **노드 추가 → 블록**으로 빈 블록을 만든 뒤 노드를 끌어다 넣기.
  블록을 선택한 채 노드를 추가하면 블록 안에 들어갑니다(빈 블록이면 엔트리 포인트와 바로 연결).
- **엔트리 · 아웃 포인트**: 블록 왼쪽 벽의 **엔트리**와 오른쪽 벽의 **아웃**에 점이 두 개씩 있습니다.
  바깥 선은 엔트리의 바깥 점으로 들어오고, 엔트리의 안쪽 점에서 안쪽 첫 노드로 이어집니다. 안쪽 마지막 노드는 아웃의 안쪽 점으로, 아웃의 바깥 점에서 다음 노드로 이어집니다.
  묶을 때 들어오는 선이 한 노드로, 나가는 선이 한 출력에서 나가면 자동으로 포트를 거치도록 다시 잇습니다.
- **편집**: 제목 더블클릭으로 이름 변경, 선택하면 위에 배경색 팔레트(직접 고르기 포함)와 **블록 풀기**, 모서리를 끌어 크기 조절.
  노드를 블록 밖으로 끌어내면 빠지고, 블록은 안의 노드를 항상 감싸도록 넓어집니다.
- **삭제**: Delete 키나 **블록 풀기**는 블록만 없애고 안의 노드는 남깁니다(포트를 거치던 선은 직접 연결). 안의 노드까지 지우려면 블록 설정의 **블록과 안의 노드 삭제**.
- **실행**: 블록은 진입 → 안쪽 노드 → 종료 순서로 실행됩니다. 아웃에 연결된 안쪽 노드 중 하나라도 실행되면 블록 다음으로 진행하고, 하나도 실행되지 않으면(예: 안쪽 분기가 다른 쪽으로 감) 블록 다음 노드는 건너뜁니다.
- **실행 기록**: 블록을 고르면 블록 전체 시간·토큰과 함께 입력(안쪽 노드가 바깥에서 읽은 값), 처리 과정(안쪽 노드 실행 순서), 출력(블록 다음 노드가 읽어 간 안쪽 값)이 표시됩니다.
  채팅의 실행 과정에서도 블록 안 노드는 블록 색 막대로 묶여 보입니다.
- **DSL**: 블록은 `type: custom-block`, `data.type: block` 노드로 저장하고 안의 노드는 `parentId`(블록 기준 상대 좌표)로 가리킵니다.

## 메모리 모듈

LLM 노드에 붙였다 뗄 수 있는 기억입니다. 모듈은 블록이고, **블록 안의 노드 배치가 곧 구현**입니다 — 코드·LLM·조건 분기·템플릿과 메모리 저장소 노드만으로 짜여 있어 눌러서 고칠 수 있습니다.

- **붙이기**: LLM 노드를 고른 채 **노드 추가 → 메모리 모듈**에서 종류를 고르면 그 아래에 생기고 바로 붙습니다. 직접 붙일 때는 모듈 위쪽 ◆ 를 LLM 노드 아래쪽 ◆ 로 끌어 잇습니다(점선). LLM 하나에 모듈 하나.
- **떼기**: 점선을 지우거나 모듈을 지우면 LLM 노드는 메모리 없이 원래대로 동작합니다. 모듈을 지우면 안의 노드도 함께 지워지고, 저장된 기억 파일은 남습니다.
- **두 구역**: 윗줄 **읽기**는 LLM 호출 전에 실행되어 결과가 프롬프트에 들어가고, 아랫줄 **쓰기**는 LLM 응답 뒤에 실행됩니다. 답변은 쓰기를 기다리지 않고 나갑니다.
  읽기 결과 중 '프롬프트에 넣을 글'은 시스템 프롬프트 끝에 머리말(기본 `[메모리]`, 모듈 설정에서 변경)과 함께 붙고, '대화 이력'을 지정하면 LLM 노드의 대화 메모리 설정 대신 들어갑니다.
- **전체 프롬프트 보기**: 모듈 설정에 붙은 LLM 이 실제로 받는 프롬프트가 들어가는 순서대로 나옵니다. LLM 노드의 프롬프트와 머리말은 그 자리에서 고치고, 기억 내용·지난 대화처럼 실행할 때 정해지는 부분은 잠겨 있습니다(실행 후에는 실제로 들어간 값이 보임).
- **모듈 안에서 쓰는 변수**: `query`(질문), `history`(지난 대화), `history_text`, `turn`, `conversation_id`, `now`, `today`, 쓰기 구역에서는 `answer`(LLM 응답).
- **종류 바꾸기**: 모듈 설정의 종류를 바꾸면 안의 노드를 그 종류의 구현으로 갈아 끼웁니다(위치·이름·붙은 LLM 은 유지).
- **저장소**: `data/memory/<프로젝트 ID>/<저장소 이름>.json`. 대화를 새로 시작해도 남습니다. 모듈 설정에서 내용을 보고 비울 수 있습니다.

| 종류 | 읽기 (LLM 호출 전) | 쓰기 (응답 뒤) | 기억 범위 | 대표 구현 |
|---|---|---|---|---|
| 슬라이딩 윈도 | 최근 N턴만 잘라 넣음 | 없음 | 한 대화 | LangChain 윈도 버퍼, Dify LLM 메모리 |
| 요약 + 최근 버퍼 | 누적 요약 + 요약 이후 턴 원문 | 밀려난 턴이 쌓이면 요약에 접어 넣음 | 한 대화(길게) | LangChain 요약 버퍼, 컨텍스트 압축 |
| 고정 프로필 | 크기 제한이 있는 프로필을 항상 주입 | LLM 이 추가·교체·삭제를 판단 → 코드로 적용 | 대화를 넘어 | Letta 코어 메모리, ChatGPT 저장된 메모리 |
| 사실 추출 + 통합 | 질문과 비슷한 사실 상위 k개 | 사실 추출 → 비슷한 기존 기억 → ADD/UPDATE/DELETE/NONE | 대화를 넘어 | Mem0 |
| 에피소드 스트림 | 최신성 × 중요도 × 관련성 점수로 상위 k개 | 턴을 한 줄 기억 + 중요도(1~10)로 쌓음 | 대화를 넘어 | Generative Agents |
| 파일 메모리 | 인덱스는 항상, 주제 파일은 LLM 이 골라서 | 주제 파일에 덧붙이고 인덱스에 한 줄 | 몇 달~몇 년 | Claude Code 메모리, OpenClaw MEMORY.md |
| 시간축 사실 그래프 | 지금 유효한 사실만 검색 | (주어, 관계, 대상) 추출 → 모순된 사실은 지우지 않고 무효 표시 | 몇 달~몇 년 | Zep, Graphiti |
| 백그라운드 통합 | 정리된 장기 기억 + 오늘 기록 | 오늘 기록에 쌓고, N턴마다 장기 기억에 승격·병합 | 몇 달~몇 년 | OpenClaw 드리밍, Letta 슬립타임 |
| 도구 호출형 | 인덱스(MEMORY.md)와 사용 규칙만 항상 주입 | 없음 — **모델이 응답 도중 `memory` 도구로 직접** 읽고 씀 | 몇 달~몇 년 | Claude 메모리 도구, Claude Code, Letta |

알아 둘 점:

- 관련성 검색은 임베딩이 아니라 지식 검색과 같은 **로컬 TF-IDF** 입니다. 낱말이 겹치지 않으면 뜻이 같아도 찾지 못합니다.
- 백그라운드 통합은 실제 예약 실행이 아니라 **N턴마다 한 번** 쓰기 구역에서 돕니다(항시작동 에이전트는 보통 밤마다 돌립니다).
- 시간축 사실 그래프는 그래프 DB 가 아니라 '주어 — 관계 — 대상' 문장과 유효 기간을 가진 기록으로 저장합니다.
- 긴 기억 종류(프로필 이하)는 최근 대화를 따로 넣지 않습니다. LLM 노드의 **대화 메모리**를 함께 켜 두세요.
- 모듈 안의 LLM 노드는 **구조화 출력**(LLM 설정의 JSON 스키마)을 써서 판단 결과를 받습니다.
- 종류를 고른 근거와 출처는 `docs/research/agent-memory.md` 에 있습니다.

## 도구 호출 — 도구 · 스킬 · 플러그인 · MCP

LLM 노드 설정의 **도구**를 켜면 그 노드는 한 번 호출로 끝나지 않고 에이전트 루프를 돕니다: 모델 호출 → 모델이 요청한 도구 실행(한 번에 여러 개면 함께) → 결과를 돌려주고 다시 호출. 모델이 도구를 그만 부르면 그 글이 답입니다. 왕복이 정해 둔 횟수(기본 8)를 넘으면 도구 없이 답하게 합니다. 도구가 실패해도 워크플로는 멈추지 않고, 오류 내용이 모델에게 결과로 돌아갑니다.

세 공급자 모두 각자의 도구 호출 형식을 그대로 씁니다(Anthropic `tool_use`/`tool_result`, OpenAI Responses `function_call`, Gemini `functionCall`). 루프 동안 모델의 추론 블록(thinking, 암호화된 reasoning, thoughtSignature)은 그대로 되돌려 보냅니다.

| 도구가 오는 곳 | 무엇 | 등록하는 곳 |
|---|---|---|
| 내장 도구 | `calculator` · `current_time` · `web_fetch`(공개 주소만) · `knowledge_search`(로컬 지식베이스) · `conversation_search`(지난 대화 검색) | LLM 노드 → 도구 |
| 공급자가 실행하는 도구 | `web_search` — Anthropic 웹 검색 도구 · OpenAI `web_search` · Gemini Google 검색 그라운딩. 실행과 결과 주입은 공급자 서버가 하고, 실행 기록에는 검색어만 남습니다 | LLM 노드 → 도구 |
| 직접 만든 도구 | 이름 · 설명 · 입력 JSON 스키마 · `main(입력)` JavaScript 코드 | LLM 노드 → 도구 (DSL 에 함께 저장) |
| 스킬 | Agent Skills 형식 `data/skills/<이름>/SKILL.md`. 이름·설명만 항상 프롬프트에 넣고, 본문은 모델이 `skill` 도구로 부를 때, 딸린 파일은 `skill_read_file` 로 읽을 때 들어갑니다 | LLM 노드 → 도구 → 스킬 → 관리 |
| 플러그인 | 스킬과 MCP 서버를 묶은 폴더(Claude Code 플러그인 배치). `data/plugins/<이름>/` 에 두면 `플러그인:스킬`, `플러그인:서버` 로 나옵니다 | 폴더를 직접 둠 |
| 외부 MCP 서버 | 공식 SDK 클라이언트. 원격(Streamable HTTP, 실패하면 SSE 로 재시도)과 로컬(stdio). 인증은 없음 · 헤더 · OAuth 로그인. 도구는 `mcp__서버__도구` 이름으로 붙습니다 | 원격: 도구 → 외부 MCP 서버 → 관리 / 로컬: `data/mcp.json` |
| 메모리 도구 | 붙어 있는 메모리 모듈 안에 **메모리 도구** 노드가 있으면 `memory` 도구가 붙습니다(도구 설정을 켜지 않아도) | 메모리 모듈 → 도구 호출형 |

**도구 호출형 메모리**는 모듈 안의 노드 배치가 다른 종류와 다릅니다. 읽기 구역은 인덱스를 읽어 사용 규칙과 함께 넣는 세 노드뿐이고, 쓰기 구역은 비어 있습니다. 대신 **메모리 도구** 노드가 선 없이 놓여 있고, 이 노드가 있으면 모델이 `/memories` 폴더를 `view · create · str_replace · insert · delete · rename` 명령으로 직접 다룹니다(Anthropic 메모리 도구와 같은 명령 구성을 일반 함수 도구로 정의해 세 공급자에서 같게 동작). 노드 설정에서 명령을 빼면 읽기 전용이나 지우기 금지 메모리가 되고, 노드를 지우면 도구 없이 인덱스만 들어갑니다. 파일 메모리 모듈과 같은 저장 형식이라, 다른 종류의 모듈 안에 메모리 도구 노드를 더해 둘을 섞을 수도 있습니다.

`data/mcp.json` 은 표준 형식입니다. 값 안의 `${이름}` 은 환경변수로 바뀝니다.

```json
{
  "mcpServers": {
    "docs":  { "type": "http", "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" } },
    "files": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/Users/me/docs"] }
  }
}
```

### 긴 루프와 지난 대화

- **도구 결과 비우기**: 쌓인 도구 결과가 정해 둔 글자 수(기본 60,000)를 넘으면 오래된 결과부터 한 줄 안내로 바꿉니다. 최근 2번의 왕복은 그대로 둡니다. 대화를 요약하지 않고 결과만 비우는, 가장 싸고 손실이 적은 압축입니다. 비운 횟수는 실행 기록의 해당 단계에 남습니다.
- **지난 대화 검색**: `conversation_search` 를 켠 LLM 노드가 있으면 턴이 끝날 때마다 질문과 답을 `data/memory/<프로젝트>/__sessions.json` 에 쌓고, 모델이 그 기록을 검색합니다. 쓸 때 중요도를 매기지 않고 원문을 그대로 찾는 방식이라, 메모리에 저장해 두지 않은 세부도 찾습니다. 켜기 전의 대화는 없습니다.

### 출처와 정화

메모리와 외부 도구가 함께 켜지면, 웹 페이지나 MCP 서버가 돌려준 글에 든 지시문이 기억으로 저장되어 다음 대화까지 따라올 수 있습니다. 그래서 두 가지를 합니다.

- **출처 표시**: 기억마다 언제·어느 대화에서·무엇이(모델의 도구 호출 / 모듈의 저장소 노드 / 정리) 썼는지 남깁니다. 한 번의 LLM 실행에서 외부 도구(`web_fetch`, MCP)를 부른 뒤에 쓴 기억에는 **외부 자료를 본 대화에서 저장됨** 표시가 붙습니다. 이 표시는 메모리 설정의 저장소 내용, 모델이 보는 파일 목록, 프롬프트에 넣는 기억 끝의 주의 문장에 모두 나옵니다. 그 파일을 고쳐 써도 표시는 남고, 외부 자료를 보지 않은 실행에서 통째로 다시 쓰면 지워집니다.
- **주입 전 정화**: 기억을 프롬프트에 넣을 때, 모델이 메모리 파일을 열 때, 외부 도구 결과를 모델에 돌려줄 때 보이지 않는 문자(폭 0 문자, 방향 전환 문자, 태그 문자)를 지우고, 대화 구조를 흉내 낸 표시(`<system>`, `<|im_start|>`, `[INST]` …)의 꺾쇠를 바꿔 힘을 뺍니다. 저장된 원문은 바꾸지 않습니다. 걸러 낸 개수는 실행 기록에 남습니다.

표시는 "의심해 볼 근거"이지 판정이 아닙니다. 외부 자료를 본 실행에서 쓴 기억이 모두 오염된 것은 아니고, 평범한 문장으로 쓰인 거짓 정보는 정화로 걸러지지 않습니다.

### 기억 정리 (드리밍)

메모리 모듈 설정의 **기억 정리**에서 실행합니다. 메모리 파일 전체와 최근 대화 기록 40턴을 모델에 주고, 중복을 합치고 어긋난 내용을 최신으로 고치고 인덱스를 다시 짠 정리안을 받습니다. 정리안은 원본을 덮어쓰지 않고 **검토용 사본**에 저장됩니다. 파일마다 지금 내용과 정리안을 나란히 보고 적용하거나 버립니다. 적용해도 직전 내용이 남아 한 번 되돌릴 수 있습니다. 예약 실행은 없고 버튼으로 돌립니다. 기존의 '백그라운드 통합' 종류(N턴마다 쓰기 구역에서 덮어쓰는 방식)는 그대로 있습니다.

무엇을 불렀는지는 답변을 눌러 LLM 노드의 **도구** 단계에서 봅니다: 제공된 도구, 모델 호출마다 요청한 도구의 입력과 돌려준 결과, 연결에 실패한 MCP 서버. 다음 노드에서는 `tool_calls` 변수로 쓸 수 있습니다. `templates/05-tool-agent.yml` 이 내장 도구 · 직접 만든 도구 · 스킬 · 도구 호출형 메모리를 함께 쓰는 예입니다.

### 여러 사람이 각자 계정으로 쓰기 (Supabase)

기본은 로그인 없이 `data/` 폴더에 저장하는, 혼자 쓰는 모드입니다. 환경 변수에 Supabase 를 넣으면 **여러 사용자 모드**로 바뀝니다: Google 계정으로 로그인하고, 프로젝트 · 메모리 · API 키 · 커넥터 토큰 · MCP 서버가 사람별로 따로 저장됩니다. 설정 순서는 [docs/supabase-setup.md](docs/supabase-setup.md), 테이블은 [supabase/schema.sql](supabase/schema.sql).

저장은 "경로 → JSON" 한 가지로 통일돼 있고(`src/lib/store/backend.ts`), 파일 모드는 `data/<경로>`, Supabase 모드는 `app_files` 테이블의 (사용자, 경로) 행입니다. 서버도 로그인한 사용자의 권한으로 DB 를 부르므로 행 수준 보안이 사용자 간 격리를 지킵니다. 스킬 · 플러그인 · 지식베이스 · 템플릿은 공용 파일로 남습니다.

### 커넥터 — Google (메일 · 캘린더 · 시트 · 문서)

외부 서비스에 내 계정으로 로그인해 두고, LLM 노드가 그 서비스의 기능을 도구로 부르게 합니다. 한 번의 실행에서 여러 도구를 이어 불러(일정 조회 → 시트 기록 → 문서 작성 → 메일 초안) 다단계 작업을 합니다. `templates/07-google-assistant.yml` 이 예입니다.

| 서비스 | 도구 |
|---|---|
| Gmail | `gmail_search` · `gmail_read` · `gmail_create_draft` · `gmail_send` |
| 캘린더 | `calendar_list` · `calendar_create` |
| 드라이브 | `drive_search` (이름으로 시트·문서 ID 찾기) |
| 스프레드시트 | `sheets_read` · `sheets_append` · `sheets_create` |
| 문서 | `docs_read` · `docs_create` · `docs_append` |

연결하는 법 (도구 → 커넥터 · Google → 관리):

1. Google Cloud 콘솔에서 프로젝트를 만들고 Gmail · Calendar · Drive · Sheets · Docs API 를 사용 설정합니다.
2. OAuth 동의 화면을 만들고 테스트 사용자에 내 계정을 추가합니다.
3. ‘OAuth 클라이언트 ID’(웹 애플리케이션)를 만들고, 승인된 리디렉션 URI 에 화면에 나오는 주소(`http://localhost:포트/api/connectors/google/callback`)를 넣습니다. 포트가 바뀌면 주소도 바뀝니다.
4. 클라이언트 ID 와 보안 비밀번호를 저장하고 ‘Google 계정 연결’을 누릅니다. 로그인과 동의는 새 창에서 직접 합니다.

- 비밀번호와 토큰은 `data/connectors.json` 에만 저장되고(.gitignore) 모델과 브라우저에는 전달되지 않습니다.
- 쓰는 도구를 LLM 노드마다 고릅니다. `gmail_send` 는 바로 발송하므로 기본 템플릿에서는 꺼 두었고, 대신 초안을 만듭니다. 시트와 문서는 새로 만들거나 덧붙이기만 하고 지우거나 덮어쓰는 도구는 없습니다.
- 메일과 문서 내용은 남이 쓴 글이라 외부 자료로 다룹니다(위 '출처와 정화').
- ‘예시 데이터로 시연’을 켜면 연결하지 않고도 지어낸 메일·일정·시트로 흐름을 볼 수 있습니다. 계정을 연결하면 실제 데이터를 씁니다.

`templates/06-always-on-agent.yml` 은 상시 실행 에이전트의 기본 구조(이벤트 수신함 · 타이머 · 기억 · 권한 · 발신함)를 블록 하나씩으로 옮긴 시연용 예입니다. 출처는 Anthropic 의 [Building always-on agents](https://claude.com/resources/articles/building-always-on-agents)(William Hu, 2026-11-13). 채팅 메시지 한 번을 이벤트 하나로 보고, 입력 폼의 ‘이벤트 종류’로 사용자 메시지 · 웹훅 · 타이머 · 승인 응답을 흉내 냅니다. 수신함 · 타이머 · 보류한 도구 호출은 대화 변수에 저장되고, 실제 스케줄러 · 웹훅 수신 · 외부 서비스 호출은 없습니다.

알아 둘 점:

- **로컬(stdio) MCP 서버는 화면에서 등록할 수 없습니다.** 이 PC에서 명령을 실행하는 설정이라 파일을 직접 고치게 했습니다. 설정을 바꾸는 API 는 같은 출처의 JSON 요청만 받습니다.
- MCP **OAuth 로그인**은 서버 등록에서 인증을 ‘OAuth 로그인’으로 고르면 됩니다. 서버의 로그인 창이 새 창으로 열리고, 로그인과 동의는 그 창에서 직접 합니다. 받은 토큰은 `data/mcp-auth.json` 에 저장되고 만료되면 자동으로 갱신됩니다. 클라이언트 동적 등록을 지원하는 서버만 됩니다(미리 발급받은 client_id 를 넣는 방식은 없음). MCP 의 리소스·프롬프트·샘플링은 쓰지 않고 도구만 씁니다.
- 스킬에 든 **스크립트는 실행하지 않습니다**(읽기만). 플러그인의 훅·명령·에이전트 정의도 읽지 않습니다.
- `web_search` 는 공급자 요금이 따로 붙고 Mock 모드에서는 동작하지 않습니다. 공급자의 코드 실행 도구는 넣지 않았습니다. `web_fetch` 는 검색이 아니라 주어진 주소를 읽습니다.
- Gemini 에서 `web_search` 와 함수 도구(내장·직접 만든 도구·MCP)를 함께 켜면 모델에 따라 요청이 거절될 수 있습니다.
- 직접 만든 도구의 코드는 코드 노드와 같은 실행기입니다(보안 샌드박스 아님, 네트워크·파일 불가, 3초 제한).
- MCP 서버와 웹 페이지가 돌려준 글은 정화한 뒤 모델에게 전달됩니다(위 '출처와 정화'). 그래도 믿을 수 없는 서버는 메모리 도구와 함께 켜지 않는 편이 안전합니다.
- Gemini 에서 구조화 출력과 도구를 함께 켜면 모델에 따라 요청이 거절될 수 있습니다.
- 최신 에이전트들의 메모리·도구 구성 조사는 `docs/research/agent-memory-latest.md` 에 있습니다.

## Dify로 내보내기

블록·분기 노드·메모리 모듈은 이 앱 전용입니다. DSL 창에서 **Dify 호환으로 내보내기**를 켜면 Dify가 읽을 수 있는 노드로 바꿔서 보여 주고, 바뀌면서 잃는 것을 위에 적어 줍니다.

| 이 앱 | Dify로 내보낼 때 |
|---|---|
| 블록 | 풀어서 안의 노드를 꺼내고, 포트를 거치던 선은 직접 연결 |
| 분기 · 텍스트 포함 | IF/ELSE (정규식은 '포함'으로 근사, branch·reason 출력 없음) |
| 분기 · 코드 | 코드 노드(branch·branch_id·reason 출력) + IF/ELSE |
| 분기 · AI 판단 | 질문 분류기('그 외'는 마지막 클래스, branch 참조는 class_name 으로) |
| 메모리 모듈 | 뺌 — 붙어 있던 LLM 노드는 메모리 없이 동작 |
| LLM 노드의 도구 설정 | 뺌 — Dify 의 LLM 노드는 도구를 부르지 않음(Agent 노드로 다시 구성) |

## LLM 호출 — Claude · GPT · Gemini

| 공급자 | SDK / API | 카탈로그 모델 (2026-11 기준) | 노드에서 고르는 하이퍼파라미터 |
|---|---|---|---|
| Anthropic | `@anthropic-ai/sdk` Messages API | claude-opus-5-5 · sonnet-5-5 · haiku-5-5 · fable-5-2 | max_tokens, effort, thinking 표시, stop_sequences |
| OpenAI | `openai` Responses API | gpt-6-astra · gpt-6.1-sol · gpt-6.1-terra · gpt-6-luna | max_output_tokens, reasoning.effort, reasoning.summary, text.verbosity, temperature, top_p |
| Google | `@google/genai` generateContentStream | gemini-4-carbon · argon · hydrogen, gemini-3.8/3.6-flash, 3.5-flash-lite, 3.1-pro-preview | thinkingLevel, includeThoughts, maxOutputTokens, temperature, topP, topK, stopSequences |

- LLM·질문 분류기·파라미터 추출 노드의 설정 탭에서 공급자 → 모델 → 하이퍼파라미터 순으로 고릅니다. 체크한 파라미터만 요청에 들어가고 나머지는 모델 기본값입니다.
  추론 effort/level 선택지는 모델마다 문서상 지원 값만 보여 줍니다.
- 키가 있으면 각 공급자의 모델 목록 API에서 실제로 쓸 수 있는 모델을 함께 보여 주고, 목록에 없는 모델 ID는 직접 입력할 수 있습니다(공급자별 일반 파라미터 세트 적용).
- 값은 Dify DSL의 `model.provider / name / completion_params`에 저장되므로 Dify로 내보내도 구조가 유지됩니다. Dify에서 가져온 `max_tokens`(OpenAI·Gemini) 같은 이름은 자동으로 맞추고, 모델이 받지 않는 값은 "무시됨"으로 표시합니다.
- 추론 요약: Claude는 `thinking.display: summarized`, OpenAI는 `reasoning.summary`(조직 인증이 필요할 수 있음), Gemini는 `includeThoughts`. 실행 기록의 "추론 요약"에 표시됩니다.
- 분류기·파라미터 추출은 세 공급자 모두 JSON 스키마 구조화 출력을 씁니다.
- Claude Opus 5.5 / Sonnet 5.5 / Fable 5.2는 안전 분류기 거절 시 서버 측 대체 모델로 이어 가는 `fallbacks: "default"`를 켭니다(`src/lib/llm/providers/anthropic.ts`의 `FALLBACK_MODELS`).
- 키 **테스트**는 모델 목록 API만 호출하므로 토큰을 쓰지 않습니다.

## 저장 위치

| 경로 | 내용 |
|---|---|
| `data/projects/<id>.json` | 프로젝트(= Dify DSL 문서 1개) |
| `data/settings.json` | 공급자별 API 키 (.gitignore) |
| `data/datasets/<id>.json` | 지식 검색용 로컬 데이터셋 (형식은 `acme-faq.json` 참고) |
| `data/memory/<프로젝트 ID>/<저장소>.json` | 메모리 모듈이 쌓은 기억 (.gitignore) |
| `data/skills/<이름>/SKILL.md` | 스킬 (`customer-reply` 가 예시) |
| `data/plugins/<이름>/` | 플러그인(스킬 + `.mcp.json`) |
| `data/mcp.json` | 외부 MCP 서버 목록 (.gitignore — 인증 헤더가 들어감) |
| `data/mcp-auth.json` | MCP OAuth 로그인으로 받은 토큰 (.gitignore) |
| `data/connectors.json` | 커넥터의 OAuth 클라이언트와 토큰 (.gitignore) |
| `data/memory/<프로젝트 ID>/__sessions.json` | 지난 대화 검색용 세션 기록 (.gitignore) |
| `templates/*.yml` | 새 프로젝트 템플릿. Dify DSL 파일을 넣으면 템플릿 목록에 추가됨 |

로컬 파일에 저장하므로 서버리스 환경(Vercel 등)에 그대로 배포하면 프로젝트가 유지되지 않습니다. 팀 서버나 로컬에서 쓰는 것을 전제로 합니다.

## 지원하는 Dify 노드

| 노드 | 실행 | 전용 설정 폼 |
|---|---|---|
| start / answer / end | ✅ | ✅ |
| llm | ✅ (basic·jinja2 프롬프트, context, memory, structured_output, 도구 호출 루프) | ✅ |
| question-classifier / parameter-extractor | ✅ | ✅ |
| knowledge-retrieval | ✅ (로컬 TF-IDF) | ✅ |
| if-else | ✅ | ✅ |
| code (javascript, python3) | ✅ | ✅ |
| template-transform | ✅ | ✅ |
| http-request / variable-aggregator / assigner | ✅ | YAML 편집 |
| iteration, loop, tool, agent, document-extractor, list-operator | ❌ 실행 시 오류 | — |
| switch 분기 (이 앱 전용) | ✅ 텍스트 포함 · 코드 · AI 판단 | ✅ |
| block (이 앱 전용 묶음) | ✅ 진입 → 안쪽 → 종료 | ✅ |
| 메모리 모듈 (이 앱 전용, block + memory) | ✅ 읽기 → LLM → 쓰기, 9종 | ✅ |
| memory-tool 메모리 도구 (이 앱 전용, 선언 노드) | ✅ 붙은 LLM 이 `memory` 도구로 호출 | ✅ |
| memory-store 메모리 저장소 (이 앱 전용) | ✅ 문서 읽기·쓰기, 기록 검색·추가·반영 | ✅ |

## 구조

```
src/app/page.tsx                   로비
src/app/projects/[id]/page.tsx     편집기
src/app/api/projects               프로젝트 CRUD (생성: template | yaml | duplicateOf)
src/app/api/settings(/test)        공급자별 API 키 저장·테스트
src/app/api/models                 공급자 모델 목록(키 필요)
src/app/api/run                    워크플로 실행 → SSE (node_started / node_progress / node_finished / message / workflow_finished)
src/lib/engine/                    그래프 실행기, 변수 풀, 노드 실행기
src/app/api/memory                 메모리 저장소 내용 보기·비우기
src/lib/dsl/                       DSL 파싱(parse.ts)·편집(edit.ts)·블록(blocks.ts)·분기(switch.ts)·Dify 호환 변환(compat.ts)
src/lib/dsl/memory.ts              메모리 모듈: 포트, 실행용 펼치기(LLM 앞뒤에 끼우기)
src/lib/dsl/memory-presets.ts      메모리 9종의 내부 노드 배치
src/app/api/tools · skills · mcp   도구 목록, 스킬 저장·삭제, MCP 서버 등록·연결 시험
src/lib/tools/config.ts            도구 설정 형식, 내장 도구 정의(서버·화면 공용)
src/lib/tools/toolset.ts           LLM 노드 한 번의 실행에 쓸 도구 모으기
src/lib/tools/builtin.ts           내장 도구 · 직접 만든 도구 실행
src/lib/tools/memory-tool.ts       메모리 도구(/memories 명령)
src/lib/tools/skills.ts            스킬 · 플러그인 읽기
src/lib/tools/mcp.ts               MCP 클라이언트(@modelcontextprotocol/sdk)
src/lib/tools/mcp-auth.ts          MCP OAuth 토큰 저장
src/lib/tools/sanitize.ts          주입 전 정화(보이지 않는 문자 · 위조 표시)
src/lib/memory/sessions.ts         세션 기록 쌓기 · 검색
src/lib/memory/dream.ts            기억 정리: 정리안 만들기 · 적용 · 되돌리기
src/app/api/memory/dream           기억 정리 API
src/app/api/mcp/oauth/callback     MCP OAuth 로그인 창이 돌아오는 곳
src/lib/llm/tool-loop.ts           도구 실행 · 단계 합산 · 도구 결과 비우기(어댑터 공용)
src/lib/memory/store.ts            메모리 저장소(문서 + 기록)
src/lib/llm/catalog.ts             모델 카탈로그·하이퍼파라미터 정의(서버·화면 공용)
src/lib/llm/providers/              anthropic / openai / google 어댑터(각자 도구 호출 루프)
src/components/                    lobby, editor, flow-canvas, node-config, block-config, memory-config, tools-modal, inspector, chat-panel
```

## 주의

- 코드 노드는 보안 샌드박스가 아닙니다(JS는 `node:vm`, Python은 로컬 프로세스). 워크플로 작성자를 신뢰하는 환경에서만 쓰세요.
- 환경 변수(`env.*`)는 DSL 내보내기에 포함되므로 비밀값을 넣지 마세요.
