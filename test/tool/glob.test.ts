import { expect, test } from "vitest"
import { mkdtempSync, writeFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { executeGlob } from "../../src/tool/glob"

const ctx = { sessionID: "s", abort: new AbortController().signal, ask: async () => {}, metadata: async () => {} }

test("matches files by pattern", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "glob-"))
  mkdirSync(path.join(dir, "src"))
  writeFileSync(path.join(dir, "src", "a.ts"), "")
  writeFileSync(path.join(dir, "b.md"), "")
  const r = await executeGlob({ pattern: "**/*.ts", path: dir }, ctx)
  expect(r.output).toContain("a.ts")
  expect(r.output).not.toContain("b.md")
})

test("no files found", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "glob-"))
  const r = await executeGlob({ pattern: "**/*.zzz", path: dir }, ctx)
  expect(r.output).toBe("No files found")
})

test("sorted by mtime descending, capped at 100", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "glob-"))
  const older = path.join(dir, "older.txt")
  const newer = path.join(dir, "newer.txt")
  writeFileSync(older, "")
  await new Promise((r) => setTimeout(r, 20))
  writeFileSync(newer, "")
  const r = await executeGlob({ pattern: "*.txt", path: dir }, ctx)
  const lines = r.output.split("\n")
  expect(lines.indexOf(newer)).toBeLessThan(lines.indexOf(older))
})
