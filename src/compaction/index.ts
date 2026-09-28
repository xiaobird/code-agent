import { randomUUID } from "crypto"
import type { LanguageModel } from "ai"
import type { Storage } from "../storage/db"
import type { MessageWithParts } from "../session/message"
import { selectTail } from "./select"
import { streamLLM } from "../llm/stream"
import { SUMMARY_PROMPT, SUMMARY_INCREMENTAL_NOTE, CONTINUE_MESSAGE } from "./prompt"

export const COMPACTION_BUDGET_MIN = 2_000
export const COMPACTION_BUDGET_MAX = 8_000

export function compactionBudget(contextLimit: number): number {
  return Math.min(COMPACTION_BUDGET_MAX, Math.max(COMPACTION_BUDGET_MIN, Math.floor(contextLimit * 0.25)))
}

/** 头部序列化：保留调用结构，工具输出截 2000 字符 */
export function serializeHead(head: MessageWithParts[]): string {
  const lines: string[] = []
  for (const msg of head) {
    if (msg.info.summary === true) {
      const text = msg.parts.map((p) => (p.type === "text" ? p.text : "")).join("")
      if (text) lines.push(`[Summary]:\n${text}`)
      continue
    }
    for (const part of msg.parts) {
      if (part.type === "text") {
        lines.push(`${msg.info.role === "user" ? "[User]" : "[Assistant]"}: ${part.text}`)
      } else if (part.type === "tool") {
        lines.push(`[Assistant tool call]: ${part.tool}(${JSON.stringify(part.state.input)})`)
        if (part.state.status === "completed") {
          const out =
            part.state.output.length > 2000
              ? part.state.output.slice(0, 2000) + "... [truncated]"
              : part.state.output
          lines.push(`[Tool result]: ${out}`)
        } else if (part.state.status === "error") {
          lines.push(`[Tool result]: Error: ${part.state.error}`)
        }
      }
    }
  }
  return lines.join("\n\n")
}

export async function compact(
  storage: Storage,
  sessionID: string,
  model: LanguageModel,
  modelInfo: { contextLimit: number },
): Promise<"continue" | "stop"> {
  const msgs = storage.messagesWithParts(sessionID)
  const { head, tailStartID } = selectTail(msgs, compactionBudget(modelInfo.contextLimit))
  if (head.length === 0) return "stop" // 没有可总结的头部

  const hasOldSummary = head.some((m) => m.info.summary === true)
  const system = hasOldSummary ? [SUMMARY_PROMPT, SUMMARY_INCREMENTAL_NOTE] : [SUMMARY_PROMPT]

  let summary = ""
  for await (const ev of streamLLM({
    model,
    system,
    messages: [{ role: "user", content: serializeHead(head) }],
    tools: {},
    abort: new AbortController().signal,
  })) {
    if (ev.type === "text-delta") summary += ev.text
    if (ev.type === "error") return "stop"
  }
  if (!summary.trim()) return "stop"

  // compaction user 消息（锚点，记录 tail_start_id）—— 时间戳严格递增保证消息顺序
  const now = Date.now()
  const compactionUser = {
    id: randomUUID(),
    sessionID,
    role: "user" as const,
    time: { created: now },
  }
  storage.updateMessage(compactionUser)
  storage.updatePart({
    id: randomUUID(),
    messageID: compactionUser.id,
    sessionID,
    type: "compaction",
    auto: true,
    tail_start_id: tailStartID,
  })

  // 总结 assistant 消息
  const summaryMsg = {
    id: randomUUID(),
    sessionID,
    role: "assistant" as const,
    summary: true,
    parentID: compactionUser.id,
    time: { created: now + 1 },
  }
  storage.updateMessage(summaryMsg)
  storage.updatePart({
    id: randomUUID(),
    messageID: summaryMsg.id,
    sessionID,
    type: "text",
    text: summary,
  })

  // 合成 continue 消息驱动后续轮次
  const contMsg = {
    id: randomUUID(),
    sessionID,
    role: "user" as const,
    time: { created: now + 2 },
  }
  storage.updateMessage(contMsg)
  storage.updatePart({
    id: randomUUID(),
    messageID: contMsg.id,
    sessionID,
    type: "text",
    text: CONTINUE_MESSAGE,
  })
  return "continue"
}
