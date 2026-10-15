import { createInterface } from "readline"
import { homedir } from "os"
import { randomUUID } from "crypto"
import path from "path"
import { mkdirSync } from "fs"
import { Storage } from "../storage/db"
import { runLoop } from "../session/run"
import { createAsk, type Rule } from "../permission"
import { resolveModel } from "../llm/provider"
import { printBanner, printPrompt, printAssistantHeader, printToolStart, printToolEnd, printError, printNotice, printDiff, printReasoning, printText } from "./render"

const DATA_DIR = path.join(homedir(), ".local", "share", "code-agent")

export async function startRepl(): Promise<void> {
  const modelArg = process.argv.includes("--model")
    ? process.argv[process.argv.indexOf("--model") + 1]
    : undefined
  const resolved = resolveModel(modelArg)

  mkdirSync(DATA_DIR, { recursive: true })
  const storage = new Storage(path.join(DATA_DIR, "db.sqlite"))
  // 崩溃恢复：标记上次会话中残留的 running 工具调用，列出可恢复会话
  const interrupted = storage.interruptRunningToolParts()
  const recent = storage.recentSessions(3)
  if (recent.length) {
    printNotice(
      `${recent.length} session(s) on record (latest: ${new Date(recent[0].time_updated).toLocaleString()})` +
        (interrupted ? `, ${interrupted} interrupted tool call(s) marked` : ""),
    )
  }
  const session = storage.createSession({ directory: process.cwd() })
  const abort = new AbortController()

  const system = [
    "You are a coding agent working in a terminal.",
    `Working directory: ${process.cwd()}`,
    `Platform: ${process.platform}`,
    "Use the available tools to read, search and understand code before answering.",
  ]

  const { registerTaskTool } = await import("../tool/task")
  registerTaskTool({ storage, model: resolved.model, modelInfo: { contextLimit: resolved.contextLimit }, baseSystem: system })

  printBanner(resolved.label)
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "" })

  // 常驻行队列：readline 只在有监听器时派发 'line' 事件，
  // 管道输入下"无监听器期间到达的行"会被丢弃，必须自己排队
  const lineQueue: string[] = []
  let lineWaiter: (() => void) | undefined
  rl.on("line", (l) => {
    lineQueue.push(l)
    lineWaiter?.()
    lineWaiter = undefined
  })
  const nextLine = (): Promise<string> =>
    new Promise((resolve) => {
      if (lineQueue.length) {
        resolve(lineQueue.shift()!)
        return
      }
      lineWaiter = () => resolve(lineQueue.shift()!)
    })

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
  const rlQuestion = async (q: string) => {
    process.stdout.write(q)
    const answer = await nextLine()
    // 交互终端用户敲回车自带换行；管道输入没有回显，补一个换行保持格式
    if (!process.stdin.isTTY) process.stdout.write("\n")
    return answer.trim().toLowerCase()
  }
  const rawAsk = createAsk(defaultRules, rlQuestion)
  const ask = async (req: { permission: string; patterns: string[]; metadata?: Record<string, unknown> }) => {
    if (req.metadata?.diff) printDiff(String(req.metadata.diff))
    await rawAsk(req)
  }

  const question = async () => {
    printPrompt()
    return (await nextLine()).trim()
  }

  while (true) {
    const line = await question()
    if (!line) continue
    if (line === "/exit") break
    if (line === "/revert") {
      const msgs = storage.messagesWithParts(session.id)
      let target: { fromHash?: string; hash: string } | undefined
      for (let i = msgs.length - 1; i >= 0; i--) {
        const p = msgs[i].parts.find((x) => x.type === "patch")
        if (p && p.type === "patch") {
          target = p
          break
        }
      }
      if (!target?.fromHash) printNotice("no snapshot to revert to")
      else {
        const { initSnapshot, revertTo } = await import("../snapshot/index")
        initSnapshot(process.cwd())
        await revertTo(target.fromHash).catch((e: unknown) => printError(String(e)))
        printNotice(`reverted to snapshot ${target.fromHash.slice(0, 12)}`)
      }
      continue
    }
    if (line === "/compact") {
      printNotice("/compact: not implemented")
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
    // 思维链与正文之间的分隔：切换输出类型时换行
    let streamKind: "reasoning" | "text" | null = null
    try {
      await runLoop({
        storage,
        sessionID: session.id,
        model: resolved.model,
        modelInfo: { contextLimit: resolved.contextLimit },
        system,
        worktree: process.cwd(),
        ask,
        onReasoning: (d) => {
          if (streamKind !== "reasoning") {
            if (streamKind === "text") process.stdout.write("\n")
            streamKind = "reasoning"
          }
          printReasoning(d)
        },
        onText: (d) => {
          if (streamKind === "reasoning") process.stdout.write("\n")
          streamKind = "text"
          printText(d)
        },
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
