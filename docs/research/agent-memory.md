# AI 에이전트 메모리 구현 방식 조사

- 조사일: 2026-11-18
- 목적: LLM 노드에 붙였다 뗄 수 있는 "메모리 모듈"(블록)로 어떤 메모리 종류를 제공할지 결정하기 위한 자료. 각 종류를 **읽기 경로**(LLM 호출 전에 프롬프트로 끌어오는 것)와 **쓰기 경로**(호출 후 저장하는 것)의 단계로 분해했다.
- 출처 표기: 표시가 없으면 1차 출처(공식 문서, 소스 코드, 논문, 자사 엔지니어링 블로그)를 직접 열어 확인한 내용이다. `[2차]`는 2차 자료에서만 확인한 것, `[추론]`은 출처에 없고 조사자가 추론한 것, `[미확인]`은 확인하지 못한 것이다.
- 맨 끝 "확인하지 못한 것"에 한계를 모아 두었다.

## 0. 먼저 읽을 결론

1. 메모리 구현은 종류가 많아 보이지만 기계적으로는 네 가지 축의 조합이다. (a) 무엇을 저장하나: 원문 턴 / 요약 / 추출한 사실 / 그래프. (b) 언제 쓰나: 매 턴 동기(hot path) / 임계치 도달 시 / 백그라운드. (c) 어떻게 읽나: 항상 주입 / 검색 후 주입 / 에이전트가 도구로 직접 열람. (d) 갱신 방식: 추가만 / 덮어쓰기 / LLM이 ADD·UPDATE·DELETE 판정 / 무효화 표시.
2. 사용자가 예로 든 **pickle**과 **Vooy**는 둘 다 실제 제품으로 확인됐다. 둘 다 한국 시장의 메신저형 개인 AI 에이전트다(5.1절). 다만 두 회사 모두 메모리의 내부 구조는 공개하지 않았다. "기억이 있다, 사용자가 보고 고칠 수 있다, 서버에 저장한다" 수준만 공개돼 있다.
3. 수개월~수년을 버티는 상시 에이전트 중 내부를 공개한 곳(OpenClaw, Hermes Agent, Letta, Claude Code)은 공통 구조를 가진다. **작고 항상 주입되는 큐레이션 파일 + 크고 검색으로만 꺼내는 원본 로그 + 컴팩션 직전 저장 + 주기적 백그라운드 통합**이다(5.2절).
4. 추천 후보 8개는 7절에 있다. 이 앱의 기존 노드로 대부분 표현되지만 새 기본 요소 세 가지가 필요하다: 대화를 넘어 유지되는 저장소 노드, 메모리용 색인 쓰기 노드, 백그라운드/예약 트리거.

## 1. 전체 비교표

"턴당 추가 비용"은 메인 LLM 호출 외에 드는 호출 수다. 출처에 수치가 없는 칸은 메커니즘에서 계산한 값이다 `[추론]`.

| # | 종류 | 저장하는 것 | 쓰기 경로(언제/어디에) | 읽기 경로 | 턴당 추가 비용 | 맞는 기간 | 대표 출처 |
|---|---|---|---|---|---|---|---|
| 1 | 전체 대화 버퍼 | 원문 턴 전부 | 매 턴 끝에 목록에 추가 | 전부 프롬프트에 삽입 | 0 (입력 토큰만 계속 증가) | 한 세션 | LangChain `ConversationBufferMemory`, OpenAI Agents SDK 세션 |
| 2 | 슬라이딩 윈도우(턴/토큰) | 원문 턴 전부(잘라내는 건 읽을 때) | 매 턴 추가 | 최근 k턴 또는 토큰 한도까지만 삽입 | 0 | 한 세션 | LangChain `ConversationBufferWindowMemory`/`ConversationTokenBufferMemory`, Dify `TokenBufferMemory` |
| 3 | 누적 요약 | 요약문 1개 | 매 턴 LLM이 (기존 요약 + 새 턴) → 새 요약 | 요약문 삽입 | LLM 1회 | 한 세션(길게) | LangChain `ConversationSummaryMemory` |
| 4 | 요약+버퍼 하이브리드 / 컴팩션 | 요약문 + 최근 원문 | 토큰 한도를 넘을 때만 오래된 턴을 요약에 접어 넣음 | 요약 + 최근 원문 삽입 | 평소 0, 한도 초과 시 LLM 1회 | 한 세션(매우 길게) | LangChain `ConversationSummaryBufferMemory`, MemGPT FIFO 큐, Claude API 컴팩션 |
| 5 | 과거 턴 벡터 검색 | 턴(또는 청크) + 임베딩 | 매 턴 문서로 색인 | 현재 입력으로 top-k 검색 후 삽입 | 임베딩 2회(쓰기 1, 읽기 1) | 세션 간 | LangChain `VectorStoreRetrieverMemory`, MemGPT recall/archival |
| 6 | 엔티티 메모리 | 엔티티별 요약 문단 | 매 턴 엔티티마다 LLM이 요약 갱신 | LLM이 현재 입력에서 엔티티 추출 → 해당 요약 조회 | LLM 1 + 엔티티 수 | 세션 간 | LangChain `ConversationEntityMemory` |
| 7 | 지식 그래프 메모리(단순) | (주어, 관계, 목적어) 트리플 | 매 턴 LLM이 트리플 추출 → 그래프에 추가 | LLM이 엔티티 추출 → 그 엔티티의 트리플 조회 | LLM 2회 | 세션 간 | LangChain `ConversationKGMemory` |
| 8 | 코어 메모리 블록(자기 편집) | 글자 수 제한이 있는 이름 붙은 텍스트 블록 | 에이전트가 도구 호출로 직접 수정(hot path) | 항상 프롬프트 앞에 고정 | 0~수회(도구 호출 턴) | 세션 간~수개월 | MemGPT/Letta, Hermes `MEMORY.md`/`USER.md` |
| 9 | 프로필(단일 문서) | JSON/텍스트 문서 1개 | LLM이 기존 프로필 + 대화 → 갱신본 | 항상 삽입 | LLM 1회(백그라운드면 턴 비용 0) | 세션 간~수개월 | LangGraph/LangMem profile, ChatGPT 저장된 메모리 |
| 10 | 사실 추출 + 통합(컬렉션) | 한 줄짜리 사실 다수 + 임베딩 | LLM이 후보 사실 추출 → 유사 기억 검색 → LLM이 ADD/UPDATE/DELETE/NOOP 판정 | 질의로 top-k 사실 검색 후 삽입 | LLM 2회 이상 + 임베딩 | 수개월~수년 | Mem0, LangMem collection |
| 11 | 메모리 스트림 + 반성 | 타임스탬프·중요도가 붙은 관찰/반성/계획 | 관찰마다 중요도 점수(LLM) 저장, 중요도 합이 임계치를 넘으면 반성 생성 | 최신성×중요도×관련성 점수 상위 삽입 | LLM 1(중요도) + 임베딩, 반성 시 LLM 여러 회 | 수개월 | Generative Agents |
| 12 | 연결된 노트(Zettelkasten) | 키워드·태그·맥락·링크가 붙은 노트 | LLM이 노트 생성 → 가까운 노트 top-k → LLM이 링크 결정, 이웃 노트 갱신 | top-k 노트(+링크된 노트) | LLM 2~3회 + 임베딩 | 수개월 | A-MEM |
| 13 | 시간 지식 그래프 | 에피소드/엔티티/사실 엣지(유효 구간 4개 타임스탬프)/커뮤니티 | 엔티티·사실 추출, 중복 해소, 모순 엣지 무효화 | 코사인+BM25+그래프 탐색 → 재순위 → 텍스트 구성 | LLM 여러 회 + 임베딩 | 수개월~수년 | Zep/Graphiti, Mem0 그래프 변형 |
| 14 | 파일 메모리(인덱스 + 주제 파일) | 마크다운 파일 디렉터리 | 에이전트가 파일 도구로 생성/수정 | 인덱스는 항상 로드, 주제 파일은 필요할 때 열람 | 0~수회(도구 호출 턴) | 수개월~수년 | Anthropic 메모리 도구, Claude Code 자동 메모리, OpenClaw, Manus |
| 15 | 백그라운드 통합(sleep-time/dreaming) | 위 8·10·14의 저장소를 다듬음 | 메인 대화 밖에서 예약 또는 N스텝마다 별도 에이전트가 정리·승격·병합 | (자체 읽기 경로 없음, 대상 저장소의 읽기 경로를 따름) | 턴 비용 0, 백그라운드 비용 큼 | 수개월~수년 | Letta sleep-time, OpenClaw dreaming, LangMem background |
| 16 | 라이프로그 파이프라인 | 상시 녹음/화면 → 전사 → 구조화 요약 → 사실 | 캡처 → 전사 → 대화 단위 요약·메타데이터 추출 → 벡터 색인 | 날짜 필터 + 의미 검색 도구 | 캡처 단위당 LLM 여러 회 | 수년 | Omi, Limitless |
| 17 | 절차 메모리(스킬/프롬프트) | 지시문·스킬 파일 | 피드백을 반영해 프롬프트/스킬을 고쳐 씀 | 시스템 프롬프트에 포함, 스킬은 관련 있을 때만 로드 | 턴 비용 0, 갱신 시 LLM | 수개월~수년 | CoALA, LangMem 프롬프트 최적화, Hermes 스킬 |

## 2. 분류 틀: CoALA

