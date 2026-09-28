import { expect, test } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { Storage } from "../../src/storage/db"
import { runLoop } from "../../src/session/run"

// import 即注册真实工具（read/edit/...）
import "../../src/tool/read"
import "../../src/tool/grep"
import "../../src/tool/glob"
import "../../src/tool/edit"
import "../../src/tool/bash"
import { scriptedModel, text, toolCall, finish } from "../helpers/model"

const FILE_CONTENT = "export function greet() {\n  return \"hello\"\n}\n"

test("e2e golden: read → edit → summary with real tools and snapshots", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-"))
  try {
    const target = path.join(dir, "src", "app.ts")
    writeFileSync(path.join(dir, "package.json"), '{"name":"fixture"}')
    mkdirSync(path.join(dir, "src"), { recursive: true })
    writeFileSync(target, FILE_CONTENT)

    const storage = new Storage(":memory:")
    const session = storage.createSession({ directory: dir })
    storage.updateMessage({ id: "u1", sessionID: session.id, role: "user", time: { created: 1 } })
    storage.updatePart({
      id: "p0", messageID: "u1", sessionID: session.id, type: "text",
      text: `Read ${target}, then change the return value from "hello" to "goodbye", then summarize.`,
    })

    const model = scriptedModel([
      [toolCall("c1", "read", { filePath: target }), finish("tool-calls", 50, 10)],
      [
        toolCall("c2", "edit", { filePath: target, oldString: 'return "hello"', newString: 'return "goodbye"' }),
        finish("tool-calls", 60, 10),
      ],
      [...text("Changed greet() to return goodbye."), finish("stop", 40, 10)],
    ])

    await runLoop({
      storage,
      sessionID: session.id,
      model,
      modelInfo: { contextLimit: 100000 },
      system: [],
      worktree: dir,
      ask: async () => {}, // E2E 默认放行
      onText: () => {},
      abort: new AbortController().signal,
    })

    // 文件确实被改
    expect(readFileSync(target, "utf-8")).toContain('return "goodbye"')
    expect(readFileSync(target, "utf-8")).not.toContain('"hello"')

    // DB 终态
    const msgs = storage.messagesWithParts(session.id)
    const assistants = msgs.filter((m) => m.info.role === "assistant")
    expect(assistants).toHaveLength(3)
    const toolParts = msgs.flatMap((m) => m.parts).filter((p) => p.type === "tool")
    expect(toolParts).toHaveLength(2)
    for (const p of toolParts)
      expect(p.type === "tool" && p.state.status).toBe("completed")
    const lastAssistant = msgs.findLast((m) => m.info.role === "assistant")
    expect(lastAssistant?.parts[0]).toMatchObject({ type: "text", text: "Changed greet() to return goodbye." })

    // 快照 PatchPart 已记录
    const patchParts = msgs.flatMap((m) => m.parts).filter((p) => p.type === "patch")
    expect(patchParts).toHaveLength(1)
    if (patchParts[0].type === "patch") expect(patchParts[0].files).toContain("src/app.ts")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
