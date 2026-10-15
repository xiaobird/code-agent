import { randomUUID } from "crypto"
import type { LanguageModel } from "ai"
import type { Storage } from "../storage/db"
import { filterCompacted, hasPendingToolCalls, latest, type MessageWithParts } from "./message"
import { processTurn, type ProcessInput } from "./processor"
import { isOverflow } from "../compaction/overflow"
import { prune } from "../compaction/prune"
import { compact } from "../compaction/index"
import { initSnapshot, track, patch, snapshotActive } from "../snapshot/index"

export interface RunInput {
  storage: Storage
  sessionID: string
  model: LanguageModel
  modelInfo: { contextLimit: number }
  system: string[]
  ask: ProcessInput["ask"]
  onText: (d: string) => void
  onReasoning?: ProcessInput["onReasoning"]
  onToolStart?: ProcessInput["onToolStart"]
  onToolEnd?: ProcessInput["onToolEnd"]
  worktree?: string // 启用影子快照时的 worktree 路径
  abort: AbortSignal
}

export async function runLoop(input: RunInput): Promise<void> {
  const { storage, sessionID } = input
  if (input.worktree) initSnapshot(input.worktree)
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

    // 溢出预防：当前轮刚结束的 assistant token 超限 → 先压缩再继续
    // （仅当 assistant 属于当前 user 轮；旧轮的溢出记录不重复触发）
    if (
      lastAssistant?.tokens &&
      lastAssistant.parentID === lastUser.id &&
      isOverflow(lastAssistant.tokens as never, input.modelInfo.contextLimit)
    ) {
      const r = await compact(storage, sessionID, input.model, input.modelInfo)
      if (r === "stop") break
      continue
    }

    // 时间戳必须严格大于会话内最后一条消息，避免同毫秒排序退化到随机 UUID
    const lastCreated = msgs.at(-1)?.info.time?.created ?? 0
    const assistantMsg = {
      id: randomUUID(),
      sessionID,
      role: "assistant" as const,
      parentID: lastUser.id,
      time: { created: Math.max(Date.now(), lastCreated + 1) },
    }
    storage.updateMessage(assistantMsg)

    const beforeHash = snapshotActive() ? await track() : undefined
    const result = await processTurn({ ...input, assistantMsg, messages: msgs })
    if (beforeHash && snapshotActive()) {
      const afterHash = await track()
      if (afterHash && afterHash !== beforeHash) {
        const p = await patch(beforeHash, afterHash).catch(() => undefined)
        if (p)
          storage.updatePart({
            id: randomUUID(),
            messageID: assistantMsg.id,
            sessionID,
            type: "patch",
            hash: afterHash,
            fromHash: beforeHash,
            files: p.files,
          })
      }
    }
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
