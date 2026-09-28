import { expect, test } from "vitest"
import { Storage } from "../../src/storage/db"
import { checkDoomLoop } from "../../src/session/doom"
import { processTurn } from "../../src/session/processor"
import { registerTool } from "../../src/tool/registry"
import { scriptedModel, toolCall, finish } from "../helpers/model"

function seedToolPart(storage: Storage, sessionID: string, callID: string, input: Record<string, unknown>, created: number) {
  storage.updateMessage({ id: `m${callID}`, sessionID, role: "assistant", time: { created } })
  storage.updatePart({
    id: `p${callID}`, messageID: `m${callID}`, sessionID, type: "tool", tool: "read", callID,
    state: { status: "completed", input, output: "ok", title: "r", metadata: {}, time: { start: created, end: created + 1 } },
  })
}

test("three identical calls in a row detected", () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  seedToolPart(storage, session.id, "c1", { filePath: "/x" }, 1)
  seedToolPart(storage, session.id, "c2", { filePath: "/x" }, 2)
  expect(checkDoomLoop(storage, session.id, "read", { filePath: "/x" })).toBe(true)
})

test("different input or tool breaks the pattern", () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  seedToolPart(storage, session.id, "c1", { filePath: "/x" }, 1)
  seedToolPart(storage, session.id, "c2", { filePath: "/x" }, 2)
  expect(checkDoomLoop(storage, session.id, "read", { filePath: "/y" })).toBe(false)
  expect(checkDoomLoop(storage, session.id, "grep", { filePath: "/x" })).toBe(false)
})

test("fewer than two prior identical parts is not doom", () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  seedToolPart(storage, session.id, "c1", { filePath: "/x" }, 1)
  expect(checkDoomLoop(storage, session.id, "read", { filePath: "/x" })).toBe(false)
})

test("processor asks on doom_loop and stops when denied", async () => {
  registerTool({
    id: "noop2",
    description: "",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ title: "noop2", output: "done" }),
  })
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  storage.updateMessage({ id: "u1", sessionID: session.id, role: "user", time: { created: 1 } })
  storage.updatePart({ id: "up", messageID: "u1", sessionID: session.id, type: "text", text: "go" })

  const asked: string[] = []
  const denyDoom = async (req: { permission: string; patterns: string[] }) => {
    if (req.permission === "doom_loop") {
      asked.push(req.permission)
      throw new Error("Permission denied: doom_loop")
    }
  }

  const model = scriptedModel([
    [toolCall("c1", "noop2", {}), finish("tool-calls", 1, 1)],
    [toolCall("c2", "noop2", {}), finish("tool-calls", 1, 1)],
    [toolCall("c3", "noop2", {}), finish("tool-calls", 1, 1)], // 第三次 → doom
  ])

  let assistantID = 0
  const mkAssistant = () => {
    assistantID += 1
    const id = `da${assistantID}`
    storage.updateMessage({ id, sessionID: session.id, role: "assistant", time: { created: 10 + assistantID } })
    return { id, sessionID: session.id, role: "assistant" as const, time: { created: 10 + assistantID } }
  }

  // 依次跑三轮，第三轮应触发 doom 检测
  const a1 = mkAssistant()
  const r1 = await processTurn({
    storage, sessionID: session.id, assistantMsg: a1, model, modelInfo: { contextLimit: 100000 },
    system: [], messages: storage.messagesWithParts(session.id), ask: denyDoom, onText: () => {},
    abort: new AbortController().signal,
  })
  expect(r1).toBe("continue")
  const a2 = mkAssistant()
  const r2 = await processTurn({
    storage, sessionID: session.id, assistantMsg: a2, model, modelInfo: { contextLimit: 100000 },
    system: [], messages: storage.messagesWithParts(session.id), ask: denyDoom, onText: () => {},
    abort: new AbortController().signal,
  })
  expect(r2).toBe("continue")
  const a3 = mkAssistant()
  const r3 = await processTurn({
    storage, sessionID: session.id, assistantMsg: a3, model, modelInfo: { contextLimit: 100000 },
    system: [], messages: storage.messagesWithParts(session.id), ask: denyDoom, onText: () => {},
    abort: new AbortController().signal,
  })
  expect(r3).toBe("stop")
  expect(asked).toEqual(["doom_loop"])
})
