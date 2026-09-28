import { readFileSync, writeFileSync, statSync } from "fs"
import path from "path"
import { createTwoFilesPatch } from "diff"
import { registerTool } from "./registry"
import { replace } from "./replacers"
import type { ToolContext, ToolResult } from "./tool"

export async function executeEdit(
  params: { filePath: string; oldString: string; newString: string; replaceAll?: boolean },
  ctx: ToolContext,
): Promise<ToolResult> {
  const filePath = path.resolve(params.filePath)
  if (params.oldString === params.newString)
    throw new Error("oldString and newString are identical; edit would be a no-op")

  let original: string
  try {
    original = readFileSync(filePath, "utf-8")
  } catch {
    throw new Error(`File not found: ${filePath}`)
  }
  if (params.oldString === "")
    throw new Error("oldString cannot be empty when editing an existing file")

  // CRLF 归一化后匹配与替换，落盘统一 LF
  const normalized = original.replace(/\r\n/g, "\n")
  const updated = replace(normalized, params.oldString, params.newString, params.replaceAll)

  const rel = path.relative(process.cwd(), filePath) || path.basename(filePath)
  const diff = createTwoFilesPatch(rel, rel, normalized, updated, "", "", { context: 3 })
  const additions = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length
  const deletions = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length

  await ctx.ask({ permission: "edit", patterns: [filePath], metadata: { diff } })
  writeFileSync(filePath, updated)

  return {
    title: rel,
    output: "Edit applied successfully.",
    metadata: { diff, additions, deletions },
  }
}

registerTool({
  id: "edit",
  description: `Edit a file by replacing oldString with newString.
Matching is tolerant: exact, line-trimmed, indentation-flexible, then block-anchor (fuzzy middle).
oldString must be unique unless replaceAll is true. Always preview the diff before approving.`,
  parameters: {
    type: "object",
    required: ["filePath", "oldString", "newString"],
    properties: {
      filePath: { type: "string", description: "Absolute path to the file to edit" },
      oldString: { type: "string", description: "Text to find (include surrounding lines for uniqueness)" },
      newString: { type: "string", description: "Replacement text" },
      replaceAll: { type: "boolean", description: "Replace every occurrence instead of requiring uniqueness" },
    },
  },
  execute: executeEdit,
})
