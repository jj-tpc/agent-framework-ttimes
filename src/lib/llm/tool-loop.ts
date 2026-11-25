import type { TokenUsage } from "../engine/types";
import { COMPACT_KEEP_ROUNDS, clip, type ToolCall, type ToolCallRecord } from "../tools/config";
import type { LlmStep, ProviderCall } from "./types";

/** 한 번의 모델 응답이 요청한 도구들을 함께 실행한다(병렬 도구 호출). 실패는 오류 결과로 모델에 돌려준다. */
export async function runToolCalls(c: Pick<ProviderCall, "runTool" | "onThinking" | "signal">, calls: ToolCall[]): Promise<ToolCallRecord[]> {
  return Promise.all(
    calls.map(async (call) => {
      const started = Date.now();
      c.onThinking?.(`\n🔧 ${call.name}(${preview(call.input)})`);
      let output: string;
      let isError = false;
      try {
        if (c.signal?.aborted) throw new Error("요청이 취소되었습니다.");
        const r = await c.runTool!(call);
        output = clip(r.output);
        isError = !!r.isError;
      } catch (e) {
        output = `도구 실행 오류: ${(e as Error).message || String(e)}`;
        isError = true;
      }
      c.onThinking?.(`\n${isError ? "⚠️" : "↩"} ${call.name}: ${output.replace(/\s+/g, " ").slice(0, 160)}\n`);
      return { ...call, output, isError, elapsedMs: Date.now() - started };
    }),
  );
}

const preview = (input: unknown) => {
  const s = typeof input === "string" ? input : JSON.stringify(input ?? {});
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
};

export const sumUsage = (steps: LlmStep[]): TokenUsage => ({
  inputTokens: steps.reduce((n, s) => n + s.usage.inputTokens, 0),
  outputTokens: steps.reduce((n, s) => n + s.usage.outputTokens, 0),
});

/** 최종 답: 마지막 단계의 글. 비어 있으면(도구만 부르고 끝남) 앞 단계의 글을 이어 붙인다 */
export function finalText(steps: LlmStep[]): string {
  const last = steps[steps.length - 1]?.text ?? "";
  return last.trim() ? last : steps.map((s) => s.text).filter((t) => t.trim()).join("\n\n");
}

export const parseArgs = (raw: string): unknown => {
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return { __invalid_json: raw };
  }
};

/** 대화에 들어 있는 도구 결과 하나. 어댑터가 자기 형식의 메시지를 고쳐 쓰는 방법(clear)을 함께 준다 */
export interface ResultSlot {
  round: number;
  size: number;
  clear: () => void;
  cleared?: boolean;
}

export const CLEARED_NOTE = "[오래된 도구 결과는 컨텍스트를 아끼려고 비웠다. 다시 필요하면 같은 도구를 한 번 더 호출하라.]";

/**
 * 도구 결과 비우기: 쌓인 결과가 budget(글자)을 넘으면 오래된 것부터 한 줄 안내로 바꾼다.
 * 최근 keepRounds 번의 왕복은 건드리지 않는다. 대화 자체를 요약하지는 않는다 — 가장 싸고 손실이 적은 압축이다.
 */
export function compactSlots(slots: ResultSlot[], currentRound: number, budget: number | undefined, keepRounds = COMPACT_KEEP_ROUNDS): number {
  if (!budget) return 0;
  let total = slots.reduce((n, s) => n + (s.cleared ? 0 : s.size), 0);
  let cleared = 0;
  for (const s of slots) {
    if (total <= budget) break;
    if (s.cleared || s.round > currentRound - keepRounds || s.size <= CLEARED_NOTE.length) continue;
    s.clear();
    s.cleared = true;
    total -= s.size;
    cleared++;
  }
  return cleared;
}

/** 공급자가 서버에서 실행한 도구(웹 검색)를 실행 기록에 남길 때의 모양 */
export const providerCall = (id: string, name: string, input: unknown): ToolCallRecord => ({
  id,
  name,
  input,
  output: "(공급자가 서버에서 실행 — 결과는 모델에게 바로 전달됨)",
  isError: false,
  elapsedMs: 0,
});
