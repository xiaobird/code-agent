import { expect, test } from "vitest"
import { Storage } from "../../src/storage/db"
import { createTaskExecutor, registerTaskTool } from "../../src/tool/task"
import { getTools } from "../../src/tool/registry"
import { scriptedModel, text, finish } from "../helpers/model"

const ctx = { sessionID: "", abort: new AbortController().signal, ask: async () => {}, metadata: async () => {} }

test("task spawns explore subagent and returns its final text", async () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  storage.updateMessage({ id: "u1", sessionID: session.id, role: "user", time: { created: 1 } })
  storage.updatePart({ id: "p0", messageID: "u1", sessionID: session.id, type: "text", text: "find it" })

  const model = scriptedModel([
    [...text("found 3 files"), finish("stop", 1, 1)], // 子 agent 轮
  ])
  const execute = createTaskExecutor({
    storage,
    model,
    modelInfo: { contextLimit: 100000 },
    baseSystem: [],
  })
  const result = await execute(
    { subagent_type: "explore", prompt: "find all usages", description: "locate usages" },
    { ...ctx, sessionID: session.id },
  )
  expect(result.output).toBe("found 3 files")
  expect(result.title).toBe("locate usages")

  // 子 session 已建且 parent 指向父
  const allSessions = (storage as unknown as { db: { prepare: (s: string) => { all: () => unknown[] } } })
  const rows = allSessions.db.prepare("SELECT id, parent_id FROM session").all() as { id: string; parent_id: string | null }[]
  const child = rows.find((r) => r.parent_id === session.id)
  expect(child).toBeDefined()

  // 子 session 的 parts 不进父 session
  const parentParts = storage.messagesWithParts(session.id).flatMap((m) => m.parts)
  expect(parentParts.every((p) => p.sessionID === session.id)).toBe(true)
})

test("task denied inside subagent session (depth ≥ 1)", async () => {
  const storage = new Storage(":memory:")
  const parent = storage.createSession({ directory: "/tmp" })
  const child = storage.createSession({ directory: "/tmp", parentID: parent.id })
  const model = scriptedModel([[finish("stop", 1, 1)]])
  const execute = createTaskExecutor({ storage, model, modelInfo: { contextLimit: 100000 }, baseSystem: [] })
  await expect(
    execute({ subagent_type: "explore", prompt: "x", description: "x" }, { ...ctx, sessionID: child.id }),
  ).rejects.toThrow("not available inside a subagent")
})

test("unknown subagent type rejected", async () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  const model = scriptedModel([[finish("stop", 1, 1)]])
  const execute = createTaskExecutor({ storage, model, modelInfo: { contextLimit: 100000 }, baseSystem: [] })
  await expect(
    execute({ subagent_type: "nope", prompt: "x", description: "x" }, { ...ctx, sessionID: session.id }),
  ).rejects.toThrow("Unknown subagent type")
})

test("registerTaskTool registers 'task' in the global registry", () => {
  const storage = new Storage(":memory:")
  const model = scriptedModel([[finish("stop", 1, 1)]])
  registerTaskTool({ storage, model, modelInfo: { contextLimit: 200000 }, baseSystem: [] })
  expect(getTools().some((t) => t.id === "task")).toBe(true)
})

test("main agent is not a valid subagent_type", async () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  const model = scriptedModel([[finish("stop", 1, 1)]])
  const execute = createTaskExecutor({ storage, model, modelInfo: { contextLimit: 100000 }, baseSystem: [] })
  await expect(
    execute({ subagent_type: "main", prompt: "x", description: "x" }, { ...ctx, sessionID: session.id }),
  ).rejects.toThrow("Unknown subagent type")
})
