import { addRecord, loadMemory, mutateMemory, scoreRecords } from "./store";

/**
 * 세션 기록: 지난 대화의 턴을 그대로 쌓아 두고 나중에 검색한다(쓸 때 중요도를 매기지 않는다).
 * 워크플로에 conversation_search 도구를 켠 LLM 노드가 있을 때만 쌓는다.
 * data/memory/<범위>/__sessions.json 의 records 에 턴 하나가 기록 하나다.
 */

export const SESSION_STORE = "__sessions";
const MAX_TURNS = 3000;
const MAX_TURN_CHARS = 6000;

export async function recordTurn(scope: string, conversationId: string, query: string, answer: string): Promise<void> {
  if (!query.trim() && !answer.trim()) return;
  const text = `사용자: ${query.trim()}\nAI: ${answer.trim()}`.slice(0, MAX_TURN_CHARS);
  await mutateMemory(scope, SESSION_STORE, (m) => {
    addRecord(m, text, { conversationId });
    if (m.records.length > MAX_TURNS) m.records = m.records.slice(-MAX_TURNS);
  });
}

export interface SessionHit {
  id: string;
  date: string;
  conversation_id: string;
  same_conversation: boolean;
  relevance: number;
  text: string;
}

export async function searchSessions(scope: string, query: string, topK: number, currentConversation?: string): Promise<{ hits: SessionHit[]; searched: number }> {
  const m = await loadMemory(scope, SESSION_STORE);
  const hits = scoreRecords(query, m.records)
    .filter((r) => r.relevance > 0)
    .slice(0, topK)
    .map((r) => ({
      id: r.id,
      date: r.createdAt.slice(0, 16).replace("T", " "),
      conversation_id: r.conversationId ?? "",
      same_conversation: !!currentConversation && r.conversationId === currentConversation,
      relevance: Number(r.relevance.toFixed(3)),
      text: r.text,
    }));
  return { hits, searched: m.records.length };
}

/** 최근 턴(드리밍이 읽는다) */
export async function recentTurns(scope: string, limit: number): Promise<{ date: string; text: string }[]> {
  const m = await loadMemory(scope, SESSION_STORE);
  return m.records.slice(-limit).map((r) => ({ date: r.createdAt.slice(0, 10), text: r.text }));
}
