const DIM = "\x1b[2m"
const DIM_ITALIC = "\x1b[2m\x1b[3m"
const BOLD = "\x1b[1m"
const CYAN = "\x1b[36m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const RED = "\x1b[31m"
const RESET = "\x1b[0m"

export function printBanner(modelLabel: string) {
  const rows = [
    `${YELLOW}${BOLD}⚡ code-agent${RESET}`,
    `${DIM}${modelLabel}${RESET}`,
    `${DIM}shift+tab 切换权限模式 · /mode 选择 · /exit 退出 · /revert 回滚${RESET}`,
  ]
  const plain = rows.map((r) => r.replace(/\x1b\[[0-9;]*m/g, ""))
  const width = Math.max(...plain.map((r) => r.length)) + 2
  const top = `${DIM}╭${"─".repeat(width)}╮${RESET}`
  const bottom = `${DIM}╰${"─".repeat(width)}╯${RESET}`
  console.log(`\n${top}`)
  for (let i = 0; i < rows.length; i++)
    console.log(`${DIM}│${RESET} ${rows[i].padEnd(width - 1)}${DIM}│${RESET}`)
  console.log(bottom)
}

/** 权限模式菜单（/mode 触发），✓ 标当前项 */
export function printModeMenu(modes: { icon: string; label: string; description: string }[], currentIndex: number) {
  console.log(`\n${BOLD}权限模式${RESET}`)
  modes.forEach((m, i) => {
    const mark = i === currentIndex ? `${GREEN}✓${RESET}` : " "
    console.log(` ${mark} ${i + 1}. ${m.icon} ${BOLD}${m.label}${RESET} ${DIM}${m.description}${RESET}`)
  })
  process.stdout.write(`${DIM}输入编号选择（回车取消）:${RESET} `)
}

/** 模式切换通知 */
export function printModeNotice(icon: string, label: string, description: string) {
  process.stdout.write(`${YELLOW}${icon} ${label}${RESET} ${DIM}— ${description}${RESET}\n`)
}

export function printPrompt() {
  breakLine()
  process.stdout.write(`${CYAN}❯${RESET} `)
}

export function printAssistantHeader() {
  process.stdout.write(`\n`)
}

// 流式文本与工具行/提示之间的换行跟踪
let cursorMidLine = false
function breakLine() {
  if (cursorMidLine) {
    process.stdout.write("\n")
    cursorMidLine = false
  }
}

export function printText(delta: string) {
  cursorMidLine = !delta.endsWith("\n")
  process.stdout.write(delta)
}

/** 思维链（推理模型）：暗色斜体，Claude Code thinking 风格 */
export function printReasoning(delta: string) {
  cursorMidLine = !delta.endsWith("\n")
  process.stdout.write(DIM_ITALIC + delta + RESET)
}

/** 工具参数的一句话摘要 */
function describeArgs(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const first = (k: string): string | undefined => {
    const v = i[k]
    return typeof v === "string" && v ? v : undefined
  }
  const brief =
    first("command") ?? first("filePath") ?? first("pattern") ?? first("description") ?? first("prompt") ?? ""
  return brief.replace(/\s+/g, " ").trim()
}

function trunc(s: string, max = 64): string {
  return s.length > max ? s.slice(0, max) + "…" : s
}

/** 工具开始：⏺ Bash(npm test) 一行紧凑展示 */
export function printToolStart(name: string, input: unknown) {
  breakLine()
  const label = name.charAt(0).toUpperCase() + name.slice(1)
  const args = describeArgs(name, input)
  process.stdout.write(
    `${CYAN}⏺${RESET} ${BOLD}${label}${RESET}${args ? `(${DIM}${trunc(args)}${RESET})` : ""}\n`,
  )
}

/** 工具结束：快的不打印（开始行已足够），慢的报耗时 */
export function printToolEnd(name: string, _title: string, ms: number) {
  if (ms < 3000) return
  process.stdout.write(`${DIM}  ⏺ ${name} completed in ${(ms / 1000).toFixed(1)}s${RESET}\n`)
}

export function printError(message: string) {
  process.stdout.write(`${RED}⏺ ${message}${RESET}\n`)
}

export function printDiff(diff: string) {
  for (const line of diff.split("\n")) {
    if (line.startsWith("+")) process.stdout.write(`${GREEN}${line}${RESET}\n`)
    else if (line.startsWith("-")) process.stdout.write(`${RED}${line}${RESET}\n`)
    else if (line.startsWith("@@")) process.stdout.write(`${CYAN}${line}${RESET}\n`)
    else process.stdout.write(`${DIM}${line}${RESET}\n`)
  }
}

export function printNotice(message: string) {
  process.stdout.write(`${YELLOW}${message}${RESET}\n`)
}
