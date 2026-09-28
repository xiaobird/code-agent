import { expect, test } from "vitest"
import { Storage } from "../../src/storage/db"
import { compact } from "../../src/compaction/index"
import { scriptedModel, text, finish } from "../helpers/model"

function seedOverflowSession(storage: Storage): string {
  const session = storage.createSession({ directory: "/tmp" })
  // turn1（旧）：大输出工具
  storage.updateMessage({ id: "u1", sessionID: session.id, role: "user", time: { created: 1 } })
  storage.updatePart({ id: "up1", messageID: "u1", sessionID: session.id, type: "text", text: "do stuff" })
  storage.updateMessage({ id: "a1", sessionID: session.id, role: "assistant", parentID: "u1", time: { created: 2 } })
  storage.updatePart({
    id: "ap1", messageID: "a1", sessionID: session.id, type: "tool", tool: "read", callID: "c1",
    state: { status: "completed", input: {}, output: "x".repeat(40000), title: "r", metadata: {}, time: { start: 1, end: 2 } },
  })
  // turn2（新）：触发溢出的 assistant
  storage.updateMessage({ id: "u2", sessionID: session.id, role: "user", time: { created: 3 } })
  storage.updatePart({ id: "up2", messageID: "u2", sessionID: session.id, type: "text", text: "continue" })
  storage.updateMessage({
    id: "a2", sessionID: session.id, role: "assistant", parentID: "u2", time: { created: 4 },
    tokens: { input: 99000, output: 100, total: 99100, cache: { read: 0, write: 0 } },
  })
  storage.updatePart({ id: "ap2", messageID: "a2", sessionID: session.id, type: "text", text: "partial answer" })
  return session.id
}

test("compact summarizes head and injects continuation", async () => {
  const storage = new Storage(":memory:")
  const sessionID = seedOverflowSession(storage)
  const model = scriptedModel([[...text("## Objective\n- build the thing"), finish("stop", 1, 1)]])

  const result = await compact(storage, sessionID, model, { contextLimit: 100000 })
  expect(result).toBe("continue")

  const msgs = storage.messagesWithParts(sessionID)
  const summaryMsg = msgs.find((m) => m.info.summary === true)
  expect(summaryMsg).toBeDefined()
  expect(summaryMsg?.info.role).toBe("assistant")
  expect(summaryMsg?.parts[0]).toMatchObject({ type: "text", text: expect.stringContaining("Objective") })

  const compactionUser = msgs.find((m) => m.parts.some((p) => p.type === "compaction"))
  expect(compactionUser?.info.role).toBe("user")
  const cp = compactionUser?.parts.find((p) => p.type === "compaction")
  expect(cp && cp.type === "compaction" && cp.tail_start_id).toBeTruthy()

  const lastUser = msgs.findLast((m) => m.info.role === "user")
  expect(lastUser?.parts[0]).toMatchObject({ type: "text", text: expect.stringContaining("Continue") })
})

test("compact returns stop on LLM error", async () => {
  const storage = new Storage(":memory:")
  const sessionID = seedOverflowSession(storage)
  const model = scriptedModel([[{ type: "error", error: new Error("summarizer down") }]])
  const result = await compact(storage, sessionID, model, { contextLimit: 100000 })
  expect(result).toBe("stop")
})
