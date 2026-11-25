/** 서버(엔진)와 클라이언트(UI)가 공유하는 실행 기록·이벤트 타입. */

export type NodeStatus = "running" | "succeeded" | "failed";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** 노드 1회 실행 기록. Dify의 node_finished 이벤트와 같은 구성(inputs / process_data / outputs). */
export interface NodeRun {
  id: string;
  nodeId: string;
  nodeType: string;
  title: string;
  index: number;
  status: NodeStatus;
  /** 노드가 읽어 들인 변수 — "참조 경로 → 실제 값" */
  inputs: Record<string, unknown>;
  /** 입력을 결과로 바꾸는 중간 과정 — 렌더링된 프롬프트, 조건 평가, 검색 점수 등 */
  processData: Record<string, unknown>;
  /** 변수 풀에 기록된 결과 */
  outputs: Record<string, unknown>;
  /** 분기 노드가 선택한 핸들(if-else의 case_id, 분류기의 class id 등) */
  selectedHandle?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  elapsedMs?: number;
  usage?: TokenUsage;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface RunRequest {
  /** Dify DSL — YAML 문자열 또는 파싱된 객체 */
  dsl: string | Record<string, unknown>;
  query: string;
  inputs?: Record<string, unknown>;
  history?: ChatTurn[];
  conversationId?: string;
  conversationVariables?: Record<string, unknown>;
  /** 메모리 저장소 범위(보통 프로젝트 ID). 같은 범위면 대화를 새로 시작해도 같은 기억을 본다 */
  memoryScope?: string;
}

export type RunEvent =
  | {
      event: "workflow_started";
      workflowRunId: string;
      workflowName: string;
      llmMode: "live" | "mock";
      startedAt: number;
    }
  | { event: "node_started"; run: NodeRun }
  | { event: "node_progress"; runId: string; nodeId: string; kind: "text" | "thinking"; delta: string }
  | { event: "node_finished"; run: NodeRun }
  | { event: "message"; nodeId: string; answer: string }
  | {
      event: "workflow_finished";
      workflowRunId: string;
      status: "succeeded" | "failed";
      error?: string;
      outputs: Record<string, unknown>;
      elapsedMs: number;
      totalTokens: number;
      variablePool: Record<string, Record<string, unknown>>;
      conversationVariables: Record<string, unknown>;
    };
