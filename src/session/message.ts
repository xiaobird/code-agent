import type { ModelMessage } from "ai"

export type Message = { id: string; sessionID: string; role: "user" | "assistant"
  finish?: string; summary?: boolean; parentID?: string; agent?: string
  tokens?: { total?: number; input: number; output: number; cache: { read: number; write: number } }
  time?: { created: number; completed?: number }; [k: string]: unknown }
export type Part = { id: string; messageID: string; sessionID: string } & (
  | { type: "text"; text: string }
  | { type: "tool"; tool: string; callID: string; state: ToolState }
  | { type: "compaction"; auto: boolean; tail_start_id?: string }
  | { type: "patch"; hash: string; fromHash?: string; files: string[] }
)
export type ToolState =
  | { status: "pending" | "running"; input: Record<string, unknown>; time?: { start: number } }
  | { status: "completed"; input: Record<string, unknown>; output: string; title: string
      metadata: Record<string, unknown>; time: { start: number; end: number; compacted?: number } }
  | { status: "error"; input: Record<string, unknown>; error: string; time: { start: number; end: number } }
export type MessageWithParts = { info: Message; parts: Part[] }

export function latest(msgs: MessageWithParts[]) {
  let lastUser: Message | undefined, lastAssistant: Message | undefined
  for (const m of msgs) {
    if (m.info.role === "user") lastUser = m.info
    else lastAssistant = m.info
  }
  return { lastUser, lastAssistant }
}

export function hasPendingToolCalls(msg: MessageWithParts): boolean {
  return msg.parts.some((p) => p.type === "tool" && (p.state.status === "pending" || p.state.status === "running"))
}

export function filterCompacted(msgs: MessageWithParts[]): MessageWithParts[] {
  // 找最近一条带 tail_start_id 的 CompactionPart；之前的消息全部丢弃（DB 保留）
  for (let i = msgs.length - 1; i >= 0; i--) {
    const cp = msgs[i].parts.find(
      (p) => p.type === "compaction" && p.tail_start_id,
    ) as { tail_start_id?: string } | undefined
    if (!cp?.tail_start_id) continue
    const idx = msgs.findIndex((m) => m.info.id === cp.tail_start_id)
    if (idx === -1) return msgs
    // 上下文 = [compaction 锚点, 总结, ...tail_start_id 起的尾部, ...其后的新消息]
    // 兼容两种物理布局：tail 在 compaction 之后（插入式）或之前（本实现 compact() 的追加式）
    const after = msgs.slice(i + 1)
    const summaryPart: MessageWithParts[] = []
    for (const m of after) {
      if (m.info.summary === true) summaryPart.push(m)
      else break
    }
    const rest = after.slice(summaryPart.length)
    const tail = idx > i ? [] : msgs.slice(idx, i)
    return [msgs[i], ...summaryPart, ...tail, ...rest]
  }
  return msgs
}

export function toModelMessages(msgs: MessageWithParts[]): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const msg of msgs) {
    if (msg.info.role === "user") {
      const text = msg.parts.map((p) =>
        p.type === "text" ? p.text : p.type === "compaction" ? "What did we do so far?" : "",
      ).filter(Boolean).join("\n")
      if (text) out.push({ role: "user", content: text })
      continue
    }
    const content: unknown[] = []
    const toolResults: unknown[] = []
    for (const part of msg.parts) {
      if (part.type === "text") content.push({ type: "text", text: part.text })
      if (part.type === "tool") {
        content.push({ type: "tool-call", toolCallId: part.callID, toolName: part.tool, input: part.state.input })
        if (part.state.status === "completed") {
          toolResults.push({ type: "tool-result", toolCallId: part.callID, toolName: part.tool,
            output: { type: "text", value: part.state.time.compacted
              ? "[Old tool result content cleared]" : part.state.output } })
        }
        if (part.state.status === "error") {
          toolResults.push({ type: "tool-result", toolCallId: part.callID, toolName: part.tool,
            output: { type: "text", value: `Error: ${part.state.error}` } })
        }
      }
    }
    if (content.length) out.push({ role: "assistant", content: content as never })
    if (toolResults.length) out.push({ role: "tool", content: toolResults as never })
  }
  return out
}
