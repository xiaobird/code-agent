import { wildcardMatch } from "../util/wildcard"

export type Rule = { permission: string; pattern: string; action: "allow" | "ask" | "deny" }

export function evaluate(permission: string, pattern: string, rules: Rule[]): "allow" | "ask" | "deny" {
  const match = rules.findLast(
    (r) => wildcardMatch(r.permission, permission) && wildcardMatch(r.pattern, pattern),
  )
  return match?.action ?? "ask"
}

export class PermissionDeniedError extends Error {
  constructor(permission: string, pattern: string) {
    super(`Permission denied: ${permission} (${pattern})`)
  }
}

/** 解析用户对权限提示的回答；空/未识别默认放行（对齐 Claude Code 的 Enter=Yes） */
export function interpretAnswer(raw: string): "yes" | "always" | "no" {
  const a = raw.trim().toLowerCase()
  if (["a", "always", "2", "always allow", "dont ask", "don't ask", "总是允许"].includes(a)) return "always"
  if (["n", "no", "deny", "3", "否", "拒绝"].includes(a)) return "no"
  return "yes" // y / yes / 1 / allow / 好 / 空
}

function brief(pattern: string, max = 72): string {
  const one = pattern.replace(/\s+/g, " ").trim()
  return one.length > max ? one.slice(0, max) + "…" : one
}

/**
 * 注意：直接复用传入的 rules 数组（不拷贝），调用方可通过原地修改数组
 * 动态切换权限模式；"always" 回答也会写入该数组。
 */
export function createAsk(rules: Rule[], prompt: (question: string) => Promise<string>) {
  const sessionRules = rules
  return async function ask(req: {
    permission: string
    patterns: string[]
    metadata?: Record<string, unknown>
  }) {
    for (const pattern of req.patterns) {
      const action = evaluate(req.permission, pattern, sessionRules)
      if (action === "allow") continue
      if (action === "deny") throw new PermissionDeniedError(req.permission, pattern)
      const answer = interpretAnswer(
        await prompt(
          `Allow ${req.permission} ${brief(pattern)}?\n  ❯ 1. Yes   2. Yes, don't ask again   3. No  (Enter = Yes): `,
        ),
      )
      if (answer === "always") sessionRules.push({ permission: req.permission, pattern, action: "allow" })
      else if (answer === "no") throw new PermissionDeniedError(req.permission, pattern)
    }
  }
}
