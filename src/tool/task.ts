import { randomUUID } from "crypto"
import type { LanguageModel } from "ai"
import type { Storage } from "../storage/db"
import { runLoop } from "../session/run"
import { AGENTS } from "../agent/agents"
import { evaluate, PermissionDeniedError } from "../permission"
import { registerTool } from "./registry"
import type { ToolContext, ToolResult } from "./tool"

export interface TaskDeps {
  storage: Storage
  model: LanguageModel
  modelInfo: { contextLimit: number }
  baseSystem: string[]
}

/** 子 agent 不再交互询问：allow 放行，其余一律拒绝 */
function subagentAsk(rules: Parameters<typeof evaluate>[2]) {
  return async (req: { permission: string; patterns: string[]; metadata?: Record<string, unknown> }) => {
    for (const pattern of req.patterns) {
      if (evaluate(req.permission, pattern, rules) !== "allow")
        throw new PermissionDeniedError(req.permission, pattern)
    }
  }
}

export function createTaskExecutor(deps: TaskDeps) {
  return async function executeTask(
    params: { subagent_type: string; prompt: string; description: string },
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const config = AGENTS[params.subagent_type]
    if (!config || config.mode !== "subagent")
      throw new Error(`Unknown subagent type: ${params.subagent_type}`)

    // 深度检查：当前 session 已是子 session（parentID 链 ≥1）则拒绝
    const current = deps.storage.getSession(ctx.sessionID)
    if (current?.parentID) throw new Error("task tool is not available inside a subagent session")

    const child = deps.storage.createSession({ directory: current?.directory ?? process.cwd(), parentID: ctx.sessionID })
    const userMsg = {
      id: randomUUID(),
      sessionID: child.id,
      role: "user" as const,
      time: { created: Date.now() },
    }
    deps.storage.updateMessage(userMsg)
    deps.storage.updatePart({
      id: randomUUID(),
      messageID: userMsg.id,
      sessionID: child.id,
      type: "text",
      text: params.prompt,
    })

    await runLoop({
      storage: deps.storage,
      sessionID: child.id,
      model: deps.model,
      modelInfo: deps.modelInfo,
      system: config.prompt ? [config.prompt, ...deps.baseSystem] : deps.baseSystem,
      ask: subagentAsk(config.permission),
      onText: () => {}, // 子 agent 中间过程不进父会话渲染
      abort: ctx.abort,
    })

    const msgs = deps.storage.messagesWithParts(child.id)
    let output = ""
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].info.role !== "assistant") continue
      const text = msgs[i].parts
        .map((p) => (p.type === "text" ? p.text : ""))
        .filter(Boolean)
        .join("\n")
      if (text) {
        output = text
        break
      }
    }
    return { title: params.description || params.subagent_type, output: output || "(subagent produced no text)" }
  }
}

export function registerTaskTool(deps: TaskDeps): void {
  registerTool({
    id: "task",
    description: `Run a subagent with a isolated context to do search/research work.
The subagent cannot modify files (explore is read-only) and cannot spawn further subagents.
Pass a self-contained prompt; you get back the subagent's final report.`,
    parameters: {
      type: "object",
      required: ["subagent_type", "prompt", "description"],
      properties: {
        subagent_type: { type: "string", description: "Subagent to run (e.g. 'explore')" },
        prompt: { type: "string", description: "Complete, self-contained task description" },
        description: { type: "string", description: "Short summary of what this subagent is doing" },
      },
    },
    execute: createTaskExecutor(deps),
  })
}
