/**
 * Dify DSL(앱 내보내기 YAML)의 부분 집합.
 * Dify에서 내보낸 YAML을 그대로 읽을 수 있도록 필드 이름과 구조를 Dify와 맞춘다.
 */

export type ValueSelector = string[];

/** Dify DSL 문서 루트(app / kind / version / workflow …). 원본 필드를 보존하기 위해 느슨하게 둔다. */
export type DslDoc = Record<string, unknown>;

export interface DifyNodeData {
  type: string;
  title?: string;
  desc?: string;
  [key: string]: unknown;
}

export interface DifyNode {
  id: string;
  type?: string; // React Flow 렌더 타입 ('custom', 'custom-note' 등)
  data: DifyNodeData;
  position?: { x: number; y: number };
  parentId?: string;
  width?: number;
  height?: number;
}

export interface DifyEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
  data?: Record<string, unknown>;
}

export interface DifyVariableDecl {
  variable?: string;
  name?: string;
  value?: unknown;
  value_type?: string;
}

export interface Workflow {
  name: string;
  description: string;
  mode: string; // advanced-chat | workflow | ...
  icon?: string;
  nodes: DifyNode[];
  edges: DifyEdge[];
  environmentVariables: Record<string, unknown>;
  conversationVariables: Record<string, unknown>;
  openingStatement?: string;
  suggestedQuestions: string[];
}
