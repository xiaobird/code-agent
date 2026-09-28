import { expect, test } from "vitest"
import { Storage } from "../../src/storage/db"
import { processTurn } from "../../src/session/processor"
import { registerTool } from "../../src/tool/registry"
import { scriptedModel, text, toolCall, finish } from "../helpers/model"

const noopTool = () => {
  registerTool({
    id: "noop",
    description: "",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ title: "noop", output: "done" }),
  })
}

test("tool call flows to storage and returns continue", async () => {
  noopTool()
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  storage.updateMessage({ id: "u1", sessionID: session.id, role: "user", time: { created: 1 } })
  storage.updatePart({ id: "p0", messageID: "u1", sessionID: session.id, type: "text", text: "hi" })
  storage.updateMessage({ id: "a1", sessionID: session.id, role: "assistant", parentID: "u1", time: { created: 2 } })

  const model = scriptedModel([[toolCall("c1", "noop", {}), finish("tool-calls", 10, 5)]])
  const result = await processTurn({
    storage,
    sessionID: session.id,
    assistantMsg: { id: "a1", sessionID: session.id, role: "assistant", time: { created: 2 } },
    model,
    modelInfo: { contextLimit: 100000 },
    system: [],
    messages: storage.messagesWithParts(session.id),
    ask: async () => {},
    onText: () => {},
    abort: new AbortController().signal,
  })
  expect(result).toBe("continue")
  const msgs = storage.messagesWithParts(session.id)
  const toolPart = msgs[1].parts.find((p) => p.type === "tool")
  expect(toolPart).toBeDefined()
  if (toolPart?.type === "tool") {
    expect(toolPart.state.status).toBe("completed")
    expect(toolPart.state.output).toBe("done")
  }
})

test("text streams through onText and is persisted", async () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  storage.updateMessage({ id: "u1", sessionID: session.id, role: "user", time: { created: 1 } })
  storage.updatePart({ id: "p0", messageID: "u1", sessionID: session.id, type: "text", text: "hi" })
  storage.updateMessage({ id: "a1", sessionID: session.id, role: "assistant", time: { created: 2 } })

  const seen: string[] = []
  const model = scriptedModel([[...text("hello "), ...text("world"), finish("stop", 1, 1)]])
  const result = await processTurn({
    storage,
    sessionID: session.id,
    assistantMsg: { id: "a1", sessionID: session.id, role: "assistant", time: { created: 2 } },
    model,
    modelInfo: { contextLimit: 100000 },
    system: [],
    messages: storage.messagesWithParts(session.id),
    ask: async () => {},
    onText: (d) => seen.push(d),
    abort: new AbortController().signal,
  })
  expect(result).toBe("continue") // 退出判断由 runLoop 基于 DB 状态负责
  expect(seen.join("")).toBe("hello world")
  const msgs = storage.messagesWithParts(session.id)
  const textPart = msgs[1].parts.find((p) => p.type === "text")
  expect(textPart).toMatchObject({ type: "text", text: "hello world" })
  expect(msgs[1].info.finish).toBe("stop")
  expect(msgs[1].info.tokens).toMatchObject({ input: 1, output: 1 })
})

test("error event marks message error and returns stop", async () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  storage.updateMessage({ id: "u1", sessionID: session.id, role: "user", time: { created: 1 } })
  storage.updatePart({ id: "p0", messageID: "u1", sessionID: session.id, type: "text", text: "hi" })
  storage.updateMessage({ id: "a1", sessionID: session.id, role: "assistant", time: { created: 2 } })

  const model = scriptedModel([[{ type: "error", error: new Error("boom") }]])
  const result = await processTurn({
    storage,
    sessionID: session.id,
    assistantMsg: { id: "a1", sessionID: session.id, role: "assistant", time: { created: 2 } },
    model,
    modelInfo: { contextLimit: 100000 },
    system: [],
    messages: storage.messagesWithParts(session.id),
    ask: async () => {},
    onText: () => {},
    abort: new AbortController().signal,
  })
  expect(result).toBe("stop")
  expect(storage.messagesWithParts(session.id)[1].info.finish).toBe("error")
})

test("token overflow returns compact", async () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  storage.updateMessage({ id: "u1", sessionID: session.id, role: "user", time: { created: 1 } })
  storage.updatePart({ id: "p0", messageID: "u1", sessionID: session.id, type: "text", text: "hi" })
  storage.updateMessage({ id: "a1", sessionID: session.id, role: "assistant", time: { created: 2 } })

  const model = scriptedModel([[finish("stop", 99999, 1)]])
  const result = await processTurn({
    storage,
    sessionID: session.id,
    assistantMsg: { id: "a1", sessionID: session.id, role: "assistant", time: { created: 2 } },
    model,
    modelInfo: { contextLimit: 100000 },
    system: [],
    messages: storage.messagesWithParts(session.id),
    ask: async () => {},
    onText: () => {},
    abort: new AbortController().signal,
  })
  expect(result).toBe("compact")
})
