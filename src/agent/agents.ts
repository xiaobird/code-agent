import type { Rule } from "../permission"

export interface AgentConfig {
  name: string
  prompt?: string
  permission: Rule[]
  mode: "primary" | "subagent"
}

export const AGENTS: Record<string, AgentConfig> = {
  main: {
    name: "main",
    mode: "primary",
    permission: [
      { permission: "read", pattern: "*", action: "allow" },
      { permission: "grep", pattern: "*", action: "allow" },
      { permission: "glob", pattern: "*", action: "allow" },
      { permission: "edit", pattern: "*", action: "ask" },
      { permission: "bash", pattern: "*", action: "ask" },
    ],
  },
  explore: {
    name: "explore",
    mode: "subagent",
    prompt: `You are a file search specialist. You find code, files and facts — you never modify anything.
Read directories first to map the layout, then grep/glob to narrow down, then read the relevant regions.
Report back: exact file paths with line numbers, key symbols, and short verbatim excerpts that answer the request.
If something does not exist, say so plainly. Keep the report dense and factual.`,
    permission: [
      { permission: "*", pattern: "*", action: "deny" },
      { permission: "read", pattern: "*", action: "allow" },
      { permission: "grep", pattern: "*", action: "allow" },
      { permission: "glob", pattern: "*", action: "allow" },
      { permission: "bash", pattern: "*", action: "allow" },
    ],
  },
}
