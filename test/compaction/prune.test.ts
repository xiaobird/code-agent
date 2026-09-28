import { expect, test } from "vitest"
import { Storage } from "../../src/storage/db"
import { prune } from "../../src/compaction/prune"

// 15,000 token 的 output = 60,000 字符
const bigOutput = (tag: string) => `${tag} ${"x".repeat(60000 - tag.length - 1)}`

function seedToolParts(storage: Storage, sessionID: string, outputs: string[]): string[] {
  return outputs.map((output, i) => {
    const id = `a${i + 1}`
    storage.updateMessage({ id, sessionID, role: "assistant", time: { created: i + 1 } })
    const pid = `p${i + 1}`
    storage.updatePart({
      id: pid,
      messageID: id,
      sessionID,
      type: "tool",
      tool: "read",
      callID: `c${i + 1}`,
      state: {
        status: "completed",
        input: {},
        output,
        title: "x",
        metadata: {},
        time: { start: i + 1, end: i + 2 },
      },
    })
    return pid
  })
}

function compactedFlag(storage: Storage, sessionID: string, partID: string): boolean {
  const part = storage
    .messagesWithParts(sessionID)
    .flatMap((m) => m.parts)
    .find((p) => p.id === partID)
  return !!(part && part.type === "tool" && part.state.status === "completed" && part.state.time.compacted)
}

test("prunes oldest outputs beyond the 40k protection window", async () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  // 5 × 15k = 75k；保护 newest 3（累计 45k 前 ≤40k），清理 p1+p2 = 30k ≥ 20k
  const ids = seedToolParts(storage, session.id, [bigOutput("a"), bigOutput("b"), bigOutput("c"), bigOutput("d"), bigOutput("e")])
  const freed = await prune(storage, session.id)
  expect(freed).toBe(30000)
  expect(compactedFlag(storage, session.id, ids[0])).toBe(true)
  expect(compactedFlag(storage, session.id, ids[1])).toBe(true)
  expect(compactedFlag(storage, session.id, ids[2])).toBe(false)
  expect(compactedFlag(storage, session.id, ids[3])).toBe(false)
  expect(compactedFlag(storage, session.id, ids[4])).toBe(false)
})

test("does nothing when prunable total below 20k minimum", async () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  // 4 × 15k = 60k；保护 newest 3（45k），仅 p1 可清 = 15k < 20k → 放弃
  const ids = seedToolParts(storage, session.id, [bigOutput("a"), bigOutput("b"), bigOutput("c"), bigOutput("d")])
  const freed = await prune(storage, session.id)
  expect(freed).toBe(0)
  for (const id of ids) expect(compactedFlag(storage, session.id, id)).toBe(false)
})

test("skips the most recent 2 user turns entirely", async () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  // turn1: 巨量 output；turn2/turn3 也巨量 —— 但都在最近 2 个 user 轮次内，全部跳过
  const ids: string[] = []
  for (let t = 1; t <= 3; t++) {
    storage.updateMessage({ id: `u${t}`, sessionID: session.id, role: "user", time: { created: t * 10 } })
    storage.updatePart({ id: `up${t}`, messageID: `u${t}`, sessionID: session.id, type: "text", text: `q${t}` })
    const aid = `ta${t}`
    storage.updateMessage({ id: aid, sessionID: session.id, role: "assistant", parentID: `u${t}`, time: { created: t * 10 + 1 } })
    const pid = `tp${t}`
    storage.updatePart({
      id: pid, messageID: aid, sessionID: session.id, type: "tool", tool: "read", callID: `tc${t}`,
      state: { status: "completed", input: {}, output: bigOutput(`t${t}`), title: "x", metadata: {}, time: { start: 1, end: 2 } },
    })
    ids.push(pid)
  }
  const freed = await prune(storage, session.id)
  expect(freed).toBe(0) // turn1 也只是 15k < 20k，且 turn2/3 被跳过
  for (const id of ids) expect(compactedFlag(storage, session.id, id)).toBe(false)
})

test("already compacted parts are not re-counted", async () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  // p1 已 compacted；保护窗口只看未清理的 output
  const ids = seedToolParts(storage, session.id, [bigOutput("a"), bigOutput("b"), bigOutput("c"), bigOutput("d"), bigOutput("e")])
  const part1 = storage.messagesWithParts(session.id).flatMap((m) => m.parts).find((p) => p.id === ids[0])!
  storage.updatePart({ ...(part1 as object), state: { ...(part1 as { state: object }).state, time: { start: 1, end: 2, compacted: 999 } } } as never)
  const freed = await prune(storage, session.id)
  // 未清理的 p2..p5 = 60k；保护 newest 3 → 可清 p2 = 15k < 20k → 0
  expect(freed).toBe(0)
  expect(compactedFlag(storage, session.id, ids[1])).toBe(false)
})
