import { tool, jsonSchema, type Tool as AITool } from "ai"
import type { ToolDef, ToolContext } from "./tool"

const registry = new Map<string, ToolDef>()
export function registerTool(def: ToolDef): void { registry.set(def.id, def) }
export function getTools(): ToolDef[] { return [...registry.values()] }

export function toAISDKTools(ctx: ToolContext): Record<string, AITool> {
  // ask 包装：确认通过后记时间戳，供耗时展示剔除等待
  const timedCtx: ToolContext = {
    ...ctx,
    async ask(req) {
      await ctx.ask(req)
      timedCtx.lastAskDone = Date.now()
    },
  }
  // 工具串行执行（对齐 Claude Code）：并行 tool-call 不会穿插输出/权限提示
  let chain: Promise<unknown> = Promise.resolve()
  return Object.fromEntries([...registry.values()].map((def) => [def.id, tool({
    description: def.description,
    inputSchema: jsonSchema(def.parameters as never),
    async execute(args) {
      const run = async () => {
        try {
          return await def.execute(args as Record<string, unknown>, timedCtx)
        } catch (e) {
          return { title: def.id, output: `Error: ${e instanceof Error ? e.message : String(e)}` }
        }
      }
      const p = chain.then(run, run)
      chain = p.then(() => undefined, () => undefined)
      return p
    },
  })]))
}
