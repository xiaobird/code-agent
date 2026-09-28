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
