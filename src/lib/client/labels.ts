import type { DifyNode } from "../dsl/types";
import type { NodeRun } from "../engine/types";

/** 실행 기록에 표시할 선택 분기. 분기 노드는 ID 대신 분기 이름 */
export function branchLabel(run: NodeRun): string | undefined {
  if (!run.selectedHandle) return undefined;
  if (run.nodeType === "switch" && typeof run.outputs?.branch === "string") return run.outputs.branch;
  return run.selectedHandle;
}

export interface RefLabel {
  scope: string;
  name: string;
  nodeType?: string;
}

/** "노드ID.변수.하위" 경로를 화면용 이름(노드 제목 › 변수)으로 바꾼다. */
export function refLabel(path: string, nodesById: Map<string, DifyNode>): RefLabel {
  const [head, ...rest] = path.split(".");
  const name = rest.join(".");
  if (head === "sys") return { scope: "시스템", name };
  if (head === "env") return { scope: "환경변수", name };
  if (head === "conversation") return { scope: "대화변수", name };
  if (head === "context" && !name) return { scope: "컨텍스트", name: "" };
  const node = nodesById.get(head);
  if (node) return { scope: node.data.title || node.data.type, name, nodeType: node.data.type };
  return { scope: head, name };
}

export function formatMs(ms?: number) {
  if (ms == null) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}
