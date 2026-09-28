import { expect, test } from "vitest"
import { toModelMessages, hasPendingToolCalls } from "../../src/session/message"

const base = { sessionID: "s1" }
test("tool call pair becomes assistant tool-call + tool result", () => {
  const msgs = [
    { info: { ...base, id: "u1", role: "user" as const }, parts: [{ ...base, id: "p1", messageID: "u1", type: "text" as const, text: "hi" }] },
    { info: { ...base, id: "a1", role: "assistant" as const }, parts: [
      { ...base, id: "p2", messageID: "a1", type: "tool" as const, tool: "read", callID: "c1",
        state: { status: "completed" as const, input: { filePath: "/x" }, output: "file content", title: "x", metadata: {}, time: { start: 1, end: 2 } } },
    ]},
  ]
  const out = toModelMessages(msgs)
  expect(out[0]).toMatchObject({ role: "user" })
  expect(out[1].role).toBe("assistant")
  expect(out[2].role).toBe("tool")
})

test("compacted tool output is cleared", () => {
  const msgs = [{ info: { ...base, id: "a1", role: "assistant" as const }, parts: [
    { ...base, id: "p2", messageID: "a1", type: "tool" as const, tool: "read", callID: "c1",
      state: { status: "completed" as const, input: {}, output: "huge...", title: "", metadata: {}, time: { start: 1, end: 2, compacted: 3 } } },
  ]}]
  const out = toModelMessages(msgs)
  expect(JSON.stringify(out)).toContain("[Old tool result content cleared]")
  expect(JSON.stringify(out)).not.toContain("huge...")
})

test("pending tool call detection", () => {
  const msg = { info: { ...base, id: "a1", role: "assistant" as const, finish: "stop" }, parts: [
    { ...base, id: "p2", messageID: "a1", type: "tool" as const, tool: "read", callID: "c1",
      state: { status: "running" as const, input: {}, time: { start: 1 } } },
  ]}
  expect(hasPendingToolCalls(msg)).toBe(true)
})
