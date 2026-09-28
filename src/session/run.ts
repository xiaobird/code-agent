import { randomUUID } from "crypto"
import type { LanguageModel } from "ai"
import type { Storage } from "../storage/db"
import { filterCompacted, hasPendingToolCalls, latest, type MessageWithParts } from "./message"
import { processTurn, type ProcessInput } from "./processor"
import { isOverflow } from "../compaction/overflow"
import { prune } from "../compaction/prune"
import { compact } from "../compaction/index"

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

    // 溢出预防：上轮 token 超限 → 先压缩再继续
    if (lastAssistant?.tokens && isOverflow(lastAssistant.tokens as never, input.modelInfo.contextLimit)) {
      const r = await compact(storage, sessionID, input.model, input.modelInfo)
      if (r === "stop") break
      continue
    }

    const assistantMsg = {
      id: randomUUID(),
      sessionID,
      role: "assistant" as const,
      parentID: lastUser.id,
      time: { created: Date.now() },
    }
    storage.updateMessage(assistantMsg)

    const result = await processTurn({ ...input, assistantMsg, messages: msgs })
    // 每轮结束后台清理旧工具输出（失败不影响主流程）
    void prune(storage, sessionID).catch(() => {})
    if (result === "stop") break
    if (result === "compact") {
      const r = await compact(storage, sessionID, input.model, input.modelInfo)
      if (r === "stop") break
      continue
    }
  }
}
