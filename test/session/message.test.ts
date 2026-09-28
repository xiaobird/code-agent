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

import { filterCompacted } from "../../src/session/message"

function build(id: string, role: "user" | "assistant", parts: unknown[], summary = false): { info: { id: string; sessionID: string; role: string; summary?: boolean }; parts: unknown[] } {
  return { info: { id, sessionID: "s1", role, ...(summary ? { summary: true } : {}) }, parts }
}

test("filterCompacted drops head, keeps anchor+summary+tail+new (insert layout)", () => {
  const msgs = [
    build("h1", "user", [{ type: "text", text: "old1" }]),
    build("h2", "assistant", [{ type: "text", text: "old2" }]),
    build("h3", "user", [{ type: "text", text: "old3" }]),
    build("cu", "user", [{ type: "compaction", auto: true, tail_start_id: "t1" }]),
    build("sum", "assistant", [{ type: "text", text: "summary" }], true),
    build("t1", "user", [{ type: "text", text: "tail1" }]),
    build("t2", "assistant", [{ type: "text", text: "tail2" }]),
    build("n1", "user", [{ type: "text", text: "new1" }]),
  ] as never
  const out = filterCompacted(msgs)
  expect(out.map((m: { info: { id: string } }) => m.info.id)).toEqual(["cu", "sum", "t1", "t2", "n1"])
})

test("filterCompacted with append layout (tail physically before compaction)", () => {
  const msgs = [
    build("h1", "user", [{ type: "text", text: "old1" }]),
    build("t1", "user", [{ type: "text", text: "tail1" }]),
    build("t2", "assistant", [{ type: "text", text: "tail2" }]),
    build("cu", "user", [{ type: "compaction", auto: true, tail_start_id: "t1" }]),
    build("sum", "assistant", [{ type: "text", text: "summary" }], true),
    build("n1", "user", [{ type: "text", text: "new1" }]),
  ] as never
  const out = filterCompacted(msgs)
  expect(out.map((m: { info: { id: string } }) => m.info.id)).toEqual(["cu", "sum", "t1", "t2", "n1"])
})

test("filterCompacted identity when no compaction part", () => {
  const msgs = [build("u1", "user", [{ type: "text", text: "hi" }])] as never
  expect(filterCompacted(msgs)).toHaveLength(1)
})
