import { expect, test } from "vitest"
import { Storage } from "../../src/storage/db"

test("session/message/part roundtrip", () => {
  const s = new Storage(":memory:")
  const session = s.createSession({ directory: "/tmp/x" })
  s.updateMessage({ id: "m1", sessionID: session.id, role: "user", time: { created: 1 } })
  s.updatePart({ id: "p1", messageID: "m1", sessionID: session.id, type: "text", text: "hi" })
  const msgs = s.messagesWithParts(session.id)
  expect(msgs).toHaveLength(1)
  expect(msgs[0].info.role).toBe("user")
  expect(msgs[0].parts[0]).toMatchObject({ type: "text", text: "hi" })
})

test("interruptRunningToolParts marks dangling running tools", () => {
  const s = new Storage(":memory:")
  const session = s.createSession({ directory: "/tmp/x" })
  s.updateMessage({ id: "m1", sessionID: session.id, role: "assistant", time: { created: 1 } })
  s.updatePart({
    id: "pr", messageID: "m1", sessionID: session.id, type: "tool", tool: "bash", callID: "c1",
    state: { status: "running", input: { command: "sleep 100" }, time: { start: 1 } },
  })
  s.updatePart({ id: "pc", messageID: "m1", sessionID: session.id, type: "text", text: "hi" })
  const n = s.interruptRunningToolParts()
  expect(n).toBe(1)
  const part = s.messagesWithParts(session.id)[0].parts.find((p) => p.id === "pr")
  expect(part && part.type === "tool" && part.state.status).toBe("error")
  expect(part && part.type === "tool" && part.state).toHaveProperty("error", "interrupted by restart")
  // 幂等：再次调用无事发生
  expect(s.interruptRunningToolParts()).toBe(0)
})
