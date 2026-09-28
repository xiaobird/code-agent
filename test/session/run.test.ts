import { expect, test } from "vitest"
import { Storage } from "../../src/storage/db"
import { runLoop } from "../../src/session/run"
import { registerTool } from "../../src/tool/registry"
import { scriptedModel, text, toolCall, finish } from "../helpers/model"

test("loop continues on tool-calls, breaks on stop", async () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  storage.updateMessage({ id: "u1", sessionID: session.id, role: "user", time: { created: 1 } })
  storage.updatePart({ id: "p0", messageID: "u1", sessionID: session.id, type: "text", text: "hi" })
  registerTool({
    id: "noop",
    description: "",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ title: "noop", output: "done" }),
  })

  const model = scriptedModel([
    [toolCall("c1", "noop", {}), finish("tool-calls", 1, 1)],
    [...text("done"), finish("stop", 1, 1)],
  ])
  await runLoop({
    storage,
    sessionID: session.id,
    model,
    modelInfo: { contextLimit: 100000 },
    system: [],
    ask: async () => {},
    onText: () => {},
    abort: new AbortController().signal,
  })
  const msgs = storage.messagesWithParts(session.id)
  const assistants = msgs.filter((m) => m.info.role === "assistant")
  expect(assistants).toHaveLength(2)
  expect(assistants[1].info.finish).toBe("stop")
})

test("loop breaks on error turn", async () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  storage.updateMessage({ id: "u1", sessionID: session.id, role: "user", time: { created: 1 } })
  storage.updatePart({ id: "p0", messageID: "u1", sessionID: session.id, type: "text", text: "hi" })

  const model = scriptedModel([[{ type: "error", error: new Error("boom") }]])
  await runLoop({
    storage,
    sessionID: session.id,
    model,
    modelInfo: { contextLimit: 100000 },
    system: [],
    ask: async () => {},
    onText: () => {},
    abort: new AbortController().signal,
  })
  expect(storage.messagesWithParts(session.id).filter((m) => m.info.role === "assistant")).toHaveLength(1)
})

test("token overflow triggers compaction then continues", async () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  // 旧 turn：大工具输出（约 10k token，超出 8k 压缩预算 → head 非空）
  storage.updateMessage({ id: "u1", sessionID: session.id, role: "user", time: { created: 1 } })
  storage.updatePart({ id: "p0", messageID: "u1", sessionID: session.id, type: "text", text: "read everything" })
  storage.updateMessage({ id: "a1", sessionID: session.id, role: "assistant", parentID: "u1", time: { created: 2 } })
  storage.updatePart({
    id: "ap1", messageID: "a1", sessionID: session.id, type: "tool", tool: "read", callID: "c1",
    state: { status: "completed", input: {}, output: "x".repeat(40000), title: "r", metadata: {}, time: { start: 1, end: 2 } },
  })
  // 当前 turn：触发溢出
  storage.updateMessage({ id: "u2", sessionID: session.id, role: "user", time: { created: 3 } })
  storage.updatePart({ id: "p1", messageID: "u2", sessionID: session.id, type: "text", text: "continue" })

  // turn1: 溢出；turn2: 压缩总结；turn3: 正常结束
  const model = scriptedModel([
    [finish("stop", 99999, 1)],
    [...text("## Objective\n- test"), finish("stop", 1, 1)],
    [...text("resumed"), finish("stop", 1, 1)],
  ])
  await runLoop({
    storage,
    sessionID: session.id,
    model,
    modelInfo: { contextLimit: 100000 },
    system: [],
    ask: async () => {},
    onText: () => {},
    abort: new AbortController().signal,
  })
  const msgs = storage.messagesWithParts(session.id)
  expect(msgs.some((m) => m.info.summary === true)).toBe(true)
  expect(msgs.some((m) => m.parts.some((p) => p.type === "compaction"))).toBe(true)
  const lastAssistant = msgs.findLast((m) => m.info.role === "assistant")
  expect(lastAssistant?.parts[0]).toMatchObject({ type: "text", text: "resumed" })
})
