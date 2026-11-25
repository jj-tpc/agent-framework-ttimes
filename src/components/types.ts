import type { NodeRun } from "@/lib/engine/types";

export interface LiveStream {
  text: string;
  thinking: string;
}

export interface UserMessage {
  id: string;
  role: "user";
  content: string;
  inputs?: Record<string, unknown>;
}

export interface AssistantMessage {
  id: string;
  role: "assistant";
  content: string;
  status: "running" | "succeeded" | "failed" | "stopped";
  runs: NodeRun[];
  /** runId → 실행 중 스트리밍된 텍스트/추론 요약 */
  live: Record<string, LiveStream>;
  error?: string;
  elapsedMs?: number;
  totalTokens?: number;
  variablePool?: Record<string, Record<string, unknown>>;
  llmMode?: "live" | "mock";
}

export type ChatMessage = UserMessage | AssistantMessage;

export type Selection =
  | { messageId: string; nodeId: string; pool?: undefined }
  | { messageId: string; pool: true; nodeId?: undefined }
  | null;

export interface WorkflowEntry {
  id: string;
  name: string;
  description: string;
  yaml: string;
  source: "file" | "imported";
  file?: string;
  error?: string;
}