CoALA 논문은 에이전트 메모리를 네 가지로 나눈다. 아래 인용은 논문 4.1절이다(<https://arxiv.org/html/2309.02427>).

- 작업 기억(working): "Working memory maintains active and readily available information as symbolic variables for the current decision cycle."
- 일화 기억(episodic): "Episodic memory stores experience from earlier decision cycles."
- 의미 기억(semantic): "Semantic memory stores an agent's knowledge about the world and itself."
- 절차 기억(procedural): LLM 가중치에 든 암묵적 지식과 에이전트 코드라는 명시적 형태 두 가지.

행동은 검색(장기 기억 → 작업 기억으로 읽기), 추론(작업 기억 안에서 읽고 쓰기), 학습(장기 기억에 쓰기), 그라운딩(외부 행동)으로 나눈다.

LangGraph 문서는 이 틀을 그대로 가져와 구현 방법과 연결한다(<https://docs.langchain.com/oss/python/langgraph/memory>).

| 종류 | 저장 대상 | 구현 |
|---|---|---|
| 의미 | 사실 | 프로필(단일 JSON 문서) 또는 컬렉션(개별 문서 다수) |
| 일화 | 과거 경험 | 과거 사례를 few-shot 예시로 검색해 삽입 |
| 절차 | 규칙·지시 | 에이전트가 자신의 프롬프트를 고쳐 씀 |

같은 문서가 쓰기 시점을 두 가지로 나눈다. **hot path**는 실행 중에 쓰는 방식으로, 즉시 반영되지만 지연이 늘고 에이전트의 주의가 분산된다. **background**는 별도 비동기 작업으로 쓰는 방식으로, 지연이 없지만 언제 실행할지 정해야 한다. 흔한 트리거는 시간 지연, 크론, 수동 실행이다.

이 문서의 1절 표를 이 틀에 놓으면 1~4번은 작업 기억 관리, 5·11·16번은 일화, 6~10·12·13번은 의미, 17번은 절차, 14번은 저장 매체(무엇이든 담을 수 있음), 15번은 쓰기 시점에 대한 선택이다 `[추론]`.

## 3. 고전 구현

LangChain의 레거시 메모리 클래스가 기준 구현이다. `langchain_classic/memory/__init__.py`가 내보내는 클래스 목록은 `ConversationBufferMemory`, `ConversationBufferWindowMemory`, `ConversationTokenBufferMemory`, `ConversationSummaryMemory`, `ConversationSummaryBufferMemory`, `ConversationEntityMemory`, `ConversationKGMemory`, `VectorStoreRetrieverMemory`, `ConversationVectorStoreTokenBufferMemory`, `CombinedMemory` 등이다(<https://github.com/langchain-ai/langchain/blob/master/libs/langchain/langchain_classic/memory/__init__.py>). 열어 본 클래스는 모두 0.3.1부터 사용 중단(deprecated) 표시가 붙어 있고, 대체로 체크포인팅이나 `Store` API를 쓰라고 안내한다. 즉 지금은 "참고 구현"이지 권장 API가 아니다.

모든 클래스가 같은 두 메서드를 가진다. `load_memory_variables`가 읽기 경로, `save_context`가 쓰기 경로다. 이 앱의 블록 구조(읽기 경로 노드 + 쓰기 경로 노드)와 그대로 대응한다.

### 3.1 전체 대화 버퍼

- 읽기: (1) 저장된 메시지 전부를 가져온다. (2) 메시지 목록 또는 "Human: … / AI: …" 문자열로 프롬프트에 넣는다.
- 쓰기: (1) 이번 턴의 사용자 입력과 응답을 목록 끝에 추가한다.
- 같은 구조: OpenAI Agents SDK 세션. 실행 전에 "The runner automatically retrieves the conversation history for the session and prepends it to the input items", 실행 후 새 항목을 세션에 저장한다(<https://openai.github.io/openai-agents-python/sessions/>). 저장 백엔드는 SQLite, Redis, SQLAlchemy, OpenAI Conversations API 등이다.
- 실패 양상: 토큰이 턴마다 늘어 결국 컨텍스트 한도를 넘는다. 한도 안이라도 길어질수록 회상 정확도가 떨어진다. Anthropic은 이를 context rot이라 부르고 컨텍스트를 "a finite resource with diminishing marginal returns"로 다루라고 한다(<https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>).

### 3.2 슬라이딩 윈도우

턴 기준과 토큰 기준 두 가지다.

- 턴 기준 읽기: (1) 메시지 목록에서 `messages[-k*2:]`를 자른다(k 기본값 5, 한 턴이 메시지 2개). (2) 삽입한다. 출처: <https://github.com/langchain-ai/langchain/blob/master/libs/langchain/langchain_classic/memory/buffer_window.py>
- 토큰 기준 쓰기: (1) 턴을 추가한다. (2) 버퍼 토큰 수를 센다. (3) `max_token_limit`(기본 2000)을 넘는 동안 가장 오래된 메시지를 `pop(0)` 한다. 잘린 메시지는 버려진다. 출처: <https://github.com/langchain-ai/langchain/blob/master/libs/langchain/langchain_classic/memory/token_buffer.py>
- OpenAI Agents SDK는 `SessionSettings(limit=N)`으로 최근 N개 항목만 가져온다(위 세션 문서).
- Dify: 3.8절 참고.
- 실패 양상: 윈도우 밖의 내용은 흔적 없이 사라진다. 사용자가 20턴 전에 말한 제약을 잊는다. 턴 기준은 긴 메시지 하나로 한도를 넘을 수 있고, 토큰 기준은 사용자 메시지와 응답 쌍을 가운데서 끊을 수 있다 `[추론]`.

### 3.3 누적 요약

- 읽기: (1) 요약문(`buffer`)을 시스템 메시지 또는 문자열로 삽입한다.
- 쓰기: (1) 턴을 저장한다. (2) **가장 최근 메시지 2개**와 기존 요약을 요약 LLM에 넣는다(`predict_new_summary`). (3) 결과로 요약을 덮어쓴다.
- 출처: <https://github.com/langchain-ai/langchain/blob/master/libs/langchain/langchain_classic/memory/summary.py>
- 실패 양상: 매 턴 LLM 호출이 하나 더 든다. 요약을 요약하는 과정이 반복돼 세부(숫자, 고유명사, 정확한 문구)가 점차 사라지고, 한 번 틀리게 요약된 내용은 이후 계속 남는다 `[추론]`.

### 3.4 요약 + 버퍼 하이브리드

- 읽기: (1) 요약문이 있으면 맨 앞에 요약 메시지로 넣는다. (2) 그 뒤에 버퍼의 최근 원문 메시지를 붙인다.
- 쓰기: (1) 턴을 저장한다. (2) 버퍼 토큰 수를 센다. (3) `max_token_limit`(기본 2000)을 넘으면 가장 오래된 메시지부터 꺼내 `pruned_memory`에 모은다. (4) `moving_summary_buffer = predict_new_summary(pruned_memory, moving_summary_buffer)`로 요약에 접어 넣는다.
- 출처: <https://github.com/langchain-ai/langchain/blob/master/libs/langchain/langchain_classic/memory/summary_buffer.py>
- 3.3과의 차이: 요약 LLM 호출이 매 턴이 아니라 한도를 넘을 때만 일어나고, 최근 턴은 원문 그대로 남는다.
- 같은 계열: MemGPT의 FIFO 큐(4.1절)와 벤더의 컴팩션(6.6절)이 이 구조다.
- 실패 양상: 3.3과 같은 요약 손실이 오래된 부분에 생긴다. Anthropic은 "The art of compaction lies in the selection of what to keep versus what to discard"라고 하며 과도한 컴팩션이 나중에 필요한 세부를 잃게 한다고 경고한다(위 context engineering 글).

### 3.5 과거 턴 벡터 검색

- 읽기: (1) 현재 입력을 질의로 쓴다. (2) `retriever.invoke(query)`로 유사 문서를 가져온다. (3) 문서 본문을 줄바꿈으로 이어 삽입한다.
- 쓰기: (1) 이번 턴의 입력과 출력을 `키: 값` 줄로 이어 붙여 문서 하나를 만든다. (2) `retriever.add_documents`로 색인한다. 검색해 온 과거 기록(`history` 키)은 다시 저장하지 않도록 제외한다.
- 출처: <https://github.com/langchain-ai/langchain/blob/master/libs/langchain/langchain_classic/memory/vectorstore.py>
- 실패 양상: 이 클래스의 `clear`는 아무 일도 하지 않는다(저장된 문서를 지울 방법이 없음, 위 소스). 유사도만 보므로 최신 정보와 낡은 정보가 함께 올라오고, 모순되는 두 진술 중 어느 쪽이 현재 사실인지 알 수 없다. 대명사나 "아까 그거" 같은 입력은 검색 질의로 약하다 `[추론]`.

### 3.6 엔티티 메모리

- 읽기: (1) 최근 k쌍(기본 3)의 메시지와 현재 입력을 LLM에 넣어 엔티티 이름을 쉼표로 구분해 받는다(없으면 "NONE"). (2) 각 엔티티의 요약을 `entity_store`에서 조회한다(없으면 빈 문자열). (3) 추출한 이름을 `entity_cache`에 둔다. (4) 최근 대화 + `entities` 사전을 반환한다.
- 쓰기: (1) 턴을 저장한다. (2) `entity_cache`의 엔티티마다 (기존 요약, 엔티티 이름, 최근 대화, 입력)을 요약 LLM에 넣는다. (3) 결과를 `entity_store.set`으로 저장한다.
- 저장소: 인메모리(기본), Redis(기본 TTL 1일, 읽으면 3일 연장), SQLite, Upstash.
- 출처: <https://github.com/langchain-ai/langchain/blob/master/libs/langchain/langchain_classic/memory/entity.py>
- 실패 양상: 엔티티 수만큼 LLM 호출이 는다. 같은 대상을 다른 표기로 부르면 다른 엔티티가 된다(중복 해소 단계가 없음). 엔티티에 붙지 않는 정보(절차, 선호의 이유)는 담을 곳이 없다 `[추론]`.

### 3.7 지식 그래프 메모리(단순)

- 읽기: (1) 최근 `k*2`개(k 기본 2) 메시지와 입력으로 LLM이 엔티티를 추출한다. (2) 엔티티마다 `kg.get_entity_knowledge(entity)`로 저장된 사실을 가져온다. (3) "On {entity}: …" 형식의 줄로 만들어 삽입한다.
- 쓰기: (1) 턴을 저장한다. (2) LLM이 지식 트리플을 추출한다. (3) 트리플마다 `kg.add_triple`로 그래프(`NetworkxEntityGraph`)에 추가한다.
- 출처: <https://github.com/langchain-ai/langchain-community/blob/main/libs/community/langchain_community/memory/kg.py>
- 실패 양상: 추가만 하고 갱신·무효화가 없다. "서울에 산다"와 "부산으로 이사했다"가 둘 다 남는다. 이 한계를 다룬 것이 4.4절의 시간 지식 그래프다 `[추론]`.

### 3.8 Dify의 메모리

- LLM 노드의 Memory 옵션: Chatflow 대화 안에서 이전 교환을 뒤 프롬프트에 넣는다. 문서 표현은 "previous interactions will be included in subsequent prompts as formatted user - assistant outputs"다(<https://docs.dify.ai/en/guides/workflow/node/llm>). 대화 간에는 이어지지 않는다.
- 내부 구현은 `TokenBufferMemory`다. 해당 대화의 `Message` 행을 최신순으로 읽고, 개수는 `min(message_limit, 500)`으로 제한하며(값이 없으면 500), 토큰이 `max_token_limit`(기본 2000)을 넘는 동안 가장 오래된 메시지를 `pop(0)` 한다. 출처: <https://github.com/langgenius/dify/blob/main/api/core/memory/token_buffer_memory.py>
- 즉 Dify의 "메모리"는 1절 표의 2번(슬라이딩 윈도우)뿐이다. 요약도 추출도 없다.
- 창 크기(window size) 설정: 이 저장소의 `src/lib/engine/nodes/llm.ts`가 `memory.window.size`를 읽어 `history.slice(-size * 2)`로 구현하고 있다. Dify 본체의 `MemoryConfig` 정의는 `graphon` 패키지로 옮겨져 이번 조사에서 원문을 열지 못했다 `[미확인]`.
- 대화 변수(conversation variables) + Variable Assigner 노드: 같은 대화 세션의 턴 사이에 값이 유지된다. 쓰기 모드는 타입별로 덮어쓰기, 지우기, 고정값 설정, 배열의 추가(append)/확장(extend)/앞뒤 제거 등이다. 문서의 예시가 바로 메모리다. 사용자 입력에서 기억할 사실을 추출해 `memories` 배열에 append 하고 이후 응답에서 참조한다(<https://docs.dify.ai/en/guides/workflow/node/variable-assigner>).
- 의미: Dify에서는 윈도우 외의 메모리를 사용자가 "추출 노드 + 대화 변수 쓰기"로 직접 조립한다. 다만 범위가 대화 하나다. 대화를 넘는 장기 기억은 Dify 기본 요소에 없다.

## 4. 연구·에이전트 시스템 설계

### 4.1 MemGPT / Letta

논문(<https://arxiv.org/html/2310.08560>)의 구조:

- 메인 컨텍스트(프롬프트 안): 시스템 지시(읽기 전용), 작업 컨텍스트("a fixed-size read/write block of unstructured text"), FIFO 큐(메시지 이력). 큐의 첫 칸에는 밀려난 메시지들의 재귀 요약이 들어간다.
- 외부 컨텍스트(프롬프트 밖): recall 저장소(전체 메시지 이력), archival 저장소("a read/write database storing arbitrary length text objects").

읽기 경로:
1. 시스템 지시 + 작업 컨텍스트(코어 메모리) + 재귀 요약 + FIFO 큐를 그대로 프롬프트로 만든다.
2. 더 필요하면 에이전트가 함수 호출로 recall/archival을 검색하고, 결과가 큐에 들어온다.
3. `request_heartbeat=true`를 붙이면 사용자 입력을 기다리지 않고 다음 추론을 이어 간다(검색 → 다시 검색 → 답변).

쓰기 경로:
1. 에이전트가 함수 호출로 작업 컨텍스트를 고치거나 archival에 쓴다. "Memory edits and retrieval are entirely self-directed."
2. 큐가 경고 임계치(예: 컨텍스트의 70%)에 닿으면 큐 관리자가 "곧 밀려난다"는 시스템 메시지를 넣는다. 에이전트는 이때 중요한 내용을 저장할 기회를 얻는다.
3. 플러시 임계치(예: 100%)에 닿으면 메시지 일부(예: 50%)를 밀어내고, 기존 재귀 요약 + 밀려난 메시지로 새 재귀 요약을 만든다.
4. 밀려난 메시지는 recall 저장소에 무기한 남는다.

Letta(제품)에서는 작업 컨텍스트가 **메모리 블록**이 됐다. 블록은 `label`, `description`, `value`, `limit`(글자 수)을 가지며 프롬프트 앞에 고정된다. 블록 설명이 에이전트가 그 블록을 언제 읽고 쓸지 판단하는 주된 정보다. `read_only`로 잠글 수 있고 여러 에이전트가 같은 블록을 공유할 수 있다(<https://docs.letta.com/guides/agents/memory-blocks>).

**Sleep-time 에이전트**: Letta 블로그는 원래 MemGPT의 문제를 "memory management, conversation, and other tasks are all bundled into a single agent"로 짚는다. 해결은 에이전트를 둘로 나누는 것이다. 주 에이전트는 코어 메모리 편집 도구를 갖지 않고("is not provided with tools to edit its core memory") 대화·도구·recall/archival 검색만 한다. sleep-time 에이전트가 백그라운드에서 주 에이전트의 메모리 블록을 고쳐 쓴다. 실행 빈도는 설정값이며 높일수록 토큰을 더 쓴다(<https://www.letta.com/blog/sleep-time-compute>). 논문은 같은 정확도에 필요한 테스트 시점 연산을 약 5배 줄였다고 보고한다(<https://arxiv.org/abs/2504.13171>).

현재 Letta Code 문서는 이를 **dreaming**이라 부른다. "Dreaming uses background subagents to review recent conversations, consolidate useful lessons, and update memory." 실행 시점은 "after a set number of completed agent steps or when the context window is compacted"이다. 저장 매체는 MemFS, 즉 git으로 관리되는 메모리 파일 시스템이다(<https://docs.letta.com/letta-code/memory>).

실패 양상:
- hot path 자기 편집은 대화와 메모리 관리를 한 모델이 같이 해서 느리고 불안정해진다(Letta 블로그의 자기 진단).
- 블록에 글자 수 한도가 있어 가득 차면 무엇을 버릴지 모델이 정해야 한다 `[추론]`.
- 경고 시점에 저장하지 않은 내용은 재귀 요약에만 남는다 `[추론]`.

### 4.2 Generative Agents

출처: <https://ar5iv.labs.arxiv.org/html/2304.03442>

저장: 메모리 스트림. "a list of memory objects, where each object contains a natural language description, a creation timestamp"와 최근 접근 시각. 관찰, 반성, 계획이 모두 같은 스트림에 들어간다.

읽기 경로:
1. 현재 상황을 질의로 삼는다.
2. 기억마다 세 점수를 구한다. 최신성은 마지막으로 검색된 뒤 지난 (게임 내) 시간에 대한 지수 감쇠이고 감쇠 계수는 0.995다. 중요도는 저장 시점에 LLM이 1~10으로 매긴 값이다. 관련성은 질의 임베딩과 기억 임베딩의 코사인 유사도다.
3. 세 점수를 min-max로 [0,1]에 정규화하고 가중합한다(구현에서 가중치는 모두 1).
4. 컨텍스트에 들어가는 만큼 상위 기억을 삽입한다.

쓰기 경로:
1. 새 관찰이 생기면 LLM에 "On the scale of 1 to 10, where 1 is purely mundane…"으로 중요도를 묻고, 임베딩과 함께 스트림에 추가한다.
2. 최근 사건의 중요도 합이 임계치(구현값 150)를 넘으면 반성을 시작한다. 에이전트는 하루에 두세 번 반성했다.
3. 반성: 최근 기록 100개를 LLM에 주고 "가장 두드러진 상위 수준 질문 3개"를 받는다.
4. 각 질문으로 스트림을 검색한다(다른 반성도 검색 대상).
5. LLM에 "상위 수준 통찰 5개"를 근거 기록 번호와 함께 받는다.
6. 통찰을 근거 기록에 대한 포인터와 함께 반성으로 저장한다. 반성이 반성을 인용해 트리가 된다.

실패 양상: 관찰마다 LLM 호출 1회가 든다. 반성이 틀리면 그 반성이 높은 중요도로 계속 검색된다. 스트림은 추가만 되고 삭제나 정정이 없다 `[추론]`.

### 4.3 Mem0

출처: <https://arxiv.org/html/2504.19413>

쓰기 경로(2단계):
1. 추출: (대화 요약 S, 최근 메시지 m개, 새 메시지 쌍)을 LLM에 넣어 후보 사실을 뽑는다. 실험값 m=10. 대화 요약은 비동기 모듈이 주기적으로 갱신하므로 이 단계를 늦추지 않는다.
2. 갱신: 후보 사실마다 임베딩으로 유사한 기존 기억 상위 s개를 가져온다(실험값 s=10).
3. LLM이 함수 호출로 넷 중 하나를 고른다. ADD(대응하는 기억이 없으면 새로 생성), UPDATE(기존 기억을 보완), DELETE(새 정보와 모순되는 기억 제거), NOOP(변경 없음).
4. 판정대로 저장소를 고친다.

읽기 경로:
1. 질의를 임베딩해 유사한 사실을 검색한다.
2. 상위 사실을 프롬프트에 넣는다.

그래프 변형(Mem0g): 엔티티 추출기 → 관계 생성기로 트리플을 만들고, 충돌 감지 후 LLM 기반 갱신 해소기가 낡은 관계를 "marking them as invalid rather than physically removing them to enable temporal reasoning" 처리한다. 저장은 Neo4j. 읽기는 두 가지다. 질의에서 핵심 엔티티를 찾아 그 노드의 들어오고 나가는 관계를 탐색하는 방법과, 질의 임베딩을 트리플 인코딩과 맞춰 임계치를 넘는 것만 반환하는 방법.

논문이 보고한 수치: 전체 컨텍스트 방식 대비 p95 지연 91% 감소, 토큰 비용 90% 이상 절감(<https://arxiv.org/abs/2504.19413>). 자사 논문의 자사 벤치마크 수치다.

LangMem의 컬렉션 메모리 매니저가 같은 구조다. 대화와 현재 메모리 상태를 받아 LLM이 "Extract new memories, update or remove outdated memories, and consolidate and generalize from existing memories"를 수행한다(<https://langchain-ai.github.io/langmem/concepts/conceptual_guide/>).

실패 양상:
- LangGraph 문서: 컬렉션은 모델이 기존 항목을 갱신·삭제해야 하고 목록 검색이 복잡해진다. 프로필은 커질수록 통째 갱신이 오류에 취약하다(2절 출처).
- 추출 LLM이 놓친 사실은 영영 없다. DELETE 판정이 틀리면 맞는 기억이 사라진다 `[추론]`.
- 원문을 버리므로 "정확히 뭐라고 했지"에 답하지 못한다 `[추론]`.

### 4.4 Zep / Graphiti

출처: <https://arxiv.org/html/2501.13956>

저장: 세 층의 그래프. "an episode subgraph, a semantic entity subgraph, and a community subgraph". 에피소드는 원본 입력, 엔티티와 사실 엣지는 거기서 추출한 것, 커뮤니티는 엔티티 군집의 요약이다.

이중 시간 모델(bi-temporal): 엣지마다 타임스탬프가 넷이다. 둘은 사실이 실제로 참이었던 구간, 둘은 시스템이 그 사실을 기록하고 무효화한 시점이다. "이 사실이 언제부터 언제까지 참이었나"와 "시스템이 언제 그걸 알았나"를 따로 답할 수 있다.

쓰기 경로:
1. 새 메시지를 에피소드 노드로 저장한다.
2. 현재 메시지 + 직전 대화 맥락으로 LLM이 엔티티를 추출하고, 누락을 스스로 점검하는 반성 단계를 거친다.
3. 엔티티 이름을 임베딩해 기존 노드와 대조하고 같은 대상이면 합친다(엔티티 해소).
4. 엔티티 사이의 사실을 추출한다. 같은 엔티티 쌍 사이의 기존 엣지와만 대조해 중복을 제거한다.
5. 사실에서 시간 정보를 추출한다.
6. 새 엣지와 시간상 겹치면서 모순되는 기존 엣지를 무효화한다. 삭제하지 않고 무효 시점을 기록하며 새 정보를 우선한다.
7. 새 노드를 이웃의 다수 커뮤니티에 배정한다(라벨 전파). 주기적으로 전체를 다시 계산한다.

읽기 경로 f(α) = χ(ρ(φ(α))):
1. 검색 φ: 코사인 유사도, BM25 전문 검색, 그래프 너비 우선 탐색을 병렬로 돌린다.
2. 재순위 ρ: RRF, MMR, 에피소드 언급 빈도, 노드 거리, 크로스 인코더 중에서 고른다.
3. 구성 χ: 선택된 노드와 엣지를 텍스트 컨텍스트로 바꾼다.

실패 양상: 메시지 하나를 넣는 데 LLM 호출이 여러 번 든다. 엔티티 해소가 틀리면 다른 두 사람이 한 노드가 되거나 한 사람이 둘이 된다. 논문 스스로 커뮤니티는 주기적 전체 갱신이 필요하다고 적는다. 앞의 둘은 `[추론]`.

### 4.5 A-MEM

출처: <https://arxiv.org/html/2502.12110>

쓰기 경로:
1. 노트 생성: 원문 c와 타임스탬프 t에서 LLM이 키워드 K, 태그 G, 맥락 설명 X를 만든다. 전체 텍스트 요소를 임베딩해 e를 얻는다. 링크 집합 L은 비어 있다.
2. 링크 생성: 새 노트 임베딩과 코사인 유사도가 높은 기존 노트 top-k를 고른다. 이것은 1차 필터이고, LLM이 후보를 보고 어떤 연결을 만들지 정한다.
3. 메모리 진화: 가까운 기존 노트마다 LLM이 "whether to update its context, keywords, and tags"를 판단하고, 고친 노트가 원래 노트를 대체한다.

읽기 경로:
1. 질의를 같은 인코더로 임베딩한다.
2. 전체 노트와 코사인 유사도를 계산해 top-k를 반환한다.
3. 검색된 노트와 같은 묶음으로 링크된 노트도 함께 접근된다. 이 단계는 논문 그림 2의 설명에만 있고 3.4절 수식에는 없다.

실패 양상: 새 기억 하나가 여러 기존 노트를 고쳐 쓰므로 원래 맥락이 덮어써질 수 있다(변경 이력이 없음) `[추론]`.

### 4.6 MemoryBank (망각 곡선)

출처: <https://ar5iv.labs.arxiv.org/html/2305.10250>. 요청 목록에는 없었지만 계층 요약과 망각을 함께 다룬 1차 출처라 넣었다.

- 저장: 타임스탬프가 붙은 대화 원문 → 일별 사건 요약 → 전체 요약. "We condense verbose dialogues into a concise daily event summary, which is further synthesized into a global summary." 같은 방식으로 일별 성격 관찰 → 전체 사용자 초상.
- 읽기: 기억 조각을 인코더로 벡터화해 FAISS로 색인하고 현재 대화 맥락을 질의로 검색한다.
- 망각: 보존율 R = e^(-t/S). t는 경과 시간, S는 기억 강도다. S는 처음 등장할 때 1이고, 회상될 때마다 "We increase S by 1 and reset t to 0"로 강해진다.

## 5. 상시 실행·초장기 에이전트

### 5.1 "pickle"과 "Vooy" 식별 결과

둘 다 식별됐다. 요청 시 후보로 든 "Pickle 스마트 안경"과 "Poke/Voy/Vy의 오타"는 맞지 않았다. 사용자가 말한 것은 한국 시장의 두 메신저형 개인 에이전트로 보는 것이 가장 자연스럽다. 한국어 초대 코드 나눔 페이지가 "피클(Pickle) · 뮤즈 · 큐 · 채널X · 키링 · vooy · 두리"를 한 범주로 나열하고(<https://giving-tree-ai.deed.page/>) `[2차]`, 다른 기사는 vooy를 "피클과 비슷한 에이전트 메신저"로 부른다 `[2차, 검색 결과 요약으로만 확인]`.

**Pickle (피클, pickle.com)**

- 정체: Pickle, Inc.의 개인 AI 에이전트 앱. 사이트 제목은 "피클: 나만의 AI 에이전트", 설명은 "대신 작업을 수행하는 AI 에이전트"다(<https://pickle.com/>). YC 페이지는 "The personal AI agent network for Asia"로 소개하고 한국과 일본에서 시작한다고 적는다. 창업자는 Daniel Park 등, 2025년 겨울 배치(<https://www.ycombinator.com/companies/pickle-2>).
- 안경과의 관계: 2026년 1월에 "soul computer"라며 발표된 Pickle 1 AR 안경도 언론 보도상 같은 창업자(Daniel Park, YC W25)의 회사다 `[2차]`. YC 페이지에는 안경 언급이 없고 에이전트 네트워크만 있다. 같은 회사가 제품 방향을 바꾼 것으로 보이나 회사가 그렇게 밝힌 문서는 찾지 못했다 `[추론]`. 지금 pickle.com이 파는 것은 안경이 아니라 에이전트 앱이다.
- "상시 실행"의 실체: 작업이 휴대폰이 아니라 회사 클라우드에서 돈다. 자사 글의 표현은 "For Pickle to keep working while the app is closed, you have to give it, in advance, the permission it will use then"이다. 이 사전 권한(grant)은 1~30일 중 사용자가 고르고 앱을 쓰는 동안 갱신된다.
- 메모리에 대해 회사가 밝힌 것(자사 글 "How your Pickle protects your privacy", 2026-10-01, <https://www.pickle.com/research> 목록의 글. 사이트가 스크립트로 렌더링돼 페이지 대신 사이트의 스크립트 묶음에서 본문을 추출해 읽었고, 글의 개별 주소는 확인하지 못했다):
  - 목표: "We are building an AI that gets to know one person over a long time. Today's conversation becomes tomorrow's understanding."
  - 연결 계정에서 읽은 내용이 기억으로 남는다: "a travel itinerary read with those keys stays in Pickle's memory and is used in later tasks."
  - 저장 위치: 서버. 대화와 기억은 AWS가 관리하는 키로 저장 시 암호화되고, 답을 만들 때 필요한 부분이 모델 제공사로 전송된다.
  - 사용자 통제: "In the app, you can read and edit the memories Pickle has built up."
  - 공유: 친구나 친구의 Pickle과 대화하는 "clone"은 같은 기억을 쓰되 도구가 읽기와 대화로 제한되고, 사용자가 정한 공유 규칙이 상한이다.
  - 계정 연결을 끊어도 이미 대화에 나온 내용의 기억은 자동으로 지워지지 않는다.
- 공개하지 않은 것: 기억을 어떻게 추출·저장·검색·갱신·망각하는지. 벡터 검색인지 프로필 문서인지, 통합 작업이 있는지 알 수 없다 `[미확인]`.
- 한국 기사 한 건이 "대화 기록과 개인의 선호도를 장기 기억으로 축적"한다고 쓰지만 회사 발표를 옮긴 것이고 구조 설명은 없다(<https://www.hanbitdaily.com/news/481514>) `[2차]`.

**Vooy (부이, vooy.com)**

- 정체: Vooy Korea, Inc.(서울 강남구)의 일상 AI 에이전트. 이름은 "Virtual Oracle of You"의 약자다. 이미 쓰는 메신저에서 요청하며 검색·비교·예약을 처리한다(<https://vooy.com/>). 2026-09-28 EastPoint: Seoul 2026에서 CPO가 컨슈머 에이전트를 발표했다(<https://en.bloomingbit.io/feed/news/121127>) `[2차]`.
- 메모리에 대해 회사가 밝힌 것(개인정보 처리방침 2026-08-11판, <https://vooy.com/ko/docs/privacy/2026-08-11>):
  - 정의: "이용자의 명시적인 기억 요청 또는 대화에서 확인된 지속적인 선호·설정·관계·사실을 향후 응답에 반영하기 위해 정리한 정보". 즉 쓰기 계기가 둘이다. 사용자가 기억하라고 한 것, 대화에서 시스템이 알아낸 것.
  - 도구 결과의 처리: Google 데이터에서 나온 기억은 "원본 도구 결과가 아닌 해당 이용자만을 위한 정리된 파생 정보만" 보관한다. 원문이 아니라 추출한 사실을 저장한다는 뜻이다(1절 표의 9번 또는 10번 계열).
  - 보존: 대화 원문은 최대 90일, 기억은 사용자가 삭제를 요청하거나 탈퇴할 때까지. 원문보다 추출된 기억이 오래 남는 구조다.
  - 삭제: 대화에서 기억 삭제를 요청하거나 이메일로 요청.
  - 모델 호출은 OpenRouter를 거친다.
- 공개하지 않은 것: 기억의 갱신 방식, 검색 방식, 통합 주기. 엔지니어링 블로그(<https://blog.vooy.com/en>)에 글이 4편 있으나 메모리를 다룬 글은 없다. 가장 가까운 글은 도구 200개를 줬더니 성능이 나빠져 필요한 것만 불러오는 도구 검색을 만들었다는 글이다 `[미확인]`.
- 상시 실행 여부: 회사 페이지에 명시가 없다. 랜딩 페이지의 활동 예시("내일 출근 브리핑 준비")가 능동 동작을 시사할 뿐이다 `[추론]`.

두 제품에서 얻을 수 있는 설계 정보는 내부 구조가 아니라 **바깥에서 보이는 계약**이다. (1) 명시적 저장과 암묵적 추출을 둘 다 한다. (2) 원문 로그와 추출된 기억의 보존 기간이 다르다. (3) 사용자가 기억을 열람·수정·삭제할 수 있다. (4) 외부 도구에서 읽은 내용도 기억이 된다. (5) 제3자와 대화할 때 기억 공개 범위를 별도 규칙으로 제한한다.

### 5.2 내부를 공개한 상시 에이전트

**OpenClaw** (<https://docs.openclaw.ai/concepts/memory>)

저장 파일:
- `USER.md`: 안정적인 선호, 소통 방식, 관계, 진행 중 프로젝트. 바뀐 선호는 제자리에서 교체한다.
- `MEMORY.md`: 장기적이고 큐레이션된 사실과 결정. "not a raw transcript, daily log, or exhaustive archive."
- `memory/YYYY-MM-DD.md`: 일별 노트와 원시 작업 맥락. 검색용으로 색인되지만 매 턴 주입되지는 않는다.
- `DREAMS.md`: 통합 작업의 요약과 일지(사람이 검토하는 용도).

읽기 경로:
1. 세션 시작 시 `USER.md`와 `MEMORY.md`를 로드한다. 예산을 넘으면 디스크의 파일은 그대로 두고 주입본만 자른다.
2. 새 세션에서는 오늘과 어제의 일별 노트도 자동으로 로드한다.
3. 그 밖의 과거는 에이전트가 `memory_search`(의미 검색)와 `memory_get`(파일·줄 범위 읽기) 도구로 꺼낸다.
4. 검색은 벡터 유사도와 키워드 매칭을 병렬로 돌려 가중합한다. 최종 점수는 관련성 × 최신성 감쇠 × 중요도 배수이고, 날짜가 붙은 일별 노트의 반감기는 30일이다. `MEMORY.md`, `USER.md`, 날짜 없는 파일은 감쇠하지 않는다. MMR(λ 0.7)로 중복을 줄인다(<https://docs.openclaw.ai/concepts/memory-search>).

쓰기 경로:
1. 대화 중 에이전트가 파일을 직접 쓴다.
2. **컴팩션 직전 플러시**: 컴팩션이 대화를 요약하기 전에 조용한 턴 하나를 돌려 "save important context to durable memory" 하게 한다. 기본으로 켜져 있다. 이 턴에서는 일별 노트에 추가만 할 수 있다. 실패해도 컴팩션은 진행된다. 컴팩션은 컨텍스트의 75% 또는 (창 − 예약분) 중 작은 쪽에서 시작한다(<https://docs.openclaw.ai/concepts/compaction>).
3. **Dreaming**(백그라운드 통합, 기본 켜짐, 기본 크론 `0 3 * * *`): 세 단계를 순서대로 돈다(<https://docs.openclaw.ai/concepts/dreaming>).
   - Light: 최근 단기 회상 상태, 일별 노트, 세션 전사를 읽어 중복을 제거하고 후보를 올린다. `MEMORY.md`에는 쓰지 않는다.
   - REM: 최근 흔적에서 주제와 반성 요약을 만든다. 역시 `MEMORY.md`에 쓰지 않는다.
   - Deep: 유일하게 영구 쓰기를 하는 단계. 후보를 가중 점수(관련성 0.30, 빈도 0.24, 질의 다양성 0.15, 최신성 0.15, 통합 0.10, 개념 풍부도 0.06)로 매기고 `minScore`, `minRecallCount`, `minUniqueQueries` 세 관문을 모두 통과한 것만 남긴다. 그 뒤 도구 없는 LLM 호출 한 번이 현재 `MEMORY.md`에 대해 추가·병합·대체를 고른다. 결과가 기존 항목의 25%를 넘게 지우면 거부하고, 실패하면 추가만 하는 방식으로 되돌아간다.
4. 승격 기준이 "얼마나 자주, 얼마나 다양한 질의로 다시 꺼내졌나"라는 점이 특징이다. 저장 시점의 중요도 판단이 아니라 사용 실적으로 장기 기억을 정한다.

출처 추적과 삭제(<https://docs.openclaw.ai/concepts/memory-provenance>):
- 색인 청크, 항목, 파일 쓰기 세 수준에서 출처(어느 에이전트, 어느 세션)를 기록한다. 병합·대체 시 살아남는 항목이 부모의 출처를 물려받는데, 이는 모델이 아니라 코드가 한다.
- 신뢰: 소유자의 턴이 아니거나, 네트워크에서 온 도구 결과가 섞인 턴이거나, 파일 해시가 기록과 다르면 그 쓰기를 `untrusted`로 기록한다. untrusted가 된 `MEMORY.md`/`USER.md`는 자동 주입에서 빠지고, 신뢰는 자동으로 복구되지 않는다.
- 삭제: 세션을 "잊음"으로 기록해 재수집을 막고, 그 세션에서 나온 항목·색인·임베딩 캐시를 연쇄 삭제한다. 여러 출처가 섞인 항목은 통째로 지운다.

하트비트에 관해: 요청문은 OpenClaw의 요소로 heartbeat를 들었으나 현재 문서 기준으로는 맞지 않는다. 메모리 문서가 "The default heartbeat prompt performs no memory maintenance on its own"이라고 명시하고, 하트비트 자체가 일반 자동화 작업으로 바뀌었다("Heartbeat monitoring now uses ordinary automation jobs", 기본 30분 주기의 "Proactive check", <https://docs.openclaw.ai/gateway/heartbeat>). 메모리 유지는 dreaming이 맡고 하트비트는 능동 점검용이다.

**Hermes Agent (Nous Research)** (<https://hermes-agent.nousresearch.com/docs/user-guide/features/memory>)

- 저장: `MEMORY.md`(에이전트의 노트, 2,200자 한도)와 `USER.md`(사용자 프로필, 1,375자 한도). 합쳐 약 1,300토큰이며 항상 컨텍스트에 있다.
- 읽기: 세션 시작 시 시스템 프롬프트에 **고정 스냅샷**으로 넣는다. 세션 중 쓴 내용은 디스크에는 즉시 저장되지만 프롬프트에는 다음 세션부터 반영된다. 이유는 프리픽스 캐시 보존이다.
- 쓰기: 메모리 도구의 `add`, `patch`, `remove`. `replace`는 제거됐다. 항목 전체를 덮어써 다른 사실을 지웠기 때문이다. 한도를 넘는 쓰기는 오류를 반환하고 현재 항목과 줄여야 할 글자 수를 알려 준다. 자동 압축은 없고 에이전트가 직접 줄이거나 합친다.
- 과거 세션 검색: 모든 세션을 SQLite에 저장하고 FTS5 전문 검색으로 찾는다. 결과는 실제 메시지이며 "no LLM summarization, no truncation"이다. 즉 벡터도 요약도 없는 키워드 검색이다.
- 백그라운드: 턴 뒤에 도는 자기 개선 검토가 메모리를 저장하거나 스킬을 고친다. 빈도는 `memory.nudge_interval`로 조절한다.
- 절차 기억: 반복되는 교정과 작업 요령은 스킬이 된다. 스킬은 관련 있을 때만 로드되고 메모리 글자 수에 들지 않는다. curator가 에이전트가 만든 스킬을 사용 실적으로 관리한다. 14일 미사용이면 stale, 30일이면 archived이고 자동 삭제는 하지 않는다. 기본 7일 간격이며 2시간 이상 유휴일 때 실행된다(<https://hermes-agent.nousresearch.com/docs/user-guide/features/curator>).

**Letta**: 4.1절. 항상 주입되는 블록 + 검색하는 recall/archival + 백그라운드 dreaming.

**Claude Code**: 6.2절. 항상 로드되는 인덱스 + 필요할 때 여는 주제 파일.

**Manus** (<https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus>)

장기 메모리 제품이라기보다 긴 단일 작업의 컨텍스트 관리지만 원칙이 같다.
- 파일 시스템을 컨텍스트로 쓴다: "unlimited in size, persistent by nature". 파일을 "structured, externalized memory"로 다룬다.
- 복원 가능한 압축: "Our compression strategies are always designed to be restorable." 예: 웹 페이지 내용은 URL만 남기면 컨텍스트에서 빼도 된다.
- 암송: `todo.md`를 계속 고쳐 써서 목표를 컨텍스트 끝에 다시 놓는다.
- 프리픽스 고정: KV 캐시 적중률이 가장 중요한 지표이므로 컨텍스트는 추가만 한다. Hermes가 메모리를 세션 시작 스냅샷으로 고정하는 것과 같은 이유다.

**라이프로그 계열**

- Omi(오픈소스): 대화가 끝나면 구조화 필드(제목, 개요, 할 일, 일정)를 만들고, LLM으로 메타데이터(사람, 주제, 엔티티, 날짜)를 추출해 Pinecone에 올린다. 전체 전사는 임베딩하지 않는다. 벡터는 최초 처리 때 한 번만 만든다. 기억(사실)은 15단어 이하이고 대화 하나에서 최대 "interesting" 2개와 "system" 2개만 뽑는다. 읽기는 LangGraph ReAct 에이전트가 날짜 범위 조회, 의미 검색, 기억 조회 도구를 고르는 방식이며 질문당 도구 호출은 10회로 제한된다. 상대 날짜("어제")는 도구 호출 전에 ISO 타임스탬프로 바꾼다(<https://github.com/BasedHardware/omi/blob/main/backend/docs/chat-system.md>).
- Limitless: 개발자 API의 단위는 lifelog다. lifelog는 제목, 마크다운, 시작·종료 시각을 가지며 `contents`는 heading1/heading2/blockquote 조각의 배열이고 조각마다 시각과 화자가 붙는다. 검색은 키워드와 의미 검색의 하이브리드다(<https://www.limitless.ai/developers>). 즉 원시 전사를 제목 계층이 있는 문서로 구조화해 저장한다. 내부 파이프라인은 공개 문서에서 확인하지 못했다 `[미확인]`.
- Rewind: 화면과 오디오를 로컬에 기록하고 macOS API와 OCR로 색인한다는 것은 자사 마케팅 문구를 언론이 옮긴 것만 찾았다 `[2차]`. 파이프라인 세부는 확인된 1차 출처가 없다 `[미확인]`.

**Poke (Interaction Company)**: 메모리 구조를 설명한 자사 문서나 블로그를 찾지 못했다 `[미확인]`. 리뷰들은 "선호를 학습한다" 수준의 동작만 묘사한다 `[2차]`.

### 5.3 수개월~수년을 버티는 공통 패턴

내부를 공개한 시스템들에서 반복되는 구조다. 항목별 근거는 위 절에 있고, 패턴으로 묶은 것은 조사자의 정리다 `[추론]`.

1. **두 층 분리**: 작고 항상 주입되는 큐레이션 층(OpenClaw `MEMORY.md`, Hermes 2,200자, Letta 블록, Claude Code 인덱스 200줄)과 크고 검색으로만 꺼내는 원본 층(일별 노트, 세션 DB, recall 저장소). 큐레이션 층에는 모두 크기 한도가 있다.
2. **컨텍스트가 사라지기 직전 저장**: OpenClaw의 컴팩션 전 플러시, MemGPT의 70% 경고, Anthropic 컨텍스트 편집의 삭제 전 자동 경고(6.6절).
3. **백그라운드 통합**: OpenClaw dreaming(매일 03시), Letta dreaming(N스텝마다 또는 컴팩션 시), Hermes 백그라운드 검토, LangMem background, Generative Agents 반성. 대화 지연 없이 원본 층에서 큐레이션 층으로 승격한다.
4. **시간 계층 요약**: 1차 출처로 확인한 것은 2단계까지다. MemoryBank의 일별 요약 → 전체 요약, OpenClaw의 일별 노트 → `MEMORY.md`, Generative Agents의 반성 트리. 일 → 주 → 월의 고정 3단계 롤업을 명시한 1차 출처는 이번 조사에서 찾지 못했다. 자연스러운 확장이지만 `[추론]`이다.
5. **망각/감쇠**: 삭제가 아니라 검색 점수를 낮추는 방식이 주류다. OpenClaw 30일 반감기(큐레이션 파일은 면제), Generative Agents 0.995 감쇠, MemoryBank의 R = e^(-t/S)와 회상 시 강화. 실제로 지우는 예는 Hermes curator의 보관(복구 가능)과 Anthropic 문서가 권하는 장기 미접근 파일 삭제다.
6. **모순 처리**: 세 가지 방식이 있다. 덮어쓰기(Hermes `patch`, OpenClaw `USER.md`의 제자리 교체), LLM 판정(Mem0 UPDATE/DELETE, OpenClaw Deep 단계의 병합·대체), 무효화 표시 후 보존(Zep의 유효 구간, Mem0g).
7. **출처 추적과 오염 차단**: OpenClaw만 상세히 문서화했다. 외부 도구 결과가 섞인 턴의 쓰기를 untrusted로 표시해 자동 주입에서 빼는 것은 메모리를 통한 프롬프트 인젝션 지속을 막는 장치다. Pickle도 같은 위험을 언급한다(외부 글에 든 지시는 사용자의 허가가 아니다).
8. **프리픽스 캐시와의 충돌**: 메모리를 매 턴 바꿔 주입하면 캐시가 깨진다. Hermes는 세션 시작 스냅샷으로, Manus는 추가 전용 컨텍스트로 피한다.

## 6. 벤더·제품 메모리

### 6.1 Anthropic 메모리 도구

출처: <https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool>

- 구조: 클라이언트 측 도구다. Claude는 파일 작업을 요청만 하고 애플리케이션이 실행한다. `/memories`는 접두사이며 핸들러가 실제 저장소(사용자별 디렉터리, DB 키 등)에 대응시킨다. 도구 정의는 `{"type": "memory_20250818", "name": "memory"}`가 전부다.
- 명령: `view`(디렉터리 목록 또는 파일 내용), `create`, `str_replace`, `insert`, `delete`, `rename`.
- 읽기 경로:
  1. 도구가 있으면 API가 시스템 프롬프트에 지시를 자동으로 추가한다. 첫 줄이 "IMPORTANT: ALWAYS VIEW YOUR MEMORY DIRECTORY BEFORE DOING ANYTHING ELSE."다.
  2. Claude가 `view /memories`로 목록을 본다.
  3. 관련 있어 보이는 파일을 `view`로 연다.
  4. 그 내용을 바탕으로 작업한다.
- 쓰기 경로:
  1. 작업 중 진행 상황과 배운 것을 파일에 기록한다. 자동 지시문에 "ASSUME INTERRUPTION: Your context window might be reset at any moment"가 들어 있다.
  2. 파일이 어지러워지면 이름을 바꾸거나 지운다(도구 설명이 정리를 요구).
- 문서가 드는 주의점: 경로 탈출 방지(모든 경로가 `/memories` 안인지 검증), 파일 크기 상한, 오래 접근하지 않은 파일의 주기적 삭제, 민감 정보 검증.
- 여러 세션에 걸친 개발 패턴: 첫 세션이 진행 로그와 기능 체크리스트를 만들고, 이후 세션은 그것을 읽으며 시작하고 끝날 때 갱신한다.

### 6.2 Claude Code의 파일 메모리

출처: <https://code.claude.com/docs/en/memory>

두 가지가 있다. CLAUDE.md는 사람이 쓰는 지시이고, 자동 메모리는 Claude가 쓰는 노트다.

- 자동 메모리 저장: `~/.claude/projects/<project>/memory/`에 `MEMORY.md` 인덱스와 주제 파일. 인덱스는 "one line per memory"다.
- 읽기 경로:
  1. 세션 시작 시 `MEMORY.md`의 첫 200줄 또는 25KB 중 먼저 닿는 쪽까지 로드한다.
  2. 주제 파일은 시작 시 로드하지 않는다. "Claude reads them on demand using its standard file tools when it needs the information."
- 쓰기 경로:
  1. 세션 중 Claude가 사용자의 교정과 선호를 주제 파일로 쓴다.
  2. 인덱스에 한 줄을 추가하고, 인덱스가 길어지면 세부를 주제 파일로 옮긴다.
- 컴팩션 뒤: 프로젝트 루트 CLAUDE.md는 디스크에서 다시 읽어 주입한다. 대화에서만 말한 지시는 사라진다.
- 실패 양상(문서 기재): 200줄을 넘는 인덱스 내용은 로드되지 않는다. 메모리는 강제 설정이 아니라 컨텍스트로 취급되므로 길고 모호할수록 덜 지켜진다.

### 6.3 ChatGPT 메모리

출처: OpenAI 도움말 "Memory FAQ"(<https://help.openai.com/en/articles/8590148-memory-faq>). 이 페이지는 직접 열람이 403으로 막혀 검색 결과에 표시된 발췌로만 확인했다 `[검색 발췌]`.

- 저장된 메모리(saved memories): 대화 기록과 별도로 저장된다. 대화를 지워도 거기서 만들어진 메모리는 남는다. 메모리를 지우면 이후 개인화에 쓰이지 않지만 과거 대화 속 언급은 남는다.
- 대화 기록 참조(reference chat history): 과거 대화에서 관련 정보를 끌어온다. 명시적 저장과 달리 "information derived from chat history can change as ChatGPT updates what is most useful to remember"다. 끄면 과거 대화에서 기억한 정보가 30일 안에 삭제 예약된다.
- 요약: "a continually updated synthesis of context from your past chats".
- 내부 구조(검색 방식, 갱신 주기)는 공개돼 있지 않다 `[미확인]`. LangGraph 문서는 ChatGPT의 메모리 저장 도구를 hot path 쓰기의 예로 든다(2절 출처).
- 1절 표에서는 저장된 메모리가 9번(프로필/사실 목록, 항상 주입) 계열이고, 대화 기록 참조는 백그라운드에서 갱신되는 요약(15번 + 9번)으로 보인다 `[추론]`.

### 6.4 Gemini

출처: <https://support.google.com/gemini/answer/15637730>, <https://support.google.com/gemini/answer/16598469>

- 세 가지 개인화 원천: 과거 채팅의 기억, 연결한 Google 앱의 콘텐츠와 활동, 사용자가 적은 지시(일부 지역에서 "Saved info").
- 메모리: "Gemini can learn from your chats to understand more about you and your world." 사용자는 메모리 요약을 보고 관리할 수 있고, 틀린 내용은 채팅에서 직접 정정한다. 채팅을 삭제하면 잠시 뒤부터 개인화에 쓰이지 않는다.
- 내부 구조는 공개돼 있지 않다 `[미확인]`.

### 6.5 OpenAI Agents SDK 세션

3.1절과 3.2절에 적었다. 메커니즘은 전체 버퍼이고 `limit`으로 윈도우를 만들며 `OpenAIResponsesCompactionSession` 래퍼로 컴팩션을 붙인다. `session_input_callback`으로 이력과 새 입력을 합치는 방식을 바꿀 수 있지만 저장되는 것은 새 턴의 항목뿐이다(<https://openai.github.io/openai-agents-python/sessions/>). 장기 기억(추출, 검색)은 SDK 세션의 범위가 아니다.

### 6.6 컴팩션과 컨텍스트 편집

메모리는 아니지만 "무엇이 컨텍스트에 남는가"를 정하므로 메모리와 맞물린다.

- 컴팩션(Claude API): "Compaction replaces the older turns of a conversation with a summary that Claude writes on the server." 요청 시 실행하는 방식과 토큰 임계치에서 자동 실행하는 방식이 있고 둘 다 베타다. 최근 턴을 원문 그대로 유지하는 옵션과 백그라운드 실행 옵션이 있다(<https://platform.claude.com/docs/en/build-with-claude/compaction>). 구조상 3.4절의 요약+버퍼와 같다.
- 컨텍스트 편집(Claude API, 베타): 요약하지 않고 규칙으로 지운다. `clear_tool_uses_20250919`는 입력 토큰이 임계치(기본 100,000)를 넘으면 오래된 도구 결과부터 지우고 최근 3쌍을 남기며 자리에 "지워졌다"는 표시 문구를 둔다. `exclude_tools`로 특정 도구를 제외할 수 있다(<https://platform.claude.com/docs/en/build-with-claude/context-editing>).
- 메모리 도구와의 연결: 삭제 임계치에 가까워지면 "Claude receives an automatic warning to preserve important information"이라서 지워지기 전에 메모리 파일에 저장할 수 있다. MemGPT의 70% 경고, OpenClaw의 컴팩션 전 플러시와 같은 장치다.
- Anthropic의 권고: 장기 실행 에이전트는 컴팩션과 메모리를 함께 쓴다. 컴팩션이 활성 컨텍스트를 작게 유지하고 메모리가 요약에서 살아남아야 할 정보를 보존한다(메모리 도구 문서).

## 7. 추천: 메모리 모듈 후보

### 7.1 이 앱이 이미 가진 것

저장소를 읽어 확인한 내용이다(파일은 수정하지 않았다).

- LLM 노드에 Dify식 메모리 옵션이 이미 있다. `src/lib/engine/nodes/llm.ts`가 `request.history`에서 `window.size * 2`개 메시지를 잘라 넣는다. 1절 표의 2번이 이미 구현돼 있다.
- `assigner` 노드와 `conversation` 변수 풀이 있다(`src/lib/engine/runner.ts`). 대화 변수는 요청의 `conversationVariables`로 들어와 실행 결과로 나간다. 즉 대화 범위의 읽고 쓰기는 가능하지만 유지 책임이 호출자에게 있고, 대화를 넘는 저장은 없다.
- `knowledge-retrieval` 노드는 로컬 TF-IDF 코사인 유사도로 검색한다(`src/lib/engine/nodes/logic.ts`). 임베딩이 아니다. 실행 중에 지식 저장소에 쓰는 노드는 없다.
- 블록은 진입 포트 하나와 종료 포트 하나를 가진다(`src/lib/dsl/blocks.ts`).

### 7.2 필요한 새 기본 요소

| 기호 | 기본 요소 | 내용 | 필요한 후보 |
|---|---|---|---|
| P1 | 영속 저장소 노드(키-값/파일) | 범위(대화/사용자/앱)를 정해 읽기·쓰기·목록·부분 수정·삭제. 값 크기 한도 옵션 | C~H |
| P2 | 메모리 색인 쓰기 노드 | 텍스트 + 메타데이터(시각, 중요도, 마지막 접근 시각, 출처)를 검색 저장소에 추가·수정·삭제. 검색 노드는 메타데이터를 함께 반환하고 날짜 필터를 받아야 함 | D, E, G |
| P3 | 백그라운드/예약 트리거 | N턴마다, 유휴 시, 크론. 대화 응답과 무관하게 서브그래프 실행 | H (B·D·E의 비동기 변형에도) |
| P4 | 대화 이력 변수 | `sys.history`류로 이력을 일반 변수로 노출하고 토큰 수를 셀 수단 제공 | A, B |
| P5 | 블록의 두 경로 | 메모리 블록은 LLM 호출 **앞**(읽기)과 **뒤**(쓰기)에 각각 서브그래프가 필요하다. 현재 블록은 진입·종료가 하나씩이므로 블록 안에 두 구역을 두거나, LLM 노드에 붙는 "앞 블록/뒤 블록" 쌍으로 표현해야 한다 | 전부 |

P5는 메모리 종류와 무관한 구조 문제라 먼저 정해야 한다. 쓰기 경로는 LLM 응답을 입력으로 받아야 하고 그 결과가 사용자 응답을 늦추지 않아야 한다 `[추론]`.

### 7.3 후보 8개

단기에서 초장기 순이다. 노드 대응은 "이 앱의 노드 종류 → 하는 일"이다.

**A. 슬라이딩 윈도우** (한 세션)
- 읽기: [P4 이력 변수] → [code: 최근 k턴 또는 토큰 한도로 자르기] → LLM.
- 쓰기: 없음(이력은 런타임이 쌓는다).
- 추가 비용 0. 지금의 LLM 노드 메모리 옵션을 블록으로 드러낸 것이다. k를 무한대로 두면 전체 버퍼가 되므로 전체 버퍼를 따로 두지 않는다.

**B. 요약 + 최근 버퍼(컴팩션)** (긴 한 세션)
- 읽기: [template: 요약 변수 + 최근 원문 턴 합치기] → LLM.
- 쓰기: [code: 버퍼 토큰 수 계산] → [if-else: 한도 초과?] → 참이면 [LLM: 기존 요약 + 밀려날 턴 → 새 요약] → [assigner: 요약 대화 변수 덮어쓰기, 버퍼 줄이기].
- 추가 비용: 평소 0, 초과 시 LLM 1회. 새 기본 요소 없이 P4만 있으면 된다. 누적 요약(매 턴 요약)은 이것의 한도 0인 경우라 따로 두지 않는다.

**C. 고정 프로필 블록(항상 주입, 크기 제한)** (세션 간)
- 읽기: [P1 읽기: `user_profile`] → [template: 시스템 프롬프트에 삽입] → LLM.
- 쓰기: [parameter-extractor 또는 LLM: 이번 턴에 지속적인 선호·사실이 있는가, 있다면 무엇을 추가/수정/삭제하나] → [if-else: 변경 있음?] → [code: 글자 수 한도 검사, 넘으면 오류 또는 줄이기 분기] → [P1 쓰기].
- 추가 비용: LLM 1회(쓰기). MemGPT 코어 메모리, Hermes `USER.md`, LangMem profile, ChatGPT 저장된 메모리에 해당한다. 배울 점: 한도를 넘으면 자동으로 자르지 말고 무엇을 줄일지 LLM에 다시 묻는다(Hermes). 전체 덮어쓰기 대신 부분 수정을 쓴다(Hermes가 `replace`를 없앤 이유).

**D. 사실 추출 + 통합(검색형 컬렉션)** (수개월~수년)
- 읽기: [knowledge-retrieval: 현재 질의로 사실 top-k] → [template] → LLM.
- 쓰기: [parameter-extractor: 후보 사실 목록] → 사실마다 [knowledge-retrieval: 유사 기존 기억 top-s] → [switch(AI 분기): ADD / UPDATE / DELETE / NOOP] → 가지마다 [P2 추가/수정/삭제].
- 추가 비용: LLM 2회 이상. Mem0와 LangMem collection에 해당한다. C와의 차이는 읽기 경로다. C는 전부 주입하고 D는 검색한다. 사실이 수백 개를 넘으면 D가 필요하다. 사실마다 반복하려면 반복 실행 수단이 필요하다(없으면 code 노드 안에서 처리).

**E. 일화 스트림(최신성 × 중요도 × 관련성)** (수개월)
- 읽기: [knowledge-retrieval: 후보 넓게 가져오기 + 메타데이터] → [code: 세 점수 정규화 후 가중합, 상위 n개] → [template] → LLM. 꺼낸 항목의 마지막 접근 시각을 갱신한다([P2 수정]).
- 쓰기: [LLM 또는 parameter-extractor: 이번 턴의 중요도 1~10] → [P2 추가: 원문 턴 + 시각 + 중요도].
- 추가 비용: LLM 1회. Generative Agents의 검색 함수다. 단순 벡터 검색(1절 5번)은 가중치를 관련성만 1로 둔 경우이므로 E의 설정으로 흡수한다. D와의 차이는 저장 대상이다. D는 추출한 사실(원문을 버림), E는 원문 일화(정정 없음)다.

**F. 파일 메모리(인덱스 + 주제 파일)** (수개월~수년)
- 읽기: [P1 읽기: 인덱스] → [question-classifier 또는 LLM: 이 질의에 필요한 주제 파일 고르기] → [P1 읽기: 고른 파일] → [template] → LLM.
- 쓰기: [LLM: 저장할 것이 있나, 어느 파일에 무엇을] → [if-else] → [P1 쓰기: 주제 파일] → [P1 수정: 인덱스에 한 줄].
- 추가 비용: LLM 1~2회. Claude Code 자동 메모리, Anthropic 메모리 도구, OpenClaw에 해당한다. 사람이 파일을 직접 읽고 고칠 수 있어 다른 후보보다 투명하다. 원래 구현들은 에이전트가 도구 루프로 파일을 여는데, 이 앱에 도구 호출 루프가 없다면 "분류 노드가 파일을 고른다"로 근사한다 `[추론]`.

**G. 시간 지식 그래프(무효화 방식)** (수개월~수년, 사실이 자주 바뀌는 경우)
- 읽기: [parameter-extractor: 질의의 엔티티] → [P1/P2 조회: 해당 엔티티의 현재 유효한 사실] → [template] → LLM.
- 쓰기: [parameter-extractor: (주어, 관계, 목적어, 유효 시작 시각) 트리플] → [P2 조회: 같은 주어·관계의 기존 사실] → [switch(AI 분기): 모순 / 중복 / 신규] → 모순이면 [P2 수정: 기존 사실에 무효 시각 기록] + [P2 추가], 중복이면 종료, 신규면 [P2 추가].
- 추가 비용: LLM 2~3회. Zep/Graphiti의 핵심만 남긴 것이다. D와의 차이는 삭제하지 않고 유효 구간을 남겨 "예전에는 어땠나"에 답할 수 있다는 점이다. 그래프 탐색과 커뮤니티 요약은 노드 몇 개로 표현하기 어려우니 뺀다. 엔티티 메모리(3.6)와 단순 KG 메모리(3.7)는 이것의 무효화 없는 부분집합이다.

**H. 백그라운드 통합("dreaming")** (초장기, 다른 후보에 덧붙이는 모듈)
- 읽기: 자체 읽기 경로 없음. 대상 저장소(C, D, F)의 읽기 경로를 그대로 쓴다.
- 쓰기: [P3 트리거: 매일 또는 N턴마다] → [P1/P2 읽기: 마지막 실행 이후의 원본 로그] → [LLM: 일별 요약 작성] → [P1 쓰기: 일별 노트] → [code: 승격 후보 점수(빈도, 최신성, 회상 횟수), 관문 통과 여부] → [LLM: 현재 큐레이션 파일에 대해 추가·병합·대체 결정] → [code: 기존 항목을 일정 비율 넘게 지우면 거부] → [P1 쓰기].
- 추가 비용: 턴 비용 0, 실행당 LLM 2회 이상. OpenClaw dreaming, Letta sleep-time, Generative Agents 반성에 해당한다. 일 → 주 → 월 롤업과 감쇠도 이 모듈의 설정으로 넣는다. 대화 턴 밖에서 도는 유일한 후보이므로 P3 없이는 만들 수 없다.

### 7.4 같이 내놓지 말 것

| 묶음 | 이유 | 남길 것 |
|---|---|---|
| 전체 버퍼 / 윈도우 | 윈도우의 k = 무한대가 전체 버퍼 | A |
| 누적 요약 / 요약+버퍼 / 컴팩션 | 버퍼 한도만 다름 | B |
| 벡터 검색 메모리 / 메모리 스트림 | 점수 가중치만 다름 | E |
| 코어 메모리 블록 / 프로필 / 저장된 메모리 | 모두 "작고 항상 주입되는 문서" | C |
| Mem0 / LangMem collection / A-MEM | 모두 "추출 후 유사 기억과 대조해 LLM이 갱신". A-MEM은 링크와 이웃 갱신이 추가될 뿐 | D (A-MEM식 링크는 옵션) |
| 엔티티 메모리 / 단순 KG / 시간 KG / Mem0 그래프 | 구조화 수준과 무효화 유무만 다름 | G |
| Anthropic 메모리 도구 / Claude Code 자동 메모리 / OpenClaw 파일 / Manus 파일 | 모두 "파일 디렉터리 + 인덱스" | F |
| sleep-time / dreaming / 반성 / background 메모리 매니저 | 모두 "대화 밖에서 통합" | H |

C와 F는 가깝다. 파일이 하나뿐인 F가 C다. 둘 다 내놓는다면 C는 "한도가 있는 단일 문서, 전부 주입", F는 "여러 파일, 인덱스만 주입"으로 차이를 분명히 해야 한다. 후보를 6개로 줄여야 한다면 C를 F에 합치고 G를 빼는 것이 손실이 가장 작다 `[추론]`.

### 7.5 먼저 만들 순서

A와 B는 새 저장소 없이 가능하다. P1 하나를 만들면 C와 F가 열린다. P2를 만들면 D, E, G가 열린다. H는 P3가 필요해 마지막이다. 사용자가 가장 관심 있는 초장기 기억은 F + H 조합(OpenClaw 구조)이 근거 자료가 가장 풍부하다 `[추론]`.

## 8. 확인하지 못한 것

- **Pickle의 메모리 내부 구조**: 추출·검색·갱신·망각 방식이 공개돼 있지 않다. 자사 글은 프라이버시 관점의 설명뿐이다.
- **Pickle 앱과 Pickle 1 안경의 관계**: 창업자와 YC 배치가 일치한다는 것은 YC 페이지(앱)와 언론 보도(안경)를 맞춰 본 결과다. 회사가 방향 전환을 밝힌 문서는 찾지 못했다.
- **Vooy의 메모리 내부 구조**: 개인정보 처리방침의 정의와 보존 기간만 확인했다. 상시 실행 여부와 출시 단계(클로즈드 베타/오픈 베타/정식)는 출처마다 다르다. vooy.com의 "It builds memory" 문구는 검색 발췌로만 봤다.
- **Poke**: 메모리에 관한 1차 출처를 찾지 못했다.
- **Rewind**: 1차 기술 문서를 찾지 못했다. **Limitless**: API의 데이터 형태만 확인했고 내부 파이프라인과 인수 이후 상태는 확인하지 못했다.
- **ChatGPT 메모리**: 도움말 페이지와 OpenAI 블로그 글이 403으로 막혀 검색 발췌에 의존했다. 내부 구조는 비공개다. **Gemini**도 내부 구조는 비공개다.
- **Dify LLM 노드의 창 크기**: 공식 문서 페이지에 창 크기 설명이 없었고 `MemoryConfig` 원본 정의를 열지 못했다. `TokenBufferMemory` 소스만 확인했다. 또 문서는 메모리가 노드별이라고 하는데 GitHub 이슈 하나는 대화 단위로 공유된다고 주장한다. 어느 쪽이 맞는지 확인하지 못했다.
- **OpenClaw**: `minScore`, `minRecallCount`, `minUniqueQueries`의 기본값, 하이브리드 검색의 가중치 값, 컴팩션 전 플러시의 프롬프트 원문은 현재 문서에 없었다. 문서가 버전에 따라 달라서(하트비트가 자동화 작업으로 바뀜) 예전 글의 설명과 어긋날 수 있다.
- **Letta**: sleep-time 실행 빈도의 기본값과 메모리 편집 도구의 현재 이름을 확인하지 못했다. 예전 sleep-time 문서 주소가 dreaming 문서로 넘어간다. MemFS의 디렉터리 구조 문서는 열지 않았다.
- **Hermes curator**: 같은 문서 안에서 미사용 기준이 14일/30일(설정 기본값)과 30일/90일(본문 설명)로 다르게 나온다. 설정 기본값을 적었다.
- **일 → 주 → 월 계층 요약**: 3단계 롤업을 명시한 1차 출처를 찾지 못했다. 2단계(일별 → 전체)만 확인했다.
- **수치**: Mem0, Zep, sleep-time 논문의 성능 수치는 각 저자의 자체 평가이고 독립 검증 여부는 조사하지 않았다.
- 1절 표의 "턴당 추가 비용"과 각 절의 실패 양상 중 `[추론]` 표시가 있는 것은 출처의 서술이 아니라 메커니즘에서 도출한 것이다.
