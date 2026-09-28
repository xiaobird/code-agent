import type { MessageWithParts } from "../session/message"
import { estimateTokens } from "../util/token"

export interface TailSelection {
  head: MessageWithParts[] // 待总结的头部
  tail: MessageWithParts[] // 保留的尾部
  tailStartID?: string
}

function isTurnStart(m: MessageWithParts): boolean {
  if (m.info.role !== "user") return false
  // 含 compaction part 的 user 消息不开启新 turn
  return !m.parts.some((p) => p.type === "compaction")
}

function tokensOf(m: MessageWithParts): number {
  return estimateTokens(JSON.stringify(m))
}

/** 以 user 消息划 turn；从最新 turn 往回在预算内保留，不足一整 turn 时按消息粒度切 */
export function selectTail(msgs: MessageWithParts[], budget: number): TailSelection {
  if (msgs.length === 0) return { head: [], tail: [], tailStartID: undefined }

  const turnStarts: number[] = []
  for (let i = 0; i < msgs.length; i++) if (isTurnStart(msgs[i])) turnStarts.push(i)

  let remaining = budget
  let cut = -1

  for (let t = turnStarts.length - 1; t >= 0; t--) {
    const start = turnStarts[t]
    const end = t + 1 < turnStarts.length ? turnStarts[t + 1] : msgs.length
    const turnTokens = msgs.slice(start, end).reduce((s, m) => s + tokensOf(m), 0)
    if (turnTokens <= remaining) {
      remaining -= turnTokens
      cut = start
      continue
    }
    // 整轮放不下：在轮内从最新消息往回逐条纳入
    let inner = end
    for (let i = end - 1; i >= start; i--) {
      if (tokensOf(msgs[i]) > remaining) break
      remaining -= tokensOf(msgs[i])
      inner = i
    }
    if (inner < end) cut = inner
    break // 更旧的 turn 不再考虑
  }

  if (cut === -1) cut = msgs.length - 1 // 预算连最新一条都放不下：保底保留最后一条
  return {
    head: msgs.slice(0, cut),
    tail: msgs.slice(cut),
    tailStartID: msgs[cut]?.info.id,
  }
}
