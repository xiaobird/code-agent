import { createInterface } from "readline"
import { homedir } from "os"
import { randomUUID } from "crypto"
import path from "path"
import { mkdirSync } from "fs"
import { createAnthropic } from "@ai-sdk/anthropic"
import type { LanguageModel } from "ai"
import { Storage } from "../storage/db"
import { runLoop } from "../session/run"
import { createAsk, type Rule } from "../permission"
import { printBanner, printPrompt, printAssistantHeader, printToolStart, printToolEnd, printError, printNotice, printDiff } from "./render"

const DATA_DIR = path.join(homedir(), ".local", "share", "code-agent")
const CONTEXT_LIMIT = 200_000 // M3 前的临时常量

function resolveModel(arg: string): LanguageModel {
  // 目前仅支持 anthropic provider；--model anthropic/<id>
  const id = arg.includes("/") ? arg.split("/").slice(1).join("/") : arg
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set")
  const anthropic = createAnthropic({ apiKey: key })
  // ai@6 的 LanguageModel 类型联合滞后于 provider V4 spec，运行时兼容，这里收窄类型
  return anthropic(id) as unknown as LanguageModel
}

export async function startRepl(): Promise<void> {
  const modelArg = process.argv.includes("--model")
    ? process.argv[process.argv.indexOf("--model") + 1] ?? "anthropic/claude-sonnet-4-5"
    : "anthropic/claude-sonnet-4-5"
  const model = resolveModel(modelArg)

  mkdirSync(DATA_DIR, { recursive: true })
  const storage = new Storage(path.join(DATA_DIR, "db.sqlite"))
  const session = storage.createSession({ directory: process.cwd() })
  const abort = new AbortController()

  const system = [
    "You are a coding agent working in a terminal.",
    `Working directory: ${process.cwd()}`,
    `Platform: ${process.platform}`,
    "Use the available tools to read, search and understand code before answering.",
  ]

  printBanner()
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "" })

  rl.on("SIGINT", () => {
    abort.abort()
    printNotice("\naborted")
    printPrompt()
  })

  // 默认权限：只读工具放行，写操作与命令执行需确认
  const defaultRules: Rule[] = [
    { permission: "read", pattern: "*", action: "allow" },
    { permission: "grep", pattern: "*", action: "allow" },
    { permission: "glob", pattern: "*", action: "allow" },
  ]
  const rlQuestion = (q: string) =>
    new Promise<string>((resolve) => rl.question(q, (answer) => resolve(answer.trim().toLowerCase())))
  const rawAsk = createAsk(defaultRules, rlQuestion)
  const ask = async (req: { permission: string; patterns: string[]; metadata?: Record<string, unknown> }) => {
    if (req.metadata?.diff) printDiff(String(req.metadata.diff))
    await rawAsk(req)
  }

  const question = () =>
    new Promise<string>((resolve) => {
      printPrompt()
      rl.once("line", (line) => resolve(line.trim()))
    })

  while (true) {
    const line = await question()
    if (!line) continue
    if (line === "/exit") break
    if (line === "/revert" || line === "/compact") {
      printNotice(`${line}: not implemented`)
      continue
    }

    const userMsg = {
      id: randomUUID(),
      sessionID: session.id,
      role: "user" as const,
      time: { created: Date.now() },
    }
    storage.updateMessage(userMsg)
    storage.updatePart({
      id: randomUUID(),
      messageID: userMsg.id,
      sessionID: session.id,
      type: "text",
      text: line,
    })

    printAssistantHeader()
    try {
      await runLoop({
        storage,
        sessionID: session.id,
        model,
        modelInfo: { contextLimit: CONTEXT_LIMIT },
        system,
        ask,
        onText: (d) => process.stdout.write(d),
        onToolStart: printToolStart,
        onToolEnd: printToolEnd,
        abort: abort.signal,
      })
      process.stdout.write("\n\n")
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e))
    }
  }

  rl.close()
}
