import { readFileSync, readdirSync, statSync } from "fs"
import path from "path"
import { registerTool } from "./registry"
import type { ToolContext, ToolResult } from "./tool"

export const READ_MAX_LINES = 2000
export const READ_MAX_LINE_LENGTH = 2000
export const READ_MAX_BYTES = 50 * 1024

function similarNames(dir: string, base: string): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return [] // 父目录不存在时无可建议
  }
  const stem = base.replace(/\.[^.]*$/, "")
  return names
    .filter((n) => {
      const nl = n.toLowerCase()
      if (nl.includes(base) || base.includes(nl)) return true
      const nstem = nl.replace(/\.[^.]*$/, "")
      let i = 0
      while (i < stem.length && i < nstem.length && stem[i] === nstem[i]) i++
      return i >= 4 || i >= stem.length
    })
    .slice(0, 3)
}

export async function executeRead(
  params: { filePath: string; offset?: number; limit?: number },
  ctx: ToolContext,
): Promise<ToolResult> {
  const filePath = path.resolve(params.filePath)
  await ctx.ask({ permission: "read", patterns: [filePath] })

  let stat
  try {
    stat = statSync(filePath)
  } catch {
    const similar = similarNames(path.dirname(filePath), path.basename(filePath).toLowerCase())
    throw new Error(
      `File not found: ${filePath}` +
        (similar.length ? `\n\nDid you mean one of these?\n${similar.join("\n")}` : ""),
    )
  }

  if (stat.isDirectory()) {
    const entries = readdirSync(filePath).map((n) =>
      statSync(path.join(filePath, n)).isDirectory() ? n + "/" : n,
    ).sort()
    const offset = params.offset ?? 1
    const sliced = entries.slice(offset - 1, offset - 1 + (params.limit ?? READ_MAX_LINES))
    const truncated = offset - 1 + sliced.length < entries.length
    return {
      title: path.basename(filePath),
      output: [
        `<path>${filePath}</path>`,
        `<type>directory</type>`,
        `<entries>`,
        ...sliced,
        truncated
          ? `(Showing ${sliced.length} of ${entries.length} entries. Use 'offset' to continue.)`
          : `(${entries.length} entries)`,
        `</entries>`,
      ].join("\n"),
      metadata: { truncated },
    }
  }

  const sample = readFileSync(filePath).subarray(0, 4096)
  if (sample.includes(0) || [...sample].filter((b) => b < 9 || (b > 13 && b < 32)).length / sample.length > 0.3)
    throw new Error(`Cannot read binary file: ${filePath}`)

  const text = readFileSync(filePath, "utf-8")
  const all = text.split("\n")
  if (text.endsWith("\n")) all.pop() // 末尾换行不算独立一行
  const offset = params.offset ?? 1
  const limit = params.limit ?? READ_MAX_LINES
  if (offset > all.length && all.length > 0)
    throw new Error(`Offset ${offset} is out of range for this file (${all.length} lines)`)

  const raw: string[] = []
  let bytes = 0,
    cut = false
  for (let i = offset - 1; i < all.length && raw.length < limit; i++) {
    const line = all[i].length > READ_MAX_LINE_LENGTH
      ? all[i].slice(0, READ_MAX_LINE_LENGTH) + `... (line truncated to ${READ_MAX_LINE_LENGTH} chars)`
      : all[i]
    const size = Buffer.byteLength(line) + 1
    if (bytes + size > READ_MAX_BYTES) { cut = true; break }
    raw.push(line)
    bytes += size
  }
  const last = offset + raw.length - 1
  const more = last < all.length
  const marker = cut
    ? `(Output capped at 50 KB. Showing lines ${offset}-${last}. Use offset=${last + 1} to continue.)`
    : more
      ? `(Showing lines ${offset}-${last} of ${all.length}. Use offset=${last + 1} to continue.)`
      : `(End of file - total ${all.length} lines)`

  return {
    title: path.basename(filePath),
    metadata: { truncated: cut || more },
    output: [
      `<path>${filePath}</path>`,
      `<type>file</type>`,
      `<content>`,
      raw.map((l, i) => `${offset + i}: ${l}`).join("\n"),
      "",
      marker,
      `</content>`,
    ].join("\n"),
  }
}

registerTool({
  id: "read",
  description: `Read a file or directory. Returns up to 2000 lines with line numbers.
Use offset/limit to paginate. Use grep to locate content in large files.
Avoid tiny repeated slices; read a larger window when more context is needed.`,
  parameters: {
    type: "object",
    required: ["filePath"],
    properties: {
      filePath: { type: "string", description: "Absolute path to file or directory" },
      offset: { type: "number", description: "Line number to start from (1-indexed)" },
      limit: { type: "number", description: "Max lines (default 2000)" },
    },
  },
  execute: executeRead,
})
