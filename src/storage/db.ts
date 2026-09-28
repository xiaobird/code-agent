import Database from "better-sqlite3"
import { readFileSync } from "fs"
import { randomUUID } from "crypto"
import path from "path"

export class Storage {
  private db: Database.Database
  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma("journal_mode = WAL")
    this.db.exec(readFileSync(path.join(import.meta.dirname, "schema.sql"), "utf-8"))
  }
  createSession(input: { directory: string; parentID?: string }) {
    const session = {
      id: randomUUID(), parentID: input.parentID ?? null, title: "New session",
      directory: input.directory, time_created: Date.now(), time_updated: Date.now(),
    }
    this.db.prepare(
      "INSERT INTO session (id, parent_id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?,?)",
    ).run(session.id, session.parentID, session.title, session.directory, session.time_created, session.time_updated)
    return session
  }
  getSession(id: string): { id: string; parentID: string | null; title: string; directory: string } | undefined {
    const row = this.db
      .prepare("SELECT id, parent_id, title, directory FROM session WHERE id = ?")
      .get(id) as { id: string; parent_id: string | null; title: string; directory: string } | undefined
    return row ? { id: row.id, parentID: row.parent_id, title: row.title, directory: row.directory } : undefined
  }
  updateMessage(msg: { id: string; sessionID: string; time?: { created: number; completed?: number }; [k: string]: unknown }) {
    const { id, sessionID, ...data } = msg
    const created = msg.time?.created ?? Date.now()
    this.db.prepare(
      `INSERT INTO message (id, session_id, time_created, data) VALUES (?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
    ).run(id, sessionID, created, JSON.stringify(data))
  }
  updatePart(part: { id: string; messageID: string; sessionID: string; [k: string]: unknown }) {
    const { id, messageID, sessionID, ...data } = part
    this.db.prepare(
      `INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
    ).run(id, messageID, sessionID, Date.now(), JSON.stringify(data))
  }
  messagesWithParts(sessionID: string) {
    const msgs = this.db.prepare(
      "SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created, id",
    ).all(sessionID) as { id: string; data: string }[]
    const partStmt = this.db.prepare("SELECT id, data FROM part WHERE message_id = ? ORDER BY id")
    return msgs.map((m) => ({
      info: { id: m.id, sessionID, ...JSON.parse(m.data) },
      parts: (partStmt.all(m.id) as { id: string; data: string }[]).map(
        (p) => ({ id: p.id, messageID: m.id, sessionID, ...JSON.parse(p.data) }),
      ),
    }))
  }
}
