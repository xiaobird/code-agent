import { expect, test } from "vitest"
import { mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { executeRead } from "../../src/tool/read"

const ctx = { sessionID: "s", abort: new AbortController().signal, ask: async () => {}, metadata: async () => {} }

test("reads with line numbers and end marker", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "read-"))
  writeFileSync(path.join(dir, "a.txt"), "foo\nbar\n")
  const r = await executeRead({ filePath: path.join(dir, "a.txt") }, ctx)
  expect(r.output).toContain("1: foo")
  expect(r.output).toContain("(End of file - total 2 lines)")
})

test("line limit produces continue hint", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "read-"))
  writeFileSync(path.join(dir, "big.txt"), Array.from({ length: 50 }, (_, i) => `line${i}`).join("\n"))
  const r = await executeRead({ filePath: path.join(dir, "big.txt"), limit: 10 }, ctx)
  expect(r.output).toContain("(Showing lines 1-10 of 50. Use offset=11 to continue.)")
})

test("binary file rejected", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "read-"))
  writeFileSync(path.join(dir, "b.bin"), Buffer.from([0, 1, 2, 3]))
  await expect(executeRead({ filePath: path.join(dir, "b.bin") }, ctx)).rejects.toThrow("binary")
})

test("missing file suggests similar names", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "read-"))
  writeFileSync(path.join(dir, "package.json"), "{}")
  await expect(executeRead({ filePath: path.join(dir, "packge.json") }, ctx)).rejects.toThrow("Did you mean")
})

test("directory listing with pagination marker", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "read-"))
  writeFileSync(path.join(dir, "a.ts"), "")
  writeFileSync(path.join(dir, "b.ts"), "")
  const r = await executeRead({ filePath: dir, limit: 1 }, ctx)
  expect(r.output).toContain("<type>directory</type>")
  expect(r.output).toContain("(Showing 1 of 2 entries. Use 'offset' to continue.)")
})

test("single long line truncated to 2000 chars", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "read-"))
  writeFileSync(path.join(dir, "long.txt"), "x".repeat(5000))
  const r = await executeRead({ filePath: path.join(dir, "long.txt") }, ctx)
  expect(r.output).toContain("line truncated to 2000 chars")
  expect(r.output).not.toContain("x".repeat(2500))
})
