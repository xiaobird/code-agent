import { expect, test } from "vitest"
import { selectTail } from "../../src/compaction/select"
import type { MessageWithParts } from "../../src/session/message"

// 每条消息 ~1000 token（JSON.stringify 后约 4000 字符）
function msg(id: string, role: "user" | "assistant", pad = 3900): MessageWithParts {
  const text = role === "user" ? `q-${id} ` + "u".repeat(pad) : `a-${id} ` + "s".repeat(pad)
  return {
    info: { id, sessionID: "s1", role, time: { created: 1 } },
    parts: [{ id: `p-${id}`, messageID: id, sessionID: "s1", type: "text", text }],
  }
}

function fiveTurns(): MessageWithParts[] {
  const out: MessageWithParts[] = []
  for (let t = 1; t <= 5; t++) {
    out.push(msg(`u${t}`, "user"))
    out.push(msg(`a${t}-1`, "assistant"))
    out.push(msg(`a${t}-2`, "assistant"))
  }
  return out
}

const tok = (ms: MessageWithParts[]) =>
  ms.reduce((sum, m) => sum + Math.ceil(JSON.stringify(m).length / 4), 0)

test("budget covering last 2 turns keeps them whole", () => {
  const msgs = fiveTurns()
  const { head, tailStartID } = selectTail(msgs, tok(msgs.slice(9)))
  expect(tailStartID).toBe("u4")
  expect(head.at(-1)?.info.id).toBe("a3-2")
  expect(head).toHaveLength(9)
})

test("partial budget keeps last turn plus message-level split", () => {
  const msgs = fiveTurns()
  const budget = tok(msgs.slice(12)) + tok([msgs[11]]) // turn5 整轮 + a4-2 一条
  const { head, tailStartID } = selectTail(msgs, budget)
  expect(tailStartID).toBe("a4-2") // turn5 整轮 + turn4 最新一条
  expect(head.at(-1)?.info.id).toBe("a4-1")
})

test("budget smaller than one message still keeps the last message", () => {
  const msgs = fiveTurns()
  const { tailStartID } = selectTail(msgs, 10)
  expect(tailStartID).toBe("a5-2") // 至少保留最后一条
})

test("compaction user message does not start a turn", () => {
  const msgs = fiveTurns()
  const compactionUser: MessageWithParts = {
    info: { id: "cu", sessionID: "s1", role: "user", time: { created: 2 } },
    parts: [{ id: "cp", messageID: "cu", sessionID: "s1", type: "compaction", auto: true }],
  }
  const summary: MessageWithParts = msg("sum", "assistant")
  const all = [...msgs.slice(0, 12), compactionUser, summary, ...msgs.slice(12)]
  // 12 条 = 4 turns；compaction 用户消息接在后面，不开启新 turn → 属于第 4 turn
  const { tailStartID } = selectTail(all, tok(all.slice(9)))
  expect(tailStartID).toBe("u4") // 最近 2 个"真" user turn 仍是 u4 起
})

test("all fits within budget → empty head", () => {
  const msgs = fiveTurns()
  const { head, tailStartID } = selectTail(msgs, 999999)
  expect(head).toHaveLength(0)
  expect(tailStartID).toBe("u1")
})
