# 최신 AI 에이전트의 메모리: 2026년 11월 기준 현황

- 조사일: 2026-11-19
- 질문: "가장 최근의 에이전트들은 실제로 어떤 메모리를 쓰는가?"
- 범위: 선행 조사 `docs/research/agent-memory.md`(2026-11-18)가 다룬 고전 설계는 다시 설명하지 않는다. 이 문서는 최근 6~12개월 사이에 새로 나왔거나 바뀐 것, 그리고 논문이 아니라 출시된 제품이 실제로 하는 일에 집중한다.
- 출처 표기: 표시가 없으면 1차 출처(공식 문서, 변경 이력, 소스 저장소, 논문, 자사 블로그)를 이번 조사에서 직접 열어 확인한 것이다. `[2차]`는 2차 자료나 검색 결과 요약으로만 확인한 것, `[추론]`은 출처에 없고 조사자가 추론한 것, `[미확인]`은 확인하지 못한 것이다. 날짜가 없는 문서는 "2026-11-19 열람"으로 적었다.
- 읽는 법 주의: 웹 페이지 대부분은 요약 모델을 거쳐 읽었다. 따옴표 안의 영문은 그 도구가 돌려준 문장이다. Claude Code 문서와 변경 이력, Anthropic Managed Agents 메모리 문서, Dreams 문서는 원문을 직접 받아 확인했다.

## 0. 먼저 읽을 결론

지금(2026-11) 출시된 최신 에이전트의 메모리에 대해 참인 것 여덟 가지다. 각 항목 끝이 가장 강한 근거다.

