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

export function createAsk(rules: Rule[], prompt: (question: string) => Promise<string>) {
  const sessionRules = [...rules]
  return async function ask(req: {
    permission: string
    patterns: string[]
    metadata?: Record<string, unknown>
  }) {
    for (const pattern of req.patterns) {
      const action = evaluate(req.permission, pattern, sessionRules)
      if (action === "allow") continue
      if (action === "deny") throw new PermissionDeniedError(req.permission, pattern)
      const answer = await prompt(`Allow ${req.permission} "${pattern}"? [y]es/[n]o/[a]lways: `)
      if (answer === "a") sessionRules.push({ permission: req.permission, pattern, action: "allow" })
      else if (answer !== "y") throw new PermissionDeniedError(req.permission, pattern)
    }
  }
}
