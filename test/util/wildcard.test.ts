// test/util/wildcard.test.ts
import { expect, test } from "vitest"
import { wildcardMatch } from "../../src/util/wildcard"

test("star matches any sequence", () => {
  expect(wildcardMatch("*", "anything")).toBe(true)
  expect(wildcardMatch("rm *", "rm -rf /")).toBe(true)
  expect(wildcardMatch("*.env", ".env")).toBe(true)
  expect(wildcardMatch("git *", "npm install")).toBe(false)
  expect(wildcardMatch("read", "read")).toBe(true)
})
