import { execFile } from "child_process"
import { promisify } from "util"
import path from "path"
import { registerTool } from "./registry"
import type { ToolContext, ToolResult } from "./tool"

const execFileP = promisify(execFile)
const LIMIT = 100

export async function executeGrep(
  params: { pattern: string; path?: string; include?: string },
  ctx: ToolContext,
): Promise<ToolResult> {
  await ctx.ask({ permission: "grep", patterns: [params.pattern] })
  const cwd = params.path ?? process.cwd()
  const args = ["--line-number", "--max-count", String(LIMIT), "--color", "never"]
  if (params.include) args.push("--glob", params.include)
  args.push(params.pattern, ".")
  const { stdout } = await execFileP("rg", args, { cwd }).catch((e: { code?: number }) => {
    if (e.code === 1) return { stdout: "" } // rg: 1 = no matches
    throw e
  })
  // --max-count 是单文件上限，这里再钳制总条数
  const lines = stdout.trim().split("\n").filter(Boolean).slice(0, LIMIT)
  if (!lines.length) return { title: params.pattern, output: "No files found", metadata: { matches: 0 } }
  let current = ""
  const out = [`Found ${lines.length} matches${lines.length >= LIMIT ? " (more available)" : ""}`]
  for (const line of lines) {
    const idx = line.indexOf(":")
    const file = line.slice(0, idx),
      rest = line.slice(idx + 1)
    const idx2 = rest.indexOf(":")
    if (current !== file) {
      if (current) out.push("")
      current = file
      out.push(`${path.resolve(cwd, file)}:`)
    }
    out.push(`  Line ${rest.slice(0, idx2)}: ${rest.slice(idx2 + 1)}`)
  }
  return { title: params.pattern, output: out.join("\n"), metadata: { matches: lines.length } }
}

registerTool({
  id: "grep",
  description:
    "Search file contents with regex (ripgrep). Max 100 matches. Use include to filter file types (e.g. '*.ts').",
  parameters: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: { type: "string" },
      path: { type: "string" },
      include: { type: "string" },
    },
  },
  execute: executeGrep,
})
