import { expect, test } from "vitest"
import { mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { executeGrep } from "../../src/tool/grep"

const ctx = { sessionID: "s", abort: new AbortController().signal, ask: async () => {}, metadata: async () => {} }

test("finds matches with line numbers", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "grep-"))
  writeFileSync(path.join(dir, "a.ts"), "const runLoop = 1\nconst other = 2\n")
  const r = await executeGrep({ pattern: "runLoop", path: dir }, ctx)
  expect(r.output).toContain("Found 1 matches")
  expect(r.output).toContain("Line 1: const runLoop = 1")
})

test("no matches", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "grep-"))
  const r = await executeGrep({ pattern: "zzz", path: dir }, ctx)
  expect(r.output).toBe("No files found")
})

test("caps total matches at 100", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "grep-"))
  writeFileSync(
    path.join(dir, "many.txt"),
    Array.from({ length: 300 }, (_, i) => `needle ${i}`).join("\n") + "\n",
  )
  const r = await executeGrep({ pattern: "needle", path: dir }, ctx)
  expect(r.metadata?.matches).toBe(100)
  expect(r.output).toContain("more available")
})
