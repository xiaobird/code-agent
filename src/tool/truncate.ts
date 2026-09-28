import { mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from "fs"
import { homedir } from "os"
import { randomUUID } from "crypto"
import path from "path"

const TRUNCATION_DIR = path.join(homedir(), ".local", "share", "code-agent", "truncation")
const MAX_LINES = 2000
const MAX_BYTES = 50 * 1024

/**
 * 输出截断：默认保头（read 类），bash 用 direction: "tail" 保尾（错误通常在末尾）。
 * 超限时完整输出写入磁盘，内容中给出 outputPath 与后续检索建议。
 */
export function truncateOutput(
  text: string,
  _filePath?: string,
  direction: "head" | "tail" = "head",
): { content: string; truncated: boolean; outputPath?: string } {
  const lines = text.split("\n")
  const bytes = Buffer.byteLength(text)
  if (lines.length <= MAX_LINES && bytes <= MAX_BYTES)
    return { content: text, truncated: false }

  mkdirSync(TRUNCATION_DIR, { recursive: true })
  const outputPath = path.join(TRUNCATION_DIR, randomUUID())
  writeFileSync(outputPath, text)

  const dropped = lines.length - MAX_LINES
  const kept =
    direction === "tail"
      ? lines.slice(-MAX_LINES).join("\n")
      : lines.slice(0, MAX_LINES).join("\n")
  const notice =
    direction === "tail"
      ? `[Output truncated: dropped the first ${dropped} lines. Full output saved to ${outputPath}. Use Grep to search the full content or Read with offset/limit.]`
      : `[Output truncated: dropped the last ${dropped} lines. Full output saved to ${outputPath}. Use Grep to search the full content or Read with offset/limit.]`
  return { content: `${kept}\n${notice}`, truncated: true, outputPath }
}

// 供测试/恢复使用
export { TRUNCATION_DIR }
