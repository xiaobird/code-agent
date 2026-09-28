import { expect, test } from "vitest"
import { evaluate, createAsk, PermissionDeniedError } from "../../src/permission"

const rules = [
  { permission: "*", pattern: "*", action: "ask" as const },
  { permission: "bash", pattern: "git *", action: "allow" as const },
  { permission: "bash", pattern: "rm *", action: "deny" as const },
]

test("last matching rule wins", () => {
  expect(evaluate("bash", "git status", rules)).toBe("allow")
  expect(evaluate("bash", "rm -rf /", rules)).toBe("deny")
  expect(evaluate("bash", "npm test", rules)).toBe("ask")
  expect(evaluate("read", "/etc/passwd", rules)).toBe("ask")
})

test("no match defaults to ask", () => {
  expect(evaluate("edit", "x.ts", [])).toBe("ask")
})

test("allow passes without prompting", async () => {
  const ask = createAsk(rules, async () => {
    throw new Error("should not prompt")
  })
  await ask({ permission: "bash", patterns: ["git status"] })
})

test("deny throws PermissionDeniedError", async () => {
  const ask = createAsk(rules, async () => "y")
  await expect(ask({ permission: "bash", patterns: ["rm -rf /"] })).rejects.toThrow(PermissionDeniedError)
})

test("ask prompts; y passes, n denies", async () => {
  const questions: string[] = []
  let answer = "y"
  const ask = createAsk(rules, async (q) => {
    questions.push(q)
    return answer
  })
  await ask({ permission: "read", patterns: ["/tmp/a.txt"] })
  expect(questions).toHaveLength(1)
  answer = "n"
  await expect(ask({ permission: "read", patterns: ["/tmp/b.txt"] })).rejects.toThrow(PermissionDeniedError)
})

test("answer 'a' persists an allow rule for the session", async () => {
  let count = 0
  const ask = createAsk([], async () => {
    count++
    return "a"
  })
  await ask({ permission: "read", patterns: ["/tmp/x"] })
  await ask({ permission: "read", patterns: ["/tmp/x"] })
  expect(count).toBe(1) // 第二次不再询问
})
