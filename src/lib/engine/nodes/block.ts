import { PORT, membersOf } from "../../dsl/blocks";
import type { NodeExecutor } from "../context";

/**
 * 블록 진입·종료. 값을 만들지 않고 흐름만 통과시킨다.
 * 화면의 블록 실행 기록(블록 입력 = 안쪽에서 읽은 바깥 값, 출력 = 바깥에서 읽은 안쪽 값)은 노드 실행 기록에서 계산한다.
 */

export const blockEntryNode: NodeExecutor = async (ctx) => {
  const members = membersOf(ctx.workflow.nodes, ctx.node.id);
  ctx.trace.processData = {
    phase: "entry",
    members: members.map((m) => ({ id: m.id, title: m.data.title ?? m.data.type, type: m.data.type })),
  };
  return { outputs: {} };
};

export const blockExitNode: NodeExecutor = async (ctx) => {
  const blockId = String(ctx.data.block_id ?? "");
  // 아웃 포인트에 연결된 안쪽 노드가 남긴 값 = 블록의 결과
  const feeders = ctx.workflow.edges.filter((e) => e.target === blockId && e.targetHandle === PORT.exit).map((e) => e.source);
  const snapshot = ctx.pool.snapshot();
  const inputs: Record<string, unknown> = {};
  for (const id of feeders) {
    for (const [key, value] of Object.entries(snapshot[id] ?? {})) inputs[`${id}.${key}`] = value;
  }
  ctx.trace.inputs = inputs;
  ctx.trace.processData = { phase: "exit", from: feeders };
  return { outputs: {} };
};
