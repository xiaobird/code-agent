import { execFile } from "child_process"
import { promisify } from "util"
import { registerTool } from "./registry"
import { truncateOutput } from "./truncate"
import type { ToolContext, ToolResult } from "./tool"

const execFileP = promisify(execFile)
const DEFAULT_TIMEOUT = 120_000

export async function executeBash(
  params: { command: string; timeout?: number },
  ctx: ToolContext,
): Promise<ToolResult> {
  await ctx.ask({ permission: "bash", patterns: [params.command] })
  const timeout = params.timeout ?? DEFAULT_TIMEOUT
  try {
    const { stdout, stderr } = await execFileP(process.env.SHELL ?? "/bin/sh", ["-c", params.command], {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      signal: ctx.abort,
    })
    const merged = [stdout, stderr].filter(Boolean).join("\n")
    const r = truncateOutput(merged, undefined, "tail")
    return {
      title: params.command.slice(0, 60),
      output: r.content,
      metadata: { truncated: r.truncated, outputPath: r.outputPath, exitCode: 0 },
    }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number; killed?: boolean; message?: string }
    const merged = [err.stdout, err.stderr].filter(Boolean).join("\n")
    const detail =
      err.killed ? `Command timed out after ${timeout / 1000}s` : `exit code ${err.code ?? "unknown"}`
    const r = truncateOutput([merged, `[bash] ${detail}`].filter(Boolean).join("\n"), undefined, "tail")
    return {
      title: params.command.slice(0, 60),
      output: r.content,
      metadata: { truncated: r.truncated, outputPath: r.outputPath, exitCode: err.code ?? 1, error: detail },
    }
  }
}

registerTool({
  id: "bash",
  description: `Run a shell command and return merged stdout/stderr (tail kept on truncation).
Long output spills to disk with a path in the result. Default timeout 120s.`,
  parameters: {
    type: "object",
    required: ["command"],
    properties: {
      command: { type: "string", description: "The shell command to execute" },
      timeout: { type: "number", description: "Timeout in milliseconds (default 120000)" },
    },
  },
  execute: executeBash,
})
