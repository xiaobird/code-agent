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

test("loop breaks on token overflow (pre-compaction behavior)", async () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  storage.updateMessage({ id: "u1", sessionID: session.id, role: "user", time: { created: 1 } })
  storage.updatePart({ id: "p0", messageID: "u1", sessionID: session.id, type: "text", text: "hi" })

  const model = scriptedModel([[finish("stop", 99999, 1)]])
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
