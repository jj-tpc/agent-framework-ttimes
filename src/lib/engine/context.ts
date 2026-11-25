import type { DifyNode, Workflow } from "../dsl/types";
import type { LlmRuntime } from "../store/settings";
import type { RunRequest, TokenUsage } from "./types";
import type { VariablePool } from "./variable-pool";

/** 노드 실행기가 채워 넣는 기록. 실행 도중 실패해도 여기까지 채운 입력·과정은 화면에 남는다. */
export interface NodeTrace {
  inputs: Record<string, unknown>;
  processData: Record<string, unknown>;
}

export interface NodeContext {
  node: DifyNode;
  data: Record<string, unknown>;
  workflow: Workflow;
  pool: VariablePool;
  request: RunRequest;
  signal: AbortSignal;
  llm: LlmRuntime;
  trace: NodeTrace;
  progress: (kind: "text" | "thinking", delta: string) => void;
}

export interface NodeResult {
  outputs: Record<string, unknown>;
  /** 분기 노드가 고른 출력 핸들. 생략하면 일반 출력('source')으로 진행한다. */
  selectedHandle?: string;
  usage?: TokenUsage;
  /** Answer 노드가 채팅창으로 내보낼 텍스트 */
  answer?: string;
}

export type NodeExecutor = (ctx: NodeContext) => Promise<NodeResult>;
