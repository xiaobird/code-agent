import type { Storage } from "../storage/db"

/** 即将执行的调用与最近 2 个已完成 tool part 完全相同（工具 + 入参）→ doom loop */
export function checkDoomLoop(
  storage: Storage,
  sessionID: string,
  toolName: string,
  input: unknown,
): boolean {
  const msgs = storage.messagesWithParts(sessionID)
  const toolParts = msgs
    .flatMap((m) => m.parts)
    .filter((p): p is Extract<typeof p, { type: "tool" }> => p.type === "tool")
  const lastTwo = toolParts.slice(-2)
  if (lastTwo.length < 2) return false
  const inputJSON = JSON.stringify(input ?? {})
  return lastTwo.every(
    (p) => p.tool === toolName && JSON.stringify(p.state.input ?? {}) === inputJSON,
  )
}
