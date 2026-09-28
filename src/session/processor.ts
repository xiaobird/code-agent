import { randomUUID } from "crypto"
import type { LanguageModel } from "ai"
import type { Storage } from "../storage/db"
import type { Message, MessageWithParts } from "./message"
import { toModelMessages } from "./message"
import { toAISDKTools } from "../tool/registry"
import { streamLLM } from "../llm/stream"
import { isOverflow } from "../compaction/overflow"

export interface ProcessInput {
  storage: Storage
  sessionID: string
  assistantMsg: Message // 已落库的空 assistant 消息
  model: LanguageModel
  modelInfo: { contextLimit: number }
  system: string[]
  messages: MessageWithParts[]
  ask: (req: { permission: string; patterns: string[]; metadata?: Record<string, unknown> }) => Promise<void>
  onText: (delta: string) => void // CLI 流式渲染回调
  onToolStart?: (name: string, input: unknown) => void
  onToolEnd?: (name: string, title: string, ms: number) => void
  abort: AbortSignal
}

export async function processTurn(input: ProcessInput): Promise<"stop" | "continue" | "compact"> {
  const { storage, sessionID, assistantMsg } = input
  let text = ""
  const toolStart = new Map<string, number>()
  const tools = toAISDKTools({ sessionID, abort: input.abort, ask: input.ask, metadata: async () => {} })
  const modelMessages = toModelMessages(input.messages)

  for await (const event of streamLLM({
    model: input.model,
    system: input.system,
    messages: modelMessages,
    tools,
    abort: input.abort,
  })) {
    switch (event.type) {
      case "text-delta":
        text += event.text
        input.onText(event.text)
        break
      case "tool-call":
        toolStart.set(event.id, Date.now())
        input.onToolStart?.(event.name, event.input)
        storage.updatePart({
          id: randomUUID(),
          messageID: assistantMsg.id,
          sessionID,
          type: "tool",
          tool: event.name,
          callID: event.id,
          state: { status: "running", input: (event.input as Record<string, unknown>) ?? {}, time: { start: Date.now() } },
        })
        break
      case "tool-result": {
        const msgs = storage.messagesWithParts(sessionID)
        const part = msgs.flatMap((m) => m.parts).find((p) => p.type === "tool" && p.callID === event.id)
        if (part?.type === "tool") {
          const output = event.output as { output?: string; title?: string; metadata?: Record<string, unknown> }
          const ms = Date.now() - (toolStart.get(event.id) ?? Date.now())
          input.onToolEnd?.(part.tool, output?.title ?? part.tool, ms)
          toolStart.delete(event.id)
          storage.updatePart({
            ...part,
            state: {
              status: "completed",
              input: part.state.input,
              output: output?.output ?? String(event.output),
              title: output?.title ?? part.tool,
              metadata: output?.metadata ?? {},
              time: { start: part.state.time?.start ?? Date.now(), end: Date.now() },
            },
          })
        }
        break
      }
      case "finish": {
        if (text)
          storage.updatePart({ id: randomUUID(), messageID: assistantMsg.id, sessionID, type: "text", text })
        storage.updateMessage({
          ...assistantMsg,
          finish: event.reason,
          tokens: event.tokens,
          time: { created: assistantMsg.time?.created ?? Date.now(), completed: Date.now() },
        })
        if (isOverflow(event.tokens, input.modelInfo.contextLimit)) return "compact"
        break
      }
      case "error":
        storage.updateMessage({
          ...assistantMsg,
          error: event.error.message,
          finish: "error",
          time: { created: assistantMsg.time?.created ?? Date.now(), completed: Date.now() },
        })
        return "stop"
    }
  }
  return "continue"
}
