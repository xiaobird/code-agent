import { expect, test } from "vitest"
import { modeRules, nextMode, MODES } from "../../src/permission/modes"
import { evaluate } from "../../src/permission"

test("plan mode denies edit and bash", () => {
  const rules = modeRules("plan")
  expect(evaluate("edit", "x.ts", rules)).toBe("deny")
  expect(evaluate("bash", "npm test", rules)).toBe("deny")
  expect(evaluate("read", "/etc/hosts", rules)).toBe("allow")
})

test("confirm mode asks for edit and bash", () => {
  const rules = modeRules("confirm")
  expect(evaluate("edit", "x.ts", rules)).toBe("ask")
  expect(evaluate("bash", "npm test", rules)).toBe("ask")
})

test("auto-edit allows edit but still asks for bash", () => {
  const rules = modeRules("auto-edit")
  expect(evaluate("edit", "x.ts", rules)).toBe("allow")
  expect(evaluate("bash", "npm test", rules)).toBe("ask")
})

test("full access allows edit and bash", () => {
  const rules = modeRules("full")
  expect(evaluate("edit", "x.ts", rules)).toBe("allow")
  expect(evaluate("bash", "git push", rules)).toBe("allow")
})

test("all modes keep read-only tools allowed", () => {
  for (const m of MODES) {
    const rules = modeRules(m.mode)
    expect(evaluate("read", "*", rules)).toBe("allow")
    expect(evaluate("grep", "*", rules)).toBe("allow")
    expect(evaluate("glob", "*", rules)).toBe("allow")
  }
})

test("nextMode cycles through all modes", () => {
  let m = nextMode("plan")
  expect(m).toBe("confirm")
  expect(nextMode(m)).toBe("auto-edit")
  expect(nextMode("auto-edit")).toBe("full")
  expect(nextMode("full")).toBe("plan")
})
