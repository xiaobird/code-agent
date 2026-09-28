export interface ToolDef<P = Record<string, unknown>> {
  id: string
  description: string
  parameters: Record<string, unknown>          // JSON Schema
  execute(args: P, ctx: ToolContext): Promise<ToolResult>
}
export interface ToolContext {
  sessionID: string
  abort: AbortSignal
  ask(req: { permission: string; patterns: string[]; metadata?: Record<string, unknown> }): Promise<void>
  metadata(patch: { title?: string; metadata?: Record<string, unknown> }): Promise<void>
}
export interface ToolResult { title: string; output: string; metadata?: Record<string, unknown> }
