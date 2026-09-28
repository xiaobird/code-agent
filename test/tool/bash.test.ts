import { expect, test } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import { homedir } from "os"
import { executeBash } from "../../src/tool/bash"
import { truncateOutput } from "../../src/tool/truncate"

const ctx = { sessionID: "s", abort: new AbortController().signal, ask: async () => {}, metadata: async () => {} }

test("runs command and captures stdout", async () => {
  const r = await executeBash({ command: "echo hello" }, ctx)
  expect(r.output).toContain("hello")
})

test("captures stderr merged", async () => {
  const r = await executeBash({ command: "echo oops 1>&2" }, ctx)
  expect(r.output).toContain("oops")
})

test("non-zero exit reported as error output", async () => {
  const r = await executeBash({ command: "exit 3" }, ctx)
  expect(r.output).toContain("exit code 3")
})

test("truncate keeps tail for long output and spills to disk", () => {
  const text = Array.from({ length: 3000 }, (_, i) => `line${i}`).join("\n")
  const r = truncateOutput(text, undefined, "tail")
  expect(r.truncated).toBe(true)
  expect(r.content).toContain("line2999")
  expect(r.content).not.toContain("line0\n")
  expect(r.content).toContain("truncated")
  expect(r.outputPath).toBeTruthy()
  expect(readFileSync(r.outputPath!, "utf-8")).toBe(text)
})

test("truncate keeps head by default", () => {
  const text = Array.from({ length: 3000 }, (_, i) => `line${i}`).join("\n")
  const r = truncateOutput(text)
  expect(r.content).toContain("line0")
})

test("short output untouched", () => {
  const r = truncateOutput("hello\nworld")
  expect(r).toMatchObject({ content: "hello\nworld", truncated: false })
  expect(r.outputPath).toBeUndefined()
})
