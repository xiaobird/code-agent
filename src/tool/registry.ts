import { tool, jsonSchema, type Tool as AITool } from "ai"
import type { ToolDef, ToolContext } from "./tool"

const registry = new Map<string, ToolDef>()
export function registerTool(def: ToolDef): void { registry.set(def.id, def) }
export function getTools(): ToolDef[] { return [...registry.values()] }

export function toAISDKTools(ctx: ToolContext): Record<string, AITool> {
  return Object.fromEntries([...registry.values()].map((def) => [def.id, tool({
    description: def.description,
    inputSchema: jsonSchema(def.parameters as never),
    async execute(args) {
      try {
        return await def.execute(args as Record<string, unknown>, ctx)
      } catch (e) {
        return { title: def.id, output: `Error: ${e instanceof Error ? e.message : String(e)}` }
      }
    },
  })]))
}
