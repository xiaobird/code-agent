import { expect, test } from "vitest"
import { estimateTokens } from "../../src/util/token"
import { isOverflow } from "../../src/compaction/overflow"
import type { TokenUsage } from "../../src/llm/stream"

const usage = (total: number): TokenUsage => ({
  input: total,
  output: 0,
  total,
  cache: { read: 0, write: 0 },
})

test("estimates tokens as chars/4 rounded up", () => {
  expect(estimateTokens("")).toBe(0)
  expect(estimateTokens("abcd")).toBe(1)
  expect(estimateTokens("abcde")).toBe(2) // ceil(5/4)
  expect(estimateTokens("a".repeat(4000))).toBe(1000)
})

test("overflow triggers at limit minus reserved buffer", () => {
  // limit 100000, buffer = min(20000, 8192) = 8192 → 阈值 91808
  expect(isOverflow(usage(91808), 100000)).toBe(true)
  expect(isOverflow(usage(91807), 100000)).toBe(false)
})

test("reserved buffer clamped to min(20000, 8192)", () => {
  // limit 30000 → buffer 本可 20000，但被 8192 钳制
  expect(isOverflow(usage(21808), 30000)).toBe(true)
  expect(isOverflow(usage(21807), 30000)).toBe(false)
})

test("custom reserved respected", () => {
  expect(isOverflow(usage(9500), 10000, 500)).toBe(true)
  expect(isOverflow(usage(9499), 10000, 500)).toBe(false)
})
