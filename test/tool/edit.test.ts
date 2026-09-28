import { expect, test } from "vitest"
import { mkdtempSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { executeEdit } from "../../src/tool/edit"

const allowAll = {
  sessionID: "s",
  abort: new AbortController().signal,
  ask: async () => {},
  metadata: async () => {},
}

test("edits file and returns diff", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "edit-"))
  const f = path.join(dir, "a.ts")
  writeFileSync(f, "const x = 1\n")
  const r = await executeEdit({ filePath: f, oldString: "const x = 1", newString: "const x = 2" }, allowAll)
  expect(readFileSync(f, "utf-8")).toBe("const x = 2\n")
  expect(r.metadata?.diff).toContain("-const x = 1")
  expect(r.metadata?.diff).toContain("+const x = 2")
  expect(r.metadata?.additions).toBe(1)
  expect(r.metadata?.deletions).toBe(1)
})

test("identical strings rejected", async () => {
  await expect(executeEdit({ filePath: "/x", oldString: "a", newString: "a" }, allowAll)).rejects.toThrow("identical")
})

test("empty oldString on existing file rejected", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "edit-"))
  const f = path.join(dir, "a.ts")
  writeFileSync(f, "hello\n")
  await expect(executeEdit({ filePath: f, oldString: "", newString: "x" }, allowAll)).rejects.toThrow(
    "oldString cannot be empty when editing an existing file",
  )
})

test("denied permission aborts edit", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "edit-"))
  const f = path.join(dir, "a.ts")
  writeFileSync(f, "keep\n")
  const deny = { ...allowAll, ask: async () => { throw new Error("Permission denied: edit") } }
  await expect(executeEdit({ filePath: f, oldString: "keep", newString: "changed" }, deny)).rejects.toThrow(
    "Permission denied",
  )
  expect(readFileSync(f, "utf-8")).toBe("keep\n")
})

test("CRLF normalized before matching", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "edit-"))
  const f = path.join(dir, "crlf.txt")
  writeFileSync(f, "a\r\nb\r\n")
  await executeEdit({ filePath: f, oldString: "a\nb", newString: "a\nB" }, allowAll)
  // 归一化后落盘统一为 LF
  expect(readFileSync(f, "utf-8")).toBe("a\nB\n")
})
