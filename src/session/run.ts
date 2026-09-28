import { randomUUID } from "crypto"
import type { LanguageModel } from "ai"
import type { Storage } from "../storage/db"
import { filterCompacted, hasPendingToolCalls, latest, type MessageWithParts } from "./message"
import { processTurn, type ProcessInput } from "./processor"
import { isOverflow } from "../compaction/overflow"

export interface RunInput {
  storage: Storage
  sessionID: string
  model: LanguageModel
  modelInfo: { contextLimit: number }
  system: string[]
  ask: ProcessInput["ask"]
  onText: (d: string) => void
  onToolStart?: ProcessInput["onToolStart"]
  onToolEnd?: ProcessInput["onToolEnd"]
  abort: AbortSignal
}

export async function runLoop(input: RunInput): Promise<void> {
  const { storage, sessionID } = input
  while (true) {
    const msgs: MessageWithParts[] = filterCompacted(storage.messagesWithParts(sessionID))
    const { lastUser, lastAssistant } = latest(msgs)
    if (!lastUser) throw new Error("No user message found")

    const lastAssistantMsg = msgs.findLast((m) => m.info.id === lastAssistant?.id)
    const pending = lastAssistantMsg ? hasPendingToolCalls(lastAssistantMsg) : false
    if (
      lastAssistant?.finish &&
      lastAssistant.finish !== "tool-calls" &&
      !pending &&
      lastAssistant.parentID === lastUser.id
    )
      break

    // 溢出预防：上轮 token 超限 → 本任务先 break（Task 20 接入压缩）
    if (lastAssistant?.tokens && isOverflow(lastAssistant.tokens as never, input.modelInfo.contextLimit)) break

    const assistantMsg = {
      id: randomUUID(),
      sessionID,
      role: "assistant" as const,
      parentID: lastUser.id,
      time: { created: Date.now() },
    }
    storage.updateMessage(assistantMsg)

    const result = await processTurn({ ...input, assistantMsg, messages: msgs })
    if (result === "stop") break
    if (result === "compact") break // Task 20 替换为压缩后续跑
  }
}
