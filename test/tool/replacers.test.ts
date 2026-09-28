import { expect, test } from "vitest"
import { replace, isDisproportionateMatch } from "../../src/tool/replacers"

test("exact match", () => {
  expect(replace("a\nb\nc", "b", "B")).toBe("a\nB\nc")
})

test("exact substring preserves surrounding indentation", () => {
  const content = "function f() {\n    return 1\n}"
  expect(replace(content, "return 1", "return 2")).toBe("function f() {\n    return 2\n}")
})

test("multiple matches rejected without replaceAll", () => {
  expect(() => replace("x\nx", "x", "y")).toThrow("multiple")
})

test("replaceAll replaces every match", () => {
  expect(replace("x\nx", "x", "y", true)).toBe("y\ny")
})

test("block anchor with fuzzy middle", () => {
  const content = "START\nmiddle line changed a bit\nmore\nEND"
  const result = replace(content, "START\nmiddle line changed\nEND", "REPLACED")
  expect(result).toContain("REPLACED")
})

test("not found", () => {
  expect(() => replace("abc", "zzz", "y")).toThrow("Could not find")
})

test("line-trimmed tolerates trailing whitespace", () => {
  expect(replace("a   \nb\nc", "a\nb", "A\nB")).toBe("A\nB\nc")
})

test("indentation-flexible keeps content indentation", () => {
  const content = "function f() {\n\tif (x) {\n\t\treturn 1\n\t}\n}"
  // exact 子串失败（old 带不同缩进层级）→ 行级 trim 匹配，保留内容的 tab 缩进
  const result = replace(content, "  if (x) {\n    return 1\n  }", "if (x) {\n  return 2\n}")
  expect(result).toContain("\t\treturn 2")
  expect(result).not.toContain("return 1")
})

test("disproportionate match gate", () => {
  // old 3 行时：匹配 6 行起视为失控
  expect(isDisproportionateMatch(5, 3)).toBe(false)
  expect(isDisproportionateMatch(6, 3)).toBe(true)
  expect(isDisproportionateMatch(10, 4)).toBe(true) // ≥ max(4+3, 4*2)=8
})
