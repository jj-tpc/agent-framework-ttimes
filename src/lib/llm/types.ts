import type { TokenUsage } from "../engine/types";
import type { ToolCall, ToolCallRecord, ToolDef, ToolOutput } from "../tools/config";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

/** 공급자 어댑터 공통 입력 */
export interface ProviderCall {
  apiKey: string;
  model: string;
  /** 정규화된 completion_params (catalog.resolveModelConfig 결과) */
  params: Record<string, unknown>;
  system: string;
  messages: LlmMessage[];
  jsonSchema?: Record<string, unknown>;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onThinking?: (delta: string) => void;
  /** 도구가 있으면 어댑터가 도구 호출 루프를 돈다 */
  tools?: ToolDef[];
  runTool?: (call: ToolCall) => Promise<ToolOutput>;
  /** 도구 왕복 최대 횟수. 넘으면 도구 없이 마지막 답을 받는다 */
  maxSteps?: number;
  /** 쌓인 도구 결과가 이 글자 수를 넘으면 오래된 결과부터 비운다 */
  compactAfter?: number;
  /** 공급자가 서버에서 실행하는 도구 이름 (web_search) */
  providerTools?: string[];
}

/** 도구 루프의 한 바퀴(모델 호출 1회 + 그때 부른 도구들) */
export interface LlmStep {
  text: string;
  thinking: string;
  stopReason: string | null;
  usage: TokenUsage;
  toolCalls: ToolCallRecord[];
  /** 이 단계 뒤에 컨텍스트를 아끼려고 비운 예전 도구 결과 수 */
  clearedResults?: number;
}

export interface LlmCallResult {
  text: string;
  thinking: string;
  /** 응답이 보고한 실제 모델 */
  model: string;
  stopReason: string | null;
  usage: TokenUsage;
  fallback?: string;
  /** 실제 API에 보낸 요청 본문(키 제외) — 화면에서 입력 구성을 그대로 보여 주기 위함 */
  request: Record<string, unknown>;
  /** 도구를 썼을 때의 단계별 기록 */
  steps?: LlmStep[];
  /** 요청 형식 이름 (Messages API, Responses API …) */
  api: string;
}

export interface ModelListItem {
  id: string;
  label?: string;
}