1. **장기 기억의 기본 형태는 "에이전트가 일반 파일 도구로 직접 고치는 마크다운 디렉터리"다.** 벡터 저장소가 주 저장소인 제품은 이번에 확인한 출시 하네스 중에 없었다. Claude Code 자동 메모리, Anthropic 메모리 스토어(샌드박스에 디렉터리로 마운트), Devin Memory(마크다운 노트의 Git 저장소), Letta MemFS(Git), OpenAI Codex 메모리와 Agents SDK 샌드박스 메모리, Cursor Automations의 `MEMORIES.md`, LangChain Deep Agents가 모두 이 형태다. 가장 강한 근거: Anthropic Managed Agents 문서 "The agent reads and writes it with the same file tools it uses for the rest of the filesystem"(<https://platform.claude.com/docs/en/managed-agents/memory>, 2026-11-19 열람).
2. **읽기는 "작은 인덱스는 항상 주입, 세부는 필요할 때 연다"로 수렴했다.** Claude Code는 `MEMORY.md` 첫 200줄 또는 25KB만 주입하고(<https://code.claude.com/docs/en/memory>), Devin은 세션마다 `MEMORY.md`만 받고 나머지 노트는 필요할 때 읽으며(<https://docs.devin.ai/product-guides/memory>), OpenAI 샌드박스 메모리는 `memory_summary.md`만 주입하고 `MEMORY.md`를 검색한다(<https://openai.github.io/openai-agents-python/sandbox/memory/>).
3. **백그라운드 통합("dreaming")이 2026년에 실험에서 제품 기능이 됐다.** Anthropic Dreams(연구 프리뷰, 베타 헤더 `dreaming-2026-04-21`), Devin의 야간 dreaming(2026-10-09), GitHub Copilot dreaming(공개 프리뷰, 2026-10-28), OpenAI Codex의 유휴 후 백그라운드 생성, Gemini CLI Auto Memory(실험), Letta, OpenClaw가 모두 대화 밖에서 과거 세션을 다시 읽어 기억을 정리한다. 가장 강한 근거: <https://platform.claude.com/docs/en/managed-agents/dreams>.
4. **단기 기억의 기본값은 윈도우 자르기가 아니라 컴팩션이다. 두 주요 API가 모두 서버 측 컴팩션을 제공한다.** Anthropic은 요청형과 임계치형 두 가지(베타 헤더 `compact-2026-09-04`), OpenAI는 `context_management`의 `compact_threshold`와 독립 엔드포인트 `/responses/compact`를 둔다(<https://platform.claude.com/docs/en/build-with-claude/compaction>, <https://developers.openai.com/api/docs/guides/compaction>).
5. **쓰기는 한쪽이 아니라 두 경로의 조합이다.** 세션 중에는 모델이 도구 호출로 쓰고, 세션 밖에서는 백그라운드 작업이 다시 정리한다. 매 턴 추출 파이프라인을 강제로 돌리는 하네스는 찾지 못했다. Mem0 자신도 2026-04-16에 UPDATE/DELETE 판정을 버리고 "한 번의 LLM 호출로 추가만 하는" 방식으로 바꿨다(<https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm>).
6. **절차 기억은 "스킬" 파일로 모이고 있고, 에이전트가 직접 쓰거나 제안한다.** Devin은 Knowledge와 Playbooks를 Skills로 옮기는 중이고(2026-10-23, 2026-11-16 릴리스 노트), Copilot dreaming은 스킬·지시 파일 수정을 풀 리퀘스트로 제안하며, Gemini CLI Auto Memory는 `SKILL.md` 초안을 만든다. 가장 강한 근거: <https://github.blog/changelog/2026-10-28-github-intelligence-puts-your-code-context-and-history-to-work>.
7. **출처·검증·오염 방어가 메모리 기능의 일부가 됐다.** Copilot은 기억마다 코드 인용을 붙이고 쓰기 전에 현재 코드로 검증하며 90일 뒤 만료시킨다. Claude Code는 메모리를 주입하기 전에 보이지 않는 문자와 자기 마크업을 흉내 낸 태그를 무력화한다(v2.1.284, 2026-09-28). Anthropic 메모리 스토어는 `read_only` 마운트와 변경 이력을 제공한다. 가장 강한 근거: <https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/>.
8. **벤치마크 수치로 메모리 방식을 고르면 안 된다.** LoCoMo는 정답 키의 6.4%가 틀렸다는 감사 결과가 있고 `[2차]`, 파일 검색 도구만 쓴 단순 에이전트가 LoCoMo에서 74.0%로 Mem0가 보고한 68.5%를 넘었으며(Letta, 2025-08-12), 공개된 높은 점수는 거의 전부 자사 측정이다(4절).

## 1. 출시 에이전트 비교표

"누가 쓰나"에서 **모델**은 모델이 대화 중 도구 호출로 쓰는 것, **백그라운드**는 대화 밖 작업이 쓰는 것, **사용자**는 사람이 쓰는 것이다.

| 제품 | 메모리 장치 | 누가 쓰나 | 읽는 방법 | 저장 형태 | 최근 주요 변화(날짜) | 출처 |
|---|---|---|---|---|---|---|
| Claude Code | 자동 메모리 + CLAUDE.md + 서브에이전트 메모리 | 모델(세션 중), 추출 단계 `[추론]`, 사용자(CLAUDE.md) | 인덱스 200줄/25KB 주입, 주제 파일은 파일 도구로 열람 | 로컬 마크다운 디렉터리 | 유형 필드·수정 시각 프런트매터, 인덱스 한도 초과 시 오류, 주입 전 무력화(v2.1.284, 2026-09-28) | <https://code.claude.com/docs/en/memory> |
| Claude API 메모리 도구 | `memory_20250818` 클라이언트 도구 | 모델 | 시작 시 `view /memories` 후 파일 열람 | 개발자가 정한 저장소 | 베타에서 정식(stable)으로, 베타 헤더 불필요 | <https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool> |
| Claude Managed Agents | 메모리 스토어 + Dreams | 모델(파일 도구), 백그라운드(Dreams) | `/mnt/memory/` 마운트, 시스템 프롬프트에 마운트 설명 자동 추가 | 워크스페이스 범위 텍스트 문서, 불변 버전 | 메모리 스토어 베타(`agent-memory-2026-07-22`), Dreams 연구 프리뷰(`dreaming-2026-04-21`) | <https://platform.claude.com/docs/en/managed-agents/memory> |
| Claude 앱 | 메모리(주제 단위) + 과거 대화 검색 | 모델(대화 중) | 메모리는 새 대화에 반영, 과거 대화는 도구 호출 검색 | 서버, 주제별 항목 | 24시간마다 갱신하던 요약에서 "대화 중 주제 단위 저장"으로 전환 | <https://support.claude.com/en/articles/11817273-use-claudes-chat-search-and-memory-to-build-on-previous-context> |
| ChatGPT | 저장된 메모리 + 대화 기록 참조 + "dreaming" | 모델, 백그라운드 | 비공개 | 서버 | 2026-06-04 "Dreaming" 갱신, 메모리 출처 표시 `[2차]` | 5.4절 |
| OpenAI Codex | Memories | 백그라운드(유휴 후 추출, 전역 통합) | 켜져 있으면 이후 세션에 주입 | `~/.codex/memories_v2/` 로컬 파일 | `memories_v2` 저장 형식, 외부 컨텍스트 사용 대화 제외 옵션 | <https://learn.chatgpt.com/docs/customization/memories?surface=app> |
| OpenAI Agents SDK | 세션(이력) + 샌드박스 메모리 | 백그라운드(2단계) + 모델(실시간 수정) | `memory_summary.md` 주입 → `MEMORY.md` 검색 → 실행 요약 열람 | 샌드박스 작업 공간 파일 | 샌드박스 메모리 추가(2026-04 `[2차]`) | <https://openai.github.io/openai-agents-python/sandbox/memory/> |
| OpenAI Responses API | 서버 측 컴팩션 | 서버 | 암호화된 컴팩션 항목이 다음 요청에 이어짐 | 불투명 항목 | `compact_threshold`, `/responses/compact`, `compaction_trigger` | <https://developers.openai.com/api/docs/guides/compaction> |
| GitHub Copilot | Copilot Memory + dreaming | 모델(저장 도구), 백그라운드(dreaming) | 저장소의 최근 기억을 세션 시작 시 주입, 사용 전 인용 검증 | 서버, 저장소 사실 + 사용자 선호 | 정식 출시와 dreaming 공개 프리뷰(2026-10-28) | <https://docs.github.com/en/copilot/concepts/agents/copilot-memory> |
| Cursor | Rules/Skills, Automations 메모리 | 사용자(규칙), 모델(자동화 메모리) | 규칙은 프롬프트에, 자동화 메모리는 실행 간 읽고 씀 | `.mdc` 규칙, `MEMORIES.md` | 편집기 Memories 기능 제거(2.1.x, 2025-11) | <https://cursor.com/docs/cloud-agent/automations> |
| Devin (Windsurf 포함) | Memory + dreaming + Skills | 모델(세션 중), 백그라운드(야간) | 세션마다 `MEMORY.md` 주입, 나머지는 필요 시 | 마크다운 노트의 Git 저장소 | Memory와 dreaming 출시(2026-10-09), Knowledge 폐기 예정 | <https://docs.devin.ai/product-guides/memory> |
| Gemini CLI | `save_memory` + Auto Memory | 모델(도구), 백그라운드(제안만) | `GEMINI.md` 로드 | `~/.gemini/GEMINI.md`, 프로젝트 인박스 | Auto Memory 인박스(v0.42.0, 2026-05-12 `[2차]`) | <https://geminicli.com/docs/cli/auto-memory.md> |
| Google ADK | MemoryService | 개발자 콜백 → Memory Bank가 추출 | `preload_memory`(자동) 또는 `load_memory`(모델 판단) | Agent Platform Memory Bank / RAG | 이벤트 단위 쓰기(`add_events_to_memory`) | <https://adk.dev/sessions/memory/> |
| Gemini 앱 | 메모리(과거 대화) + Personal Intelligence | 비공개 | 비공개 | 서버 | "past chats"를 "memory"로 개명, 메모리 가져오기(2026-03-26) | <https://blog.google/innovation-and-ai/products/gemini-app/switch-to-gemini-app/> |
| Letta Code | MemFS + dreaming | 모델(파일 도구), 백그라운드 서브에이전트 | 파일 트리와 `system/` 디렉터리는 항상 주입 | Git 저장소 | Context Repositories(2026-02-12) | <https://www.letta.com/blog/context-repositories> |
| OpenClaw | 파일 + 검색 도구 + dreaming + memory-wiki | 모델, 컴팩션 전 플러시, 백그라운드 | `MEMORY.md`/`USER.md` 주입, `memory_search` | 마크다운 + SQLite 색인 | `intent` 도구, 가져오기, PostgreSQL 검색, 출처 신뢰 기록 | <https://docs.openclaw.ai/concepts/memory> |
| Hermes Agent | `MEMORY.md`/`USER.md` + 스킬 + 세션 검색 | 모델(메모리 도구), 백그라운드 검토, curator | 세션 시작 스냅샷 주입, `session_search` | 마크다운 + SQLite | v0.23.0(2026-11-05): curator 잠금, 미리 쓰는 압축 요약 | <https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.0> |
| LangChain Deep Agents | 파일 메모리 + 스킬 | 모델(`edit_file`), 백그라운드(크론) | `AGENTS.md`류는 시작 시 주입 또는 필요 시 열람 | 경로 접두사별 백엔드(Store) | `/memories/` 경로를 Store로 보내는 `CompositeBackend` | <https://docs.langchain.com/oss/python/deepagents/long-term-memory> |
| Amp | 메모리 기능 없음. 스레드 + 핸드오프 | 해당 없음 | 다른 스레드를 `@T-…`로 참조, 스레드 검색 | 서버의 스레드 | 문서에 컴팩션 언급 없음 | <https://ampcode.com/docs/threads> |
| Jules | 저장소별 Memory | 모델(작업 중) | 이후 작업에 자동 적용 | 서버 | 2025-09-30 출시 `[2차]` | 5.6절 |
| Manus, Poke, Pickle, Vooy | 내부 비공개 | `[미확인]` | `[미확인]` | `[미확인]` | Poke는 2026-07-23 Cognition에 인수 | 5.10절 |

## 2. 이 문서가 선행 조사에서 고치는 점

선행 조사(2026-11-18)의 서술 중 오늘 기준으로 달라졌거나 보완이 필요한 것이다.

| 선행 조사의 서술 | 현재 확인된 내용 | 출처 |
|---|---|---|
| Anthropic 메모리 도구는 베타라는 인상 | `status: stable`, 베타 헤더 없이 Claude 4 이상 모든 모델에서 사용. SDK의 헬퍼만 베타 네임스페이스에 남아 있다 | <https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool> |
| Claude Code 자동 메모리는 인덱스 + 주제 파일 | 맞다. 추가로 메모리마다 `type`(user/feedback/project/reference)과 `modified` 시각이 프런트매터에 기록되고, 인덱스가 한도를 넘으면 쓰기 후 오류로 알려 준다 | <https://code.claude.com/docs/en/memory> |
| Mem0는 ADD/UPDATE/DELETE/NOOP 판정 | 2025년 논문 기준으로는 맞다. 2026-04-16 이후 Mem0의 새 알고리즘은 추가만 한다 | <https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm> |
| ChatGPT·Claude 앱은 백그라운드로 갱신되는 요약 | Claude 앱은 "대화 중 주제 단위 저장"이 현재 방식이고, 24시간 요약은 일부 Team/Enterprise 조직의 구형 방식으로 남았다 | <https://support.claude.com/en/articles/11817273-use-claudes-chat-search-and-memory-to-build-on-previous-context> |
| Devin은 조사 대상에 없었음 | Knowledge는 폐기 예정이고 Skills로 옮겨지는 중이다. 별도로 Memory와 dreaming이 2026-10-09에 나왔다 | <https://docs.devin.ai/product-guides/knowledge>, <https://docs.devin.ai/release-notes/2026> |
| Poke는 독립 회사 | 2026-07-23 Cognition이 인수했다. 메모리 내부는 여전히 비공개다 | <https://cognition.com/blog/interaction> |

## 3. 제품별 상세

### 3.1 Anthropic

**Claude Code 자동 메모리** (<https://code.claude.com/docs/en/memory>, 2026-11-19 열람. 버전 날짜는 npm 레지스트리의 배포 시각)

- 저장: `~/.claude/projects/<project>/memory/`에 `MEMORY.md` 인덱스와 메모리 하나당 주제 파일 하나. 같은 Git 저장소의 워크트리와 하위 디렉터리는 한 디렉터리를 공유한다. 기기 로컬이며 기기나 클라우드 환경 사이에 공유되지 않는다.
- 저장하는 것: 네 종류이고 파일 프런트매터의 `type` 필드에 기록한다. `user`(역할, 전문성, 작업 선호), `feedback`(교정과 승인된 방식), `project`(코드나 Git 이력에서 알 수 없는 진행 상황·기한·결정), `reference`(프로젝트 밖 정보의 위치).
- 저장하지 않는 것: 코드에서 알아낼 수 있는 것(구조, 파일 경로, 디버깅 수정)과 CLAUDE.md에 이미 있는 것. 문서 표현은 "Claude skips anything it can derive from the codebase"다. 매 세션 저장하지도 않는다.
- 읽기 경로:
  1. 대화 시작 시 `MEMORY.md`의 첫 200줄 또는 25KB까지 주입한다.
  2. 주제 파일은 시작 시 로드하지 않고 Claude가 표준 파일 도구로 필요할 때 읽는다. 화면에 "Recalled 2 memories"처럼 표시된다.
  3. 변경 이력에 "memory recall"이 구조화 출력과 기본 Sonnet 모델에 의존한다는 수정 항목이 있다(v2.1.286, v2.1.288). 주제 파일을 고르는 별도 모델 호출이 있는 것으로 보이나 문서에는 설명이 없다 `[추론]`.
- 쓰기 경로:
  1. 세션 중 Claude가 주제 파일을 쓰고 인덱스에 한 줄을 넣는다.
  2. 파일이 YAML 프런트매터로 시작하면 Claude Code가 `modified` 필드에 ISO 8601 시각을 기록한다. 문서는 이 시각이 "how current the fact is"를 사람과 Claude 모두에게 보여 준다고 적는다(v2.1.75, 2026-03-13 도입).
  3. `MEMORY.md`를 쓴 뒤 Claude Code가 한도 대비 크기를 잰다. 한도에 가까우면 줄이라고 알리고, 넘으면 쓰기는 성공하되 인덱스를 다시 쓰라는 오류를 돌려준다(v2.1.186 2026-06-22, v2.1.210 2026-07-14).
  4. 변경 이력에 "auto-memory extraction"과 "memory extraction"이라는 별도 단계가 언급된다(v2.1.273, v2.1.323). 대화 내용에서 기억을 뽑는 별도 처리로 보이나 문서에 설명이 없다 `[추론]`.
- 서브에이전트: 주 대화의 자동 메모리는 서브에이전트에 로드되지 않는다. 서브에이전트 정의의 `memory` 필드(`user`/`project`/`local`)로 별도 디렉터리를 주며, `project` 범위는 `.claude/agent-memory/<이름>/`이라 버전 관리로 공유할 수 있다(<https://code.claude.com/docs/en/sub-agents>).
- 공유: 원격 세션에서 "mounted team memory stores (`CLAUDE_MEMORY_STORES`)"를 찾지 못하던 버그를 고쳤다는 항목이 있다(v2.1.172, 2026-06-10). 팀 공용 메모리 스토어를 마운트하는 기능이 있다는 뜻이지만 메모리 문서에는 설명이 없다 `[미확인]`. Slack용 Claude Tag는 공개 채널마다 노트를 따로 두고 워크스페이스 노트는 공유한다(v2.1.268, 2026-09-10).
- 오염 방어: 주입 전에 "invisible characters and tags that imitate Claude Code's own markup are neutralized"(v2.1.284, 2026-09-28). 저장소가 제공한 설정 파일이 고른 메모리 디렉터리는 `permissions.blockReadsOutsideWorkingDirectories`가 켜져 있으면 로드·회상·색인·추출에 쓰이지 않는다(v2.1.273, 2026-09-15). 백그라운드 세션이나 Claude Code의 도구가 시작한 세션에서는 자동 메모리를 켤 수 없다(v2.1.285, 2026-09-29).
- 연혁: v2.1.32(2026-02-05) "automatically records and recalls memories", v2.1.59(2026-02-25) 자동 메모리와 `/memory`, v2.1.74 `autoMemoryDirectory`, v2.1.83 25KB 한도. 출처: <https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md>.
- "auto dream"(Claude Code가 저장된 메모리를 스스로 재정리하는 기능)은 2026-03-26자 2차 기사에만 있고 변경 이력에서 찾지 못했다 `[2차][미확인]`.

**Claude API 메모리 도구** (<https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool>)

- 기계 구조는 선행 조사 6.1절과 같다. 바뀐 것은 지위다. 정식(stable)이고 Bedrock, Google Cloud, Microsoft Foundry에서도 정식이다.
- 문서가 이 도구의 목적을 "just-in-time context retrieval"로 규정한다. 관련 정보를 미리 싣지 않고 필요할 때 읽는다는 뜻이다.
- 새로 명시된 세부: `view`는 이미지 파일도 보여 주고 16,000자를 넘는 파일은 잘라 보여 준다. `create`는 도구 설명상 "creates or overwrites"다.

**Managed Agents 메모리 스토어** (<https://platform.claude.com/docs/en/managed-agents/memory>, 베타 헤더 `agent-memory-2026-07-22`)

- 저장: 워크스페이스 범위의 텍스트 문서 모음. 메모리 하나는 100kB(약 25k 토큰)까지, 스토어 하나는 10,000개까지. 문서는 "many small focused files, not a few large ones"를 권한다.
- 읽기 경로:
  1. 세션 생성 시 `resources`에 스토어를 붙인다. 실행 중에는 붙이거나 뗄 수 없다.
  2. 스토어가 샌드박스의 `/mnt/memory/<이름>/`에 디렉터리로 마운트된다.
  3. 마운트마다 설명 문구가 시스템 프롬프트에 자동으로 추가된다. 스토어의 `description`과 세션별 `instructions`(4,096자 이하)가 에이전트에 전달된다.
  4. 에이전트가 일반 파일 도구로 읽는다.
- 쓰기 경로:
  1. 에이전트가 일반 파일 도구로 쓴다. 전용 메모리 도구가 없다.
  2. 모든 변경이 불변 버전(`memver_…`)을 만들고 세션에 귀속된다. 버전은 30일 보존되며 민감 내용은 redact로 이력에서 지울 수 있다.
  3. API로 고칠 때는 `content_sha256` 전제 조건으로 동시 쓰기 충돌을 막는다.
- 공유와 권한: `access`는 기본 `read_write`이고 `read_only`를 고를 수 있으며 파일 시스템 수준에서 강제된다. 문서가 드는 패턴은 여러 세션에 붙이는 읽기 전용 공용 스토어 + 세션별 읽기-쓰기 스토어, 그리고 최종 사용자·팀·프로젝트마다 스토어 하나다.
- 오염 경고(원문): "If the agent processes untrusted input (user-supplied prompts, fetched web content, or third-party tool output), a successful prompt injection could write malicious content into the store. Later sessions then read that content as trusted memory."

**Dreams** (<https://platform.claude.com/docs/en/managed-agents/dreams>, 연구 프리뷰, 접근 신청 필요)

- 문제 정의(원문): "over many sessions a memory store accumulates duplicates, contradictions, and stale entries."
- 입력: 기존 메모리 스토어 하나 + 과거 세션 1~100개의 전사. 선택 사항으로 방향을 주는 `instructions`.
- 처리: 비동기 작업. 몇 분에서 몇 시간이 걸린다. 중복을 합치고, 낡았거나 모순된 항목을 최신 값으로 바꾸고, 새 통찰을 추가한다.
- 출력: **입력과 분리된 새 메모리 스토어**. 입력은 수정되지 않는다. 검토한 뒤 이후 세션에 대신 붙이거나 버린다. 문서 표현은 "The input store is never modified, so you can review the output and discard it"다.
- 실행 시점은 개발자가 정한다. 예약 기능은 문서에 없다.
- 2026-05-06 발표라는 것과 자동 적용/검토 선택은 2차 보도로 확인했다 `[2차]`.

**컴팩션과 컨텍스트 편집**

- 컴팩션(<https://platform.claude.com/docs/en/build-with-claude/compaction>): 요청형(`compact-2026-09-04` 헤더, 최상위 `compaction` 매개변수)과 임계치형이 있고 둘 다 베타다. 문서는 요청형을 먼저 쓰라고 권한다. 요청형은 최근 턴을 원문 그대로 유지하는 방식, 대화를 멈추지 않고 백그라운드로 요약하는 방식, 직접 쓴 요약 프롬프트를 지원한다.
- 컨텍스트 편집(<https://platform.claude.com/docs/en/build-with-claude/context-editing>, 베타 헤더 `context-management-2025-06-27`): `clear_tool_uses_20250919`(기본 임계치 100,000 입력 토큰, 최근 도구 사용 3개 유지)와 `clear_thinking_20251015`(이전 턴의 사고 블록 정리). 도구 결과를 지우면 프롬프트 캐시 접두사가 무효가 되므로 `clear_at_least`로 한 번에 충분히 지우라고 안내한다.
- 메모리와의 연결: 삭제 임계치에 가까워지면 "Claude receives an automatic warning to preserve important information"이다.
- Claude Code: 인식하지 못하는 모델 ID의 컨텍스트 창 가정을 200K에서 1M으로 바꿨다(v2.1.323, 2026-11-12). 자동 컴팩션 뒤에는 `MEMORY.md`와 CLAUDE.md를 다시 읽어 넣는다(v2.1.311의 수정 항목).

**Claude 앱 메모리** (<https://support.claude.com/en/articles/11817273-use-claudes-chat-search-and-memory-to-build-on-previous-context>, 2026-11-19 열람)

- 쓰기: "Claude saves memory as a set of individual topics as you chat, rather than summarizing conversations after they end." 사용자가 기억하라고 말해도 저장된다. 건강·정치 같은 민감 주제는 사용자가 동의해야 저장하고, 신분증 번호와 금융 계좌 번호는 저장하지 않는다.
- 읽기: 새 대화에 메모리가 반영된다(방식은 문서에 없음). 과거 대화 검색은 별도 기능이며 도구 호출로 실행되는 검색 증강 생성이고 원본 대화로 가는 인용이 붙는다.
- 범위: 프로젝트마다 자체 메모리가 있다. 프로젝트 안에서는 그 프로젝트 메모리와 계정 메모리를 쓰고 다른 프로젝트 메모리는 쓰지 않는다.
- 통제: 주제별 열람·수정·삭제, 일시 중지, 전체 초기화, 대화별 끄기, 시크릿 대화. 대화를 지워도 거기서 나온 메모리는 남는다.
- 기본값: 개인 요금제는 기본 켜짐. 2026-10-31 이후 만들어진 Team/Enterprise 조직도 기본 켜짐.
- 구형 방식: 일부 Team/Enterprise 조직은 "synthesized summary updated every 24 hours"를 아직 쓴다.

### 3.2 OpenAI

**Codex Memories** (<https://learn.chatgpt.com/docs/customization/memories?surface=app>, 2026-11-19 열람. `developers.openai.com/codex/memories`가 이 주소로 넘어간다)

- 저장: `$CODEX_HOME/memories_v2/`(기본 `~/.codex`)의 로컬 파일. 기본은 꺼져 있다.
- 쓰기 경로:
  1. 대화가 끝날 때마다가 아니라 백그라운드에서 생성한다. 활성 세션과 짧은 세션은 건너뛰고 대화가 유휴가 되기를 기다린다.
  2. 남은 요청 한도 비율이 설정값(`memories.min_rate_limit_remaining_percent`)보다 낮으면 건너뛴다.
  3. 대화별 추출(`memories.extract_model`) 뒤 전역 통합(`memories.consolidation_model`)을 한다. 통합 과정의 세부는 문서에 없다.
  4. 비밀 값은 가린다.
- 읽기 경로: `memories.use_memories`가 켜져 있으면 이후 세션에 주입한다. 대화마다 `/memories`로 읽기나 생성을 끌 수 있다.
- 오염 방어: `memories.disable_on_external_context`를 켜면 MCP, 웹 검색, 도구 검색을 쓴 대화가 메모리 생성 입력에서 빠진다.
- 위치 설정: 문서는 메모리를 "a helpful recall layer"로 부르고 반드시 지켜야 할 규칙은 AGENTS.md에 두라고 한다. 손으로 고치는 것을 주된 통제 수단으로 쓰지 말라고도 한다.

**Agents SDK 샌드박스 메모리** (<https://openai.github.io/openai-agents-python/sandbox/memory/>, 2026-11-19 열람)

- 세션(대화 이력)과 별개다. "Memory distills lessons from prior runs into files in the sandbox workspace."
- 파일: `memory_summary.md`(주입되는 짧은 요약), `MEMORY.md`(검색 대상 인덱스), `rollout_summaries/`(실행별 요약), `raw_memories/`, `sessions/<id>.jsonl`, `skills/`.
- 읽기 경로: (1) 실행 시작 시 SDK가 요약을 개발자 프롬프트에 주입한다. (2) 에이전트가 작업 키워드로 `MEMORY.md`를 검색한다. (3) 더 필요하면 실행 요약을 연다. 지침은 "treat memories as guidance only and trust the current environment"다.
- 쓰기 경로: (1) 실행이 끝나면 대화 파일에 덧붙인다. (2) 샌드박스 세션이 닫힐 때 1단계가 대화마다 원시 메모 노트를 쓴다. 시스템·개발자·추론 내용은 빼고 긴 대화는 앞과 끝을 남기고 자른다. (3) 2단계에서 에이전트가 원시 메모를 읽어 `MEMORY.md`와 `memory_summary.md`로 정리한다. 통합에 쓰는 원시 메모는 최신순 256개까지다. (4) 실시간 수정이 켜져 있으면 실행 중에 낡은 항목을 고칠 수 있다.
- 설정: 읽기만(`generate=None`), 생성만(`read=None`), 에이전트별 격리 배치.

**Responses API 컴팩션** (<https://developers.openai.com/api/docs/guides/compaction>, 2026-11-19 열람)

- 서버 측: `context_management`에 `compact_threshold`를 두면 "When the rendered token count crosses the configured threshold, the server runs server-side compaction."
- 독립 엔드포인트 `/responses/compact`: 상태 없이 전체 창을 받아 압축된 창을 돌려준다. 마지막 입력 항목으로 `{"type": "compaction_trigger"}`를 넣어 즉시 실행할 수도 있다.
- 컴팩션 항목은 암호화돼 있고 "opaque and not intended to be human-interpretable"다. Anthropic의 컴팩션이 읽을 수 있는 요약 블록을 돌려주는 것과 다르다. 사용자가 요약을 보고 고칠 수 없다는 뜻이다 `[추론]`.

**ChatGPT 메모리**

- OpenAI 도움말(릴리스 노트, 메모리 FAQ)이 이번에도 403으로 막혔다. 아래는 모두 검색 결과와 2차 보도다 `[2차]`.
- 2026-01: 대화 기록 참조 개선, 답에 쓰인 과거 대화를 출처로 표시.
- 2026-06-04: "Dreaming: Better memory for a more helpful ChatGPT" 발표. 대화가 끝난 뒤 백그라운드에서 기록을 검토해 기억을 갱신한다는 설명이 보도에 있다. Plus/Pro 메모리 용량 2배.
- 메모리 출처(memory sources): 어떤 저장된 메모리, 과거 대화, 맞춤 지시가 답에 쓰였는지 보여 준다.
- 2026-08-14: 프로젝트 전용 메모리 옵션.
- 내부 구조는 비공개다 `[미확인]`.

### 3.3 GitHub Copilot

출처: <https://docs.github.com/en/copilot/concepts/agents/copilot-memory>(2026-11-19 열람), <https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/>(2026-01-15, 2026-11-12 수정), <https://github.blog/changelog/2026-10-28-github-intelligence-puts-your-code-context-and-history-to-work>(2026-10-28)

- 저장: 두 종류. 저장소 수준 사실(협업자와 공유)과 사용자 수준 선호(저장소를 넘어 본인을 따라감). 비밀 값이 감지된 기억은 거부한다.
- 쓰기 경로:
  1. 에이전트가 작업 중 나중에 쓸모 있을 것을 발견하면 저장 도구를 호출한다.
  2. 기억에 인용을 붙인다. 저장소 사실은 근거가 되는 코드 위치, 사용자 선호는 사용자가 한 말의 직접 인용이다.
  3. 누구에게 적용되는지에 따라 종류를 고르고 모호하면 사용자에게 묻는다.
- 읽기 경로:
  1. 세션 시작 시 대상 저장소의 최근 기억을 프롬프트에 넣는다. 검색 도구와 가중 우선순위는 "앞으로 할 일"로 적혀 있다.
  2. 기억을 쓰기 전에 인용된 코드를 현재 브랜치에서 확인한다.
  3. 코드와 모순되거나 인용이 무효면 고친 버전을 저장한다. 맞고 쓸모 있으면 다시 저장해 시각을 갱신한다.
- 설계 근거(블로그): 중복 제거·충돌 해소·만료를 오프라인 큐레이션으로 하지 않고 읽는 시점에 검증한다. "Information retrieval is an asymmetrical problem: It's hard to solve, but easy to verify."
- 망각: 기본 만료 90일. 조직은 저장소 사실의 만료를 7~180일로 정할 수 있다. 만료 시계는 Copilot이 그 기억에 찬성표를 줄 때 재설정되고, 단순히 꺼내는 것으로는 재설정되지 않는다.
- 공유: 코드 리뷰가 기록한 규칙을 코딩 에이전트와 CLI가 쓴다. 기억은 저장소 밖으로 나가지 않고 포크에도 복사되지 않는다.
- 적대적 시험(블로그): 모순된 기억과 존재하지 않는 코드를 가리키는 인용을 심었을 때 에이전트가 인용을 검증해 틀린 기억을 고쳤다고 보고한다.
- 자사 평가 수치(블로그): 코딩 에이전트 A/B에서 풀 리퀘스트 병합률 90% 대 83%, 코드 리뷰 긍정 피드백 77% 대 75%. 자사 측정이다.
- dreaming(공개 프리뷰, 선택 기능): 세 종류. 개인 메모리 큐레이션, 저장소 맞춤(저장소 기억을 관리하고 스킬과 지시 파일 수정을 제안), 코드 리뷰 맞춤(반복해서 수용된 리뷰 피드백을 지침으로 변환). 저장소에 체크인된 스킬과 지시의 변경은 풀 리퀘스트로 제안된다. 실행 주기는 출처에 없다.
- 지위: 2026-01-15 공개 프리뷰, 2026-03-04 Pro/Pro+ 기본 켜짐, 2026-10-28 정식 출시.

### 3.4 Cognition: Devin, Windsurf, Poke

**Devin Memory** (<https://docs.devin.ai/product-guides/memory>, 2026-11-19 열람. 출시일은 <https://docs.devin.ai/release-notes/2026>의 2026-10-09 항목)

- 저장: "persistent Git repository of Markdown notes"(메모리 드라이브). `MEMORY.md`에 일반 선호, 하위 폴더에 프로젝트·도구별 노트(예: `my-app/testing.md`, `tools/datadog.md`). 항목은 한 줄 불릿이고 출처 메타데이터(세션 ID, 추가 날짜)가 붙는다.
- 쓰기 경로:
  1. 사용자가 요청하지 않아도 작업 중 Devin이 쓴다. 계기는 교정, 설명된 선호, 재사용할 발견이다.
  2. 저장: 선호, 교정과 따를 규칙, 결정과 이유, 저장소·환경의 함정. 저장하지 않음: 세션 요약, PR 번호 같은 작업 상태, 다시 알아내기 쉬운 것, 비밀 값.
  3. 편집을 커밋하고 병렬 세션의 변경을 병합한다. 충돌은 덮어쓰지 않고 해소한다.
  4. 새 기억은 그것을 쓴 세션이 아니라 이후 세션부터 적용된다.
- 읽기 경로: 세션마다 드라이브를 체크아웃하고 `MEMORY.md`를 컨텍스트로 받는다. 다른 노트는 작업에 필요할 때만 읽는다.
- dreaming: 사용자가 Devin을 쓴 날 하루에 한 번 정도 도는 백그라운드 세션. 최근 세션과 기존 메모리를 함께 검토해 겹치는 노트를 합치고, 일시적이거나 쓰이지 않는 낡은 노트를 지우고, 놓친 교훈을 추가하고, 구조를 다시 잡는다. 출처 링크와 명시적 선호는 보존한다. 2026-10-19부터 dreaming만 따로 끌 수 있다.
- 범위: 조직 안에서 개인 단위이며 팀원과 공유하지 않는다. Devin Bot은 자체 메모리를 가지며 그 Bot을 쓰는 모두가 공유한다. 자동화로 시작된 세션은 메모리를 읽지도 쓰지도 않는다.
- 통제: 앱에서는 읽기 전용이고 고치려면 세션에서 Devin에게 요청한다. API는 세션 생성 시 `memory_enabled: false`를 받는다(2026-11-06).
- 스킬과의 구분: 스킬은 사람이 쓴 반복 절차, 메모리는 Devin이 일하며 배운 것이다. 문서 표현은 "a skill provides the procedure, and memory supplies the context for applying it"다.

**Devin Knowledge**: 폐기 예정이다. 문서가 "will be removed in a future update"라고 적고 기존 항목은 Plugins의 Skills로 자동 이전 중이다(<https://docs.devin.ai/product-guides/knowledge>). Playbooks도 Skills로 옮겨진다(릴리스 노트 2026-10-23).

**Windsurf**: `docs.windsurf.com`의 Cascade 메모리 주소가 `docs.devin.ai/desktop/cascade/memories`로 넘어간다. 넘어간 페이지는 규칙(`AGENTS.md`, `.devin/rules/`), 스킬, 훅만 설명하고 자동 생성 메모리는 다루지 않는다(2026-11-19 열람). Cascade의 자동 생성 메모리가 지금도 있는지는 확인하지 못했다 `[미확인]`.

**Poke**: Cognition 블로그(2026-07-23)는 "it's proactive, it knows you"라고만 적고 메모리를 설명하지 않는다 `[미확인]`.

### 3.5 Cursor

- 편집기의 Memories 기능은 제거됐다. Cursor 포럼에서 직원으로 보이는 Dean Rie가 "The Memories feature was intentionally removed starting from version 2.1.x"라고 답했고, "Export memories" 명령으로 `.mdc` 파일로 내보내 Rules에 넣으라고 안내했다(<https://forum.cursor.com/t/are-my-memories-gone/144057>, 2025-11-25). 공식 변경 이력의 해당 항목은 찾지 못했다.
- 현재 문서의 입장: "Large language models don't retain memory between completions. Rules provide persistent, reusable context at the prompt level."(<https://cursor.com/docs/context/memories>가 규칙 문서로 넘어감, 2026-11-19 열람). 즉 일반 에이전트 대화의 지속 컨텍스트는 사람이 쓰는 규칙과 스킬이다.
- Automations에는 메모리가 있다. 자동화의 에이전트가 실행 간에 읽고 쓰는 이름 붙은 항목이고 기본 이름은 `MEMORIES.md`, 에이전트의 작업 파일 시스템 밖에 저장되며 기본으로 켜져 있다. 설정 화면에서 보고 고치고 지울 수 있고 에이전트가 실행 중 낡은 파일을 지울 수 있다. 문서의 경고: "Memories persist across runs and should be used with caution if your automation handles untrusted input."(<https://cursor.com/docs/cloud-agent/automations>, 2026-11-19 열람)
- 음성 에이전트는 "search earlier messages and calls with this agent"를 할 수 있다(변경 이력 2026-11-06, <https://cursor.com/changelog>).

### 3.6 Google

**Gemini CLI** (<https://geminicli.com/docs/cli/auto-memory.md>, 2026-11-19 열람)

- `save_memory` 도구: 모델이 호출하면 `~/.gemini/GEMINI.md`의 "Gemini Added Memories" 절에 사실 한 줄을 덧붙인다 `[2차, 검색 발췌]`.
- Auto Memory(실험, 기본 꺼짐, `experimental.autoMemory`):
  1. 세션 시작 시 백그라운드 작업으로 돈다.
  2. 대상은 3시간 이상 유휴이고 사용자 메시지가 10개 이상인 과거 세션뿐이다. 현재 세션, 사소한 세션, 서브에이전트 세션은 제외한다.
  3. 백그라운드 에이전트가 세션을 읽어 지속될 사실과 반복되는 작업 절차를 찾는다. "It defaults to creating no artifacts unless the evidence is strong."
  4. 산출물은 두 가지다. 메모리 파일에 대한 통합 diff 형식의 패치와 `SKILL.md` 초안.
  5. 전부 프로젝트별 인박스에 대기하고 `/memory inbox`에서 사용자가 승인하거나 버린다. 승인 전에는 어떤 세션에도 로드되지 않는다.
  6. Auto Memory는 활성 메모리 파일, 설정, 자격 증명, 프로젝트 `GEMINI.md`를 직접 고칠 수 없다.

**ADK** (<https://adk.dev/sessions/memory/>, 2026-11-19 열람)

- 쓰기: 개발자가 콜백에서 `add_session_to_memory`(끝난 세션 전체) 또는 `add_events_to_memory`(긴 세션 중간의 증분)를 호출한다. `VertexAiMemoryBankService`는 LLM으로 기억을 추출하고 `enable_consolidation`으로 관련 기존 항목과 병합한다.
- 읽기: 두 도구 중 고른다. `preload_memory`는 매 턴 시작에 자동으로 검색하고, `load_memory`는 에이전트가 필요하다고 판단할 때 검색한다. "자동 파이프라인"과 "모델이 호출하는 도구"가 한 프레임워크 안에 선택지로 나란히 있다.

**Gemini 앱**: 2026-03-26 블로그가 다른 AI 앱의 기억과 대화 기록 가져오기를 발표하고 "past chats"를 "memory"로 바꾼다고 알렸다. 저장·검색 구조는 설명하지 않는다 `[미확인]`.

**Jules**: 저장소별 Memory가 2025-09-30 변경 이력에 있다고 검색 결과가 전한다. 작업 중 선호·교정을 저장해 이후 작업에 적용하고 저장소 설정에서 고치거나 끌 수 있다 `[2차]`. `jules.google/docs/memory`는 404였다.

### 3.7 Letta

- Context Repositories(<https://www.letta.com/blog/context-repositories>, 2026-02-12): 에이전트 메모리를 로컬 파일 시스템의 Git 저장소로 다시 만들었다.
- 읽기 경로: (1) 파일 트리가 항상 시스템 프롬프트에 있다. "folder hierarchy and file names act as navigational signals." (2) 파일마다 내용을 설명하는 YAML 프런트매터가 있다. (3) `system/` 디렉터리의 파일은 항상 전문이 로드된다. 에이전트가 파일을 이 디렉터리 안팎으로 옮겨 무엇이 컨텍스트에 남을지 조절한다.
- 쓰기 경로: (1) 에이전트가 bash와 파일 도구로 쓴다. 전용 메모리 도구를 버린 이유는 "Files are simple, universal primitives"다. (2) 서브에이전트마다 격리된 Git 워크트리를 받아 동시에 쓰고 Git으로 병합한다. (3) 반성(백그라운드에서 최근 대화를 검토해 커밋 메시지와 함께 저장), 조각 모음(백업 후 큰 파일을 나누고 중복을 합쳐 15~25개 파일로 재구성), 초기화(코드베이스와 Claude Code/Codex 이력을 읽어 초기 구조 생성)가 내장 스킬이다.
- dreaming 실행 시점: 정해진 에이전트 스텝 수가 지난 뒤 또는 컨텍스트가 컴팩션될 때. "Agent reviews before applying" 옵션은 두 번째 백그라운드 대화가 제안된 수정을 검토한다(<https://docs.letta.com/letta-code/memory>, 2026-11-19 열람).

### 3.8 OpenClaw와 Hermes Agent

**OpenClaw** (<https://docs.openclaw.ai/concepts/memory>, 2026-11-19 열람. 선행 조사 5.2절 이후 달라진 것만)

- `intent` 도구: 사건 조건부의 상시 의도를 만들고 나열하고 취소한다. 시간 조건은 예약 작업이 맡는다.
- memory-wiki 플러그인: 지속 지식을 위키 볼트로 편집해 `wiki_search`/`wiki_get`으로 읽는다. 기본 메모리 플러그인을 대체하지 않는다.
- 가져오기: Codex, Claude Code, Hermes의 기록을 `memory/imports/`로 가져온다. 색인은 되지만 `MEMORY.md`에 병합되지는 않는다.
- 검색 백엔드: 기본은 SQLite. PostgreSQL 검색이 추가됐고 Honcho와 LanceDB는 플러그인이다.
- 컴팩션 전 플러시의 쓰기는 일별 노트에 덧붙이는 것만 허용되고 재생된 내용은 거부된다.
- v2026.8.1(OpenClaw 2.0) 릴리스 노트: 개인 에이전트가 자신의 다른 비공개 대화에서 관련 맥락을 회상하고, 메모리를 검색·검사·가져오기·삭제하는 화면이 생겼다(<https://docs.openclaw.ai/releases/2026.8.1.md>, 날짜 표기 없음).

**Hermes Agent v0.23.0** (<https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.0>, 2026-11-05)

- `compression.prepare_ahead: true`(선택): 세션이 압축 임계치에 가까워지면 다음 요약을 백그라운드에서 미리 쓴다.
- 압축 요약이 불확실한 주장을 `UNVERIFIED:` 줄로 표시한다.
- `hermes curator lock`: 사람이 손본 스킬을 에이전트가 고쳐 쓰지 못하게 잠근다. `skill_manage`, 파일 편집, 터미널 쓰기 모두 막히고 curator도 보관 처리하지 않는다.
- 스킬이 컴팩션에서 지워지면 다시 불러오라는 표시가 남는다.
- 작업자(칸반 워커)의 턴은 사용자의 메모리로 저장하지 않는다.
- 메모리 제공자 플러그인이 계속 늘고 있다(이번 릴리스에 6개).

### 3.9 LangChain, Amp

- **Deep Agents**(<https://docs.langchain.com/oss/python/deepagents/long-term-memory>, 2026-11-19 열람): 메모리는 파일이다. `memory=`에 경로(예: `/memories/AGENTS.md`)를 주면 시작 시 시스템 프롬프트에 넣거나 필요할 때 읽는다. `CompositeBackend`가 경로 접두사별로 저장소를 고른다. `/memories/`와 `/skills/`는 네임스페이스(에이전트 단위 또는 사용자 단위)를 가진 `StoreBackend`로, 나머지는 대화 상태로 간다. 쓰기는 에이전트의 `edit_file` 도구이고, 대화 중에도 크론으로 도는 별도 에이전트의 백그라운드 통합에서도 일어난다. 공용 정책은 프롬프트 인젝션을 줄이려고 읽기 전용으로 두라고 한다. LangMem의 현재 유지 상태는 이번에 확인하지 않았다 `[미확인]`.
- **Amp**(<https://ampcode.com/docs/threads>, 2026-11-19 열람): 메모리 기능을 두지 않는다. 작업 하나에 스레드 하나를 권하고, 긴 스레드는 "Handoff and …"로 필요한 맥락만 들고 새 스레드를 연다. 다른 스레드는 URL이나 `@T-…`로 참조해 에이전트가 읽게 하고 키워드·파일·작성자·날짜로 검색한다. 커밋에 `Amp-Thread-ID`가 붙어 코드 변경에서 대화로 거슬러 올라갈 수 있다. 지속 지시는 AGENTS.md가 맡는다.

### 3.10 내부를 공개하지 않는 제품

- **Manus**: 블로그 목록에 "Introducing Project Skills"(2026-02-12)와 "Introducing Manus 2.0"(2026-09-28)이 보인다는 것만 검색으로 확인했다 `[2차]`. 메모리 기능을 정의한 공식 페이지는 찾지 못했다 `[미확인]`.
- **Poke**: 3.4절.
- **Pickle, Vooy**: 선행 조사가 하루 전이라 다시 조사하지 않았다. 내부 비공개라는 결론은 그대로다.

## 4. 연구와 벤치마크

### 4.1 벤치마크: LoCoMo와 LongMemEval에 대한 비판

| 주장 | 근거 | 지위 |
|---|---|---|
| LoCoMo 대화는 최신 컨텍스트 창에 다 들어가고 전체 컨텍스트 기준선(약 73%)이 Mem0를 넘는다. 지식 갱신 문항이 없고 5번 범주는 정답이 없어 쓸 수 없다 | Zep 블로그(2025-05-06), <https://www.getzep.com/blog/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/> | 경쟁사의 주장 |
| Mem0가 Zep을 잘못 구현해 65.99%로 보고했고, 바르게 구현하면 75.14%다 | 같은 글 | 경쟁사의 주장, 양측 수치가 충돌 |
| 대화 기록을 파일로 붙이고 파일 검색 도구만 준 에이전트가 GPT-4o mini로 LoCoMo 74.0%를 냈다. Mem0가 보고한 최고 68.5%보다 높다 | Letta 블로그(2025-08-12), <https://www.letta.com/blog/benchmarking-ai-agent-memory> | 자사 측정 |
| LoCoMo 채점 문항 1,540개 중 99개(6.4%)의 정답 키가 틀렸고, LLM 채점자가 일부러 틀리게 쓴 답의 최대 63%를 받아들인다 | Penfield Labs 감사, <https://penfieldlabs.substack.com/p/we-audited-locomo-64-of-the-answer> | `[2차]` 원문을 열지 않았고 독립 재현 여부를 확인하지 못함 |
| 같은 제품의 LoCoMo 점수가 평가 도구와 채점 프롬프트에 따라 58에서 95까지 나온다 | 제3자 정리 글 | `[2차]` |

Letta의 결론이 이 문서의 주제와 직접 닿는다. 어떤 검색 장치를 쓰느냐보다 "whether an agent will be able to effectively use a retrieval tool"이 중요하다는 것이다. 단순 파일 에이전트가 잘한 이유는 질문 원문 대신 스스로 검색어를 만들고 찾을 때까지 다시 검색했기 때문이다.

### 4.2 새 벤치마크

| 이름 | 날짜·게재 | 재는 것 | 핵심 주장 | 출처 |
|---|---|---|---|---|
| ConvoMem | arXiv 2025-11-13 (Salesforce 소속 저자) | 질문-답 75,336쌍. 사용자 사실, 선호, 시간 변화, 암묵적 연결 | 첫 30개 대화까지는 긴 컨텍스트가 잘 작동하고 150개까지는 절충하며 쓸 만하다. 그 뒤에는 하이브리드나 검색이 필요하다. 150개 미만 이력에서 Mem0는 30~45%, 전체 컨텍스트는 70~82% | <https://arxiv.org/abs/2511.10523> |
| BEAM | arXiv 2025-10-31, ICLR 2026 | 대화 100개, 문항 2,000개, 길이 128K~10M 토큰 | 1M 토큰 창을 가진 모델도 검색 증강 유무와 상관없이 대화가 길어질수록 성능이 떨어진다 | <https://arxiv.org/abs/2510.27246> `[2차, 초록 수준]` |
| MemoryArena | arXiv 2026-02-18, ICML 2026 | 뒤 하위 작업이 앞 세션에 의존하는 다중 세션 에이전트 작업(웹 탐색, 선호 제약 계획, 정보 탐색, 형식 추론) | LoCoMo류에서 거의 포화된 에이전트가 이 설정에서는 성능이 낮다 | <https://arxiv.org/abs/2602.16313> `[2차, 초록 수준]` |
| AMA-Bench | arXiv 2026-02 | 대화가 아니라 에이전트-환경 상호작용의 장기 기억 | 손실 압축과 유사도 검색은 에이전트 메모리에 부족하다 | <https://arxiv.org/abs/2602.22769> `[2차]` |

방향은 같다. "대화에서 사실을 회상하는가"에서 "여러 세션에 걸친 작업을 기억 덕분에 더 잘 끝내는가"로 측정 대상이 옮겨가고 있다 `[추론, 위 네 건에 근거]`.

### 4.3 연구 시스템 중 달라진 것

- **Mem0의 새 알고리즘**(<https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm>, 2026-04-16, 2026-09-28 수정):
  - 쓰기: LLM 호출 한 번으로 추출하고 추가만 한다. "The new algorithm collapses extraction into a single LLM call that only adds." 바뀐 사실은 덮어쓰지 않고 옛 사실 옆에 둔다. 에이전트가 생성한 사실도 사용자 진술과 같은 비중으로 저장한다. 고유명사 등 엔티티는 별도 조회 층에 둔다.
  - 읽기: 의미, 키워드, 엔티티 점수를 병렬로 계산해 합친다. 검색 호출당 평균 7,000토큰 미만.
  - 수치: LoCoMo 71.4 → 92.5, LongMemEval 67.8 → 94.4, BEAM 64.1(1M)/48.6(10M). 자사 관리형 플랫폼에서 자사가 측정했다. Mem0의 다른 페이지에는 91.6/93.4로 적혀 있어 자사 페이지끼리도 다르다.
  - 스스로 인정하는 약점: 시간 추론.
- **ACE(Agentic Context Engineering)**(<https://arxiv.org/abs/2510.04618>, 2025-10-06, ICLR 2026) `[2차, 초록 수준]`: 컨텍스트를 압축 요약이 아니라 계속 자라는 플레이북으로 다룬다. 생성자, 반성자, 큐레이터 세 역할이 돌아가며 전략을 덧붙인다. 요약이 도메인 세부를 잃는다는 문제의식이다. 수치는 저자 보고다.
- **Always-On Agents 서베이**(<https://arxiv.org/abs/2606.30306>, 2026-06-29): 435편을 분류한 결과 문헌이 상태를 쌓고 꺼내는 데 치우쳐 있고 통제·복구·폐기는 훨씬 적게 다룬다고 본다. 상태 항목을 권한, 범위, 변경 가능성, 출처, 복구 가능성, 실행 가능성 여섯 축으로 본다. 3절의 제품들이 2026년 하반기에 추가한 것(버전, 읽기 전용, 만료, 출처)이 이 빈자리에 해당한다 `[추론]`.

## 5. 흐름

여러 1차 출처가 뒷받침하는 것만 적었다. 각 항목 끝에 근거 제품을 적는다.

### 5.1 확인된 흐름

1. **에이전트가 관리하는 파일 메모리가 벡터 저장소를 대신한다.** 근거: Claude Code, Anthropic 메모리 스토어, Devin, Letta, Codex, Agents SDK 샌드박스 메모리, Deep Agents, Cursor Automations. 반례: OpenClaw는 파일 위에 벡터+키워드 색인을 유지하고, Claude 앱의 과거 대화 검색은 검색 증강 생성이며, ADK의 기본 선택지는 추출·검색 서비스다. 정리하면 "큐레이션된 기억은 파일, 원본 기록 찾기는 검색"이다.
2. **모델이 호출하는 도구와 자동 파이프라인이 섞인다.** 세션 중 쓰기는 모델의 도구 호출(Claude Code, Devin, Copilot, Anthropic, Hermes), 세션 밖 정리는 파이프라인(Dreams, Codex, 샌드박스 메모리 2단계, Gemini CLI)이다. Codex만 세션 중 쓰기 없이 백그라운드 생성에 의존한다. ADK는 두 읽기 방식을 나란히 제공한다.
3. **백그라운드 통합의 제품화.** 결론 3번. 설계상 공통점 세 가지: 입력이 "기존 저장소 + 과거 세션 전사"다(Dreams, Devin, 샌드박스 메모리). 유휴나 야간에 돈다(Codex, Gemini CLI, Devin). 결과를 바로 덮어쓰지 않는 장치가 있다(Dreams의 별도 출력 스토어, Gemini CLI 인박스, Copilot의 풀 리퀘스트, Letta의 검토 옵션).
4. **컴팩션과 컨텍스트 편집이 단기 기억의 기본.** 결론 4번. 추가로 요약 없이 도구 결과만 지우는 단계(Anthropic `clear_tool_uses`)가 요약보다 먼저 온다. 컴팩션 직전에 메모리로 저장할 기회를 주는 장치도 유지된다(Anthropic의 자동 경고, OpenClaw 플러시).
5. **절차 기억은 스킬.** 이름과 설명만 항상 보이고 본문은 필요할 때 로드되는 구조가 공통이다(Devin, Deep Agents, Hermes, Gemini CLI, Agents SDK `skills/`). 쓰는 주체가 사람에서 에이전트 제안으로 넓어지는 중이며, 제안은 대부분 사람 승인을 거친다(Gemini CLI 인박스, Copilot 풀 리퀘스트, Hermes curator 잠금).
6. **공유 메모리와 서브에이전트 메모리.** 범위가 명시적 설정이 됐다. Copilot(저장소 사실은 공유, 선호는 개인), Devin(개인, Bot은 공유), Anthropic(읽기 전용 공용 스토어 + 세션별 스토어), Claude Code 서브에이전트(`user`/`project`/`local`), Deep Agents(에이전트 단위/사용자 단위 네임스페이스), Letta(워크트리 병합). 동시 쓰기 해법은 Git 병합(Devin, Letta)과 내용 해시 전제 조건(Anthropic) 두 가지다.
7. **출처, 인용, 사용자가 보고 고칠 수 있는 메모리.** Copilot 인용, Devin의 세션 ID와 날짜, Claude Code의 `modified`, Anthropic의 버전 이력, Claude 앱의 과거 대화 인용, ChatGPT 메모리 출처 `[2차]`. 파일 형태 자체가 사람이 읽고 고칠 수 있게 한다.
8. **망각과 낡음 처리.** 시간 기반 만료(Copilot 90일, 검증된 사용 시 갱신), 읽는 시점 검증(Copilot), 수정 시각 노출(Claude Code), 통합 때 낡은 항목 제거(Dreams, Devin dreaming), 최신순 상한(샌드박스 메모리 256개), "메모리는 참고일 뿐 현재 환경을 믿어라"는 지침(샌드박스 메모리). 선행 조사가 본 "점수 감쇠"는 OpenClaw 외의 출시 제품에서는 확인하지 못했다.
9. **메모리 오염 방어.** 다섯 가지 장치가 반복된다. 외부 입력이 섞인 대화를 쓰기에서 제외(Codex `disable_on_external_context`, OpenClaw untrusted), 읽기 전용 마운트(Anthropic, Deep Agents), 주입 전 무력화(Claude Code), 읽는 시점 검증(Copilot), 사람 승인(Gemini CLI). OWASP의 에이전트 애플리케이션 상위 10(2025-12-09 발행)에 메모리·컨텍스트 오염이 ASI06으로 들어 있다는 것은 2차 자료로만 확인했다 `[2차]`.

### 5.2 근거가 엇갈리는 것

- **긴 컨텍스트 창이 검색을 불필요하게 만드는가.** 그렇다는 쪽: ConvoMem(첫 150개 대화까지), Zep이 인정한 LoCoMo 전체 컨텍스트 기준선, Claude Code의 1M 기본 가정. 아니라는 쪽: BEAM(1M 창 모델도 길어지면 떨어짐), Anthropic의 컴팩션 문서("response quality degrades as a conversation grows"). 결론: 짧은 이력에서는 검색 없이 통째로 넣는 것이 유효하지만 장기 메모리를 대체하지는 못한다 `[추론]`.
- **쓰는 순간 큐레이션할 것인가, 읽는 순간 검증할 것인가.** Copilot은 오프라인 큐레이션을 일부러 하지 않고 읽을 때 검증하다가 2026-10에 dreaming을 추가했다. Mem0는 쓰기 시점 판정을 버렸다. Devin과 Anthropic은 쓰기는 가볍게 하고 야간 통합에 맡긴다. 공통점은 대화 경로(hot path)의 쓰기를 가볍게 한다는 것이다.

## 6. 우리 앱에 대입

선행 조사의 추천으로 구현된 여덟 모듈(A~H)을 현재 제품들과 견준다. 표의 판정은 3절과 5절에 근거한 조사자의 평가다 `[추론]`.

### 6.1 여덟 모듈 점검

| 모듈 | 판정 | 지금 제품들과 다른 점 | 고칠 것 |
|---|---|---|---|
| A. 슬라이딩 윈도우 | 기준선으로 유효, 주력은 아님 | 최신 하네스는 잘라 버리지 않고 컴팩션한다. 창이 200K~1M이라 자를 일이 드물다 | 기본값을 B로 두고 A는 비용 통제용으로 남긴다 |
| B. 요약 + 버퍼 | 현재 방식과 일치 | 빠진 것 셋. 요약 전에 도구 결과만 지우는 단계, 컴팩션 직전 메모리 저장 기회, 요약 지시문 사용자 지정 | 6.2절의 N2 |
| C. 고정 프로필 | 현재 방식과 일치 | 한도 초과를 오류로 돌려 모델이 줄이게 하는 것은 Claude Code도 채택했다(v2.1.210). 빠진 것: 세션 시작 스냅샷 고정, 항목별 출처와 날짜 | 한 줄 항목 + (출처 세션, 날짜) 형식으로 바꾼다 |
| D. 사실 추출 + 통합 | 설계 원본이 바뀜 | Mem0가 ADD/UPDATE/DELETE 판정을 버렸다. 출시 하네스 중 매 턴 추출 파이프라인을 쓰는 곳을 찾지 못했다 | "추가 전용 + 읽을 때 검증 + 만료" 변형을 옵션으로 둔다(N3). 기존 판정 방식은 남기되 기본값에서 내린다 |
| E. 일화 스트림 | 부분적으로 낡음 | 쓰기 시점에 LLM이 중요도를 매기는 출시 제품을 찾지 못했다. 일화 기억의 현재 형태는 "원본 세션 기록을 도구로 검색"이다(Hermes `session_search`, Claude 과거 대화 검색, Amp 스레드 검색) | 중요도 점수를 선택 사항으로 내리고 세션 기록 검색 도구를 더한다(N6) |
| F. 파일 메모리 | 가장 주류 | 실제 제품은 분류 노드가 파일을 고르지 않고 모델이 도구 루프로 연다. 빠진 것: 유형과 수정 시각 프런트매터, 인덱스 한도 피드백, 범위, 주입 전 무력화 | N1이 전제다 |
| G. 시간 사실 그래프 | 틈새 | 출시 하네스에 내장된 예를 찾지 못했다. 전용 메모리 서비스의 영역이다. Mem0는 무효화 대신 옛 값과 새 값을 함께 두는 쪽으로 갔다 | 유지하되 우선순위 최하. 사실이 자주 바뀌는 업무용으로만 안내한다 |
| H. 백그라운드 통합 | 올해 가장 많이 채택됨 | 빠진 것: 입력으로 세션 전사를 읽기, 결과를 별도 사본에 써서 검토 후 교체, 유휴 조건, 스킬 제안 | N4 |

### 6.2 추가할 것

읽기 경로와 쓰기 경로, 필요한 새 기본 요소 순으로 적는다. 기본 요소 기호 P1~P5는 선행 조사 7.2절의 것이고 P6부터가 새로 필요한 것이다.

**N1. 모델 주도 메모리(도구 호출형)** — 가장 중요

- 읽기: [시스템 프롬프트에 메모리 지침과 인덱스 주입] → LLM이 필요하면 `view`/`search` 도구 호출 → [P1 읽기] → 결과를 대화에 붙여 LLM 재호출.
- 쓰기: LLM이 턴 중에 `create`/`str_replace`/`delete` 도구 호출 → [경로 검증, 크기 한도 검사] → [P1 쓰기] → 한도 초과 시 오류 문자열을 도구 결과로 반환.
- 새 기본 요소 **P6: LLM 노드의 도구 호출 루프**와 **P7: 저장소에 묶인 메모리 도구 묶음**(Anthropic 메모리 도구의 여섯 명령이 참고 규격). 읽기와 쓰기가 LLM 호출 "앞뒤"가 아니라 "안"에서 일어나므로 현재의 앞 블록/뒤 블록 구조만으로는 표현되지 않는다.
- 근거: Claude Code, Anthropic 메모리 도구와 스토어, Devin, Copilot, Hermes, Letta, Deep Agents.

**N2. 컴팩션 강화(B의 확장)**

- 읽기: [요약 블록 + 최근 원문 턴 + 지워진 도구 결과 자리 표시] → LLM.
- 쓰기: [토큰 수 계산] → 1차 임계치에서 [오래된 도구 결과를 자리 표시로 교체, 최근 N개 유지] → 2차 임계치에서 [컴팩션 전 훅: 메모리 모듈에 저장 턴 한 번 실행] → [LLM 요약, 사용자 지정 지시문] → [요약 블록으로 교체, 최근 턴 원문 유지].
- 새 기본 요소 **P8: 토큰 계수와 임계치 이벤트**, **P9: 이력 안의 도구 결과를 구분해 다루는 수단**, **P10: "컴팩션 직전" 훅으로 다른 메모리 모듈의 쓰기 경로를 부르는 연결**.
- 근거: Anthropic 컴팩션과 컨텍스트 편집, OpenAI 컴팩션, OpenClaw 플러시, Hermes `prepare_ahead`.

**N3. 출처·신뢰·검증 메타데이터(모든 저장 모듈에 걸치는 변경)**

- 쓰기: 모든 메모리 쓰기에 (출처 세션, 작성 시각, 근거 인용, 신뢰 표시)를 자동으로 붙인다. 이번 턴에 외부 도구 결과가 섞였으면 신뢰 표시를 낮추거나 쓰기를 건너뛴다.
- 읽기: [주입 전 무력화: 보이지 않는 문자와 시스템 마크업 흉내 제거] → [신뢰 낮은 항목 제외] → [선택: 인용된 근거를 다시 확인해 틀리면 정정 쓰기] → 주입. 만료 시각이 지난 항목은 제외하고, 검증을 통과해 쓰인 항목만 만료를 연장한다.
- 새 기본 요소 **P11: 저장소 항목의 표준 메타데이터 필드**(P1/P2 확장), **P12: 턴 단위 "외부 입력 포함" 표시**, **P13: 저장소 버전 이력과 읽기 전용 모드**.
- 근거: Copilot, Claude Code v2.1.284, Anthropic 스토어, Codex, OpenClaw, Devin.

**N4. 백그라운드 통합 개정(H의 확장)**

- 읽기: 자체 읽기 경로 없음.
- 쓰기: [P3 트리거: 유휴 N시간 또는 하루 한 번] → [P1 읽기: 현재 저장소] + [세션 전사 읽기: 마지막 실행 이후 1~100개] → [LLM: 중복 병합, 모순은 최신 값으로, 낡은 항목 제거, 놓친 교훈 추가. 출처와 명시적 선호는 보존] → [P1 쓰기: **별도 사본**] → [검토 대기 또는 자동 교체] → [선택: 스킬 초안 제안].
- 새 기본 요소 **P14: 세션 전사 저장소**(N6과 공유), **P15: 저장소 사본 만들기와 교체**(또는 변경 제안 인박스).
- 근거: Anthropic Dreams, Devin dreaming, Gemini CLI Auto Memory, Copilot dreaming, Agents SDK 2단계.

**N5. 절차 기억(스킬 모듈)**

- 읽기: [스킬 목록의 이름과 설명만 주입] → LLM이 관련 스킬을 고르면(도구 호출 또는 분류 노드) → [P1 읽기: 스킬 본문] → LLM.
- 쓰기: [백그라운드 검토 또는 턴 뒤 LLM: 반복된 교정이나 절차가 있는가] → [스킬 초안 또는 기존 스킬 패치 생성] → [승인 대기] → [P1 쓰기]. 사람이 손본 스킬은 잠금 표시로 자동 수정에서 제외한다.
- 새 기본 요소: N1의 P6이 있으면 스킬 로드는 도구 하나로 끝난다. 추가로 **P16: 승인 대기열**(N4의 P15와 같은 것을 쓸 수 있다).
- 근거: Devin Skills, Gemini CLI, Copilot dreaming, Hermes curator, Deep Agents.

**N6. 세션 기록 검색(E의 대체 읽기 경로)**

- 읽기: LLM이 `session_search(질의, 기간)` 도구 호출 → [전문 검색, 필요하면 의미 검색 병행] → 원문 메시지 조각 반환(요약하지 않음) + 원본 세션 링크.
- 쓰기: [매 턴 원문을 세션 전사 저장소에 추가]. LLM 호출 없음.
- 새 기본 요소: P14, 그리고 전문 검색 색인. N1의 P6 필요.
- 근거: Hermes, Claude 앱, Amp, OpenClaw `sessions_search`, Cursor 음성 에이전트.

**N7. 공유·범위 메모리(저장소 속성)**

- 읽기: [범위별 저장소를 정해진 순서로 읽기: 조직(읽기 전용) → 프로젝트 → 사용자 → 에이전트].
- 쓰기: [쓸 범위 결정: 누구에게 적용되는 사실인가, 모호하면 사용자에게 질문] → [내용 해시 전제 조건으로 충돌 감지 → 다시 읽고 재시도].
- 새 기본 요소: P1의 범위에 조직/프로젝트/에이전트 추가, P13(읽기 전용), **P17: 조건부 쓰기**.
- 근거: Copilot, Anthropic 스토어, Claude Code 서브에이전트 메모리, Devin Bot, Deep Agents.

### 6.3 우선순위

1. **N1 모델 주도 메모리.** 현재 제품 대부분이 이 방식이고, F·N5·N6이 모두 도구 호출 루프(P6)에 기대기 때문이다. 이것이 없으면 우리 앱의 파일 메모리는 실제 제품의 근사로 남는다.
2. **N2 컴팩션 강화.** 두 주요 API가 서버 기능으로 제공할 만큼 표준이 됐고 새 저장소 없이 B를 확장하면 된다. 컴팩션 직전 훅은 다른 모든 메모리 모듈의 가치를 높인다.
3. **N3 출처·신뢰 메타데이터.** 비용이 낮고(필드 추가와 필터) 뒤의 N4, N7이 이것을 전제로 한다. 외부 도구를 쓰는 에이전트에서 메모리 오염은 한 번 들어가면 이후 세션에 계속 남는 문제다.
4. **N4 백그라운드 통합 개정.** 2026년에 가장 많은 제품이 새로 낸 기능이다. 기존 H에 "전사 입력"과 "별도 사본 출력"을 더하는 변경이다.
5. **N5 스킬 모듈.** 흐름은 분명하지만 승인 흐름과 UI가 필요해 비용이 크다.
6. **N6 세션 기록 검색.** P14를 N4와 공유하므로 N4 뒤에 싸게 얻는다.
7. **N7 공유·범위.** 다중 사용자 요구가 생길 때 한다.

G(시간 그래프)에 대한 추가 투자는 권하지 않는다. D는 추가 전용 변형을 기본값으로 바꾸는 정도면 된다.

## 7. 확인하지 못한 것과 출처가 엇갈리는 것

**접근 실패**

- OpenAI 도움말(`help.openai.com`의 ChatGPT 릴리스 노트와 메모리 FAQ)이 403이었다. ChatGPT의 2026년 변화(dreaming, 메모리 출처, 용량 2배, 프로젝트 전용 메모리)는 전부 2차 자료다. OpenAI의 "Dreaming" 블로그 글 원문도 열지 못했다.
- `jules.google/docs/memory`와 `cursor.com/docs/agent-sdk/reference/memory.md`는 404였다.
- OWASP 문서의 랜딩 페이지에는 ASI06의 이름과 설명이 없었다. 본문 PDF는 받지 않았다.
- Claude Code 문서의 변경 이력 페이지는 1.3MB라 앞부분만 읽혔다. 대신 GitHub의 원본 CHANGELOG.md를 받아 메모리 관련 줄을 걸러 읽었다. 걸러내는 과정에서 놓친 항목이 있을 수 있다.

**내부 비공개**

- ChatGPT, Gemini 앱, Manus, Poke, Pickle, Vooy의 메모리 내부 구조.
- Claude 앱에서 메모리가 새 대화에 어떻게 들어가는지(전부 주입인지 검색인지).
- Codex의 전역 통합 단계가 구체적으로 무엇을 하는지.
- Copilot dreaming의 실행 주기.

**문서에 없어 추론으로 남긴 것**

- Claude Code의 "memory recall"이 별도 모델 호출로 주제 파일을 고른다는 것, "auto-memory extraction"이 별도 추출 단계라는 것. 변경 이력의 버그 수정 문구에서 추론했다.
- Claude Code의 팀 메모리 스토어(`CLAUDE_MEMORY_STORES`). 변경 이력에 한 줄만 있다.
- Claude Code "auto dream"은 2차 기사에만 있다.
- Windsurf Cascade의 자동 생성 메모리가 Devin Desktop으로 넘어온 뒤에도 남아 있는지.

**출처가 엇갈리는 것**

- Copilot Memory의 기본 상태. GitHub 블로그(2026-11-12 수정본)는 "off by default, opt-in"으로 읽히는데, 문서는 Pro/Pro+/Max에서 사용자 선호가 기본 켜짐이고 저장소 사실은 제한이 없으면 기본 허용이라고 적는다. 요금제별 차이일 수 있다. 문서 쪽을 따랐다.
- Mem0의 자사 수치가 페이지마다 다르다(LoCoMo 92.5 대 91.6, LongMemEval 94.4 대 93.4).
- Zep과 Mem0가 서로의 LoCoMo 점수를 다르게 보고한다(Zep 65.99% 대 75.14%).
- Claude 앱 메모리에 대해 2차 자료는 "24시간마다 합성"이라고 쓰는데 현재 공식 문서는 그것을 구형 방식이라고 한다. 전환 날짜는 찾지 못했다.
- Hermes Agent의 버전 번호와 날짜가 2차 집계 사이트마다 다르다. GitHub 릴리스 페이지의 v0.23.0(2026-11-05)만 사용했다.

**조사하지 않은 것**

- LangMem과 LangGraph Store의 2026년 변경, Zep/Graphiti의 현재 제품 상태, Limitless와 Omi 같은 라이프로그 계열의 변화.
- BEAM, MemoryArena, AMA-Bench, ACE는 초록과 검색 요약 수준으로만 읽었다. 표의 수치와 주장을 본문에서 대조하지 않았다.
- LoCoMo 감사(Penfield Labs)는 원문을 열지 않았다.
- 자사 평가 수치(Copilot 병합률, Mem0 점수, Letta 74.0%, ACE 향상 폭)의 독립 검증 여부.
- 요약 모델을 거쳐 읽은 페이지의 인용문은 원문과 글자 단위로 대조하지 않았다.
