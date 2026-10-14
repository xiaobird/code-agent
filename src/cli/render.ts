const DIM = "\x1b[2m"
const BOLD = "\x1b[1m"
const CYAN = "\x1b[36m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const RED = "\x1b[31m"
const RESET = "\x1b[0m"

export function printBanner(modelLabel: string) {
  console.log(`${BOLD}code-agent${RESET} ${DIM}(${modelLabel})${RESET}`)
  console.log(`${DIM}commands: /exit /revert /compact${RESET}`)
}

export function printPrompt() {
  process.stdout.write(`${CYAN}❯${RESET} `)
}

export function printAssistantHeader() {
  process.stdout.write(`\n${BOLD}assistant${RESET}\n`)
}

export function printToolStart(name: string, input: unknown) {
  const brief =
    input && typeof input === "object" && "filePath" in (input as Record<string, unknown>)
      ? ` ${(input as Record<string, unknown>).filePath}`
      : input && typeof input === "object" && "command" in (input as Record<string, unknown>)
        ? ` ${(input as Record<string, unknown>).command}`
        : input && typeof input === "object" && "pattern" in (input as Record<string, unknown>)
          ? ` ${(input as Record<string, unknown>).pattern}`
          : ""
  process.stdout.write(`${DIM}▸ ${name}${brief}${RESET}\n`)
}

export function printToolEnd(name: string, _title: string, ms: number) {
  process.stdout.write(`${GREEN}✓ ${name}${RESET} ${DIM}(${(ms / 1000).toFixed(1)}s)${RESET}\n`)
}

export function printError(message: string) {
  process.stdout.write(`${RED}error: ${message}${RESET}\n`)
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
