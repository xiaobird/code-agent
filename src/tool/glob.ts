import fg from "fast-glob"
import { statSync } from "fs"
import { registerTool } from "./registry"
import type { ToolContext, ToolResult } from "./tool"

const LIMIT = 100

export async function executeGlob(
  params: { pattern: string; path?: string },
  ctx: ToolContext,
): Promise<ToolResult> {
  await ctx.ask({ permission: "glob", patterns: [params.pattern] })
  const cwd = params.path ?? process.cwd()
  const files = await fg(params.pattern, { cwd, absolute: true, onlyFiles: true, dot: false })
  const sorted = files
    .map((f) => ({ f, mtime: statSync(f).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, LIMIT)
  if (!sorted.length)
    return { title: params.pattern, output: "No files found", metadata: { matches: 0 } }
  return {
    title: params.pattern,
    output:
      sorted.map((x) => x.f).join("\n") +
      (files.length > LIMIT ? `\n(Results truncated to ${LIMIT})` : ""),
    metadata: { matches: sorted.length },
  }
}

registerTool({
  id: "glob",
  description:
    "Find files by glob pattern (e.g. 'src/**/*.ts'). Returns up to 100 paths sorted by modification time.",
  parameters: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: { type: "string" },
      path: { type: "string" },
    },
  },
  execute: executeGlob,
})
