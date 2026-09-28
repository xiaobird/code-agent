import type { Storage } from "../storage/db"
import { estimateTokens } from "../util/token"

export const PRUNE_PROTECT_TOKENS = 40_000
export const PRUNE_MIN_CLEAN_TOKENS = 20_000
export const PRUNE_SKIP_RECENT_TURNS = 2

/**
 * 从最新往回扫描工具输出：
 * - 最近 2 个 user 轮次内的 part 一律不动
 * - 未累计满 40k token 的较新 output 保护（累计"之前"≤40k 的那一段）
 * - 更旧的标记 compacted；总清理量 < 20k 则全部放弃
 * 返回实际清理的 token 数。
 */
export async function prune(storage: Storage, sessionID: string): Promise<number> {
  const msgs = storage.messagesWithParts(sessionID)

  // 最近 N 个 user 轮次起点之后的消息（含起点）全部跳过
  const userIds = msgs.filter((m) => m.info.role === "user").map((m) => m.info.id)
  const skipFromId = userIds[Math.max(0, userIds.length - PRUNE_SKIP_RECENT_TURNS)]
  const skipFromIndex = skipFromId ? msgs.findIndex((m) => m.info.id === skipFromId) : -1

  const toolParts: { part: Extract<(typeof msgs)[number]["parts"][number], { type: "tool" }>; tokens: number }[] = []
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (i >= skipFromIndex && skipFromIndex >= 0) continue
    for (const part of msgs[i].parts) {
      if (part.type !== "tool" || part.state.status !== "completed") continue
      if (part.state.time.compacted) continue
      toolParts.push({ part, tokens: estimateTokens(part.state.output) })
    }
  }

  let cumulative = 0
  const toPrune: typeof toolParts = []
  for (const { part, tokens } of toolParts) {
    if (cumulative <= PRUNE_PROTECT_TOKENS) {
      cumulative += tokens
      continue
    }
    toPrune.push({ part, tokens })
  }

  const total = toPrune.reduce((s, x) => s + x.tokens, 0)
  if (total < PRUNE_MIN_CLEAN_TOKENS) return 0

  const now = Date.now()
  for (const { part } of toPrune) {
    if (part.state.status !== "completed") continue
    storage.updatePart({
      ...part,
      state: {
        ...part.state,
        time: { ...part.state.time, compacted: now },
      },
    })
  }
  return total
}
