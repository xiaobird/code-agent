import { streamText, type LanguageModel, type ModelMessage, type Tool as AITool } from "ai"

export type TokenUsage = {
  input: number
  output: number
  total: number
  cache: { read: number; write: number }
}
export type LLMEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; id: string; name: string; input: unknown }
  | { type: "tool-result"; id: string; output: unknown }
  | { type: "finish"; reason: string; tokens: TokenUsage }
  | { type: "error"; error: Error }

export async function* streamLLM(input: {
  model: LanguageModel
  system: string[]
  messages: ModelMessage[]
  tools: Record<string, AITool>
  abort: AbortSignal
}): AsyncIterable<LLMEvent> {
  const result = streamText({
    model: input.model,
    system: input.system.filter(Boolean).join("\n"),
    messages: input.messages,
    tools: input.tools,
    abortSignal: input.abort,
    maxRetries: 3, // AI SDK 内置指数退避
  })
  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta":
        yield { type: "text-delta", text: part.text }
        break
      case "reasoning-delta":
        yield { type: "reasoning-delta", text: part.text }
        break
      case "tool-call":
        yield { type: "tool-call", id: part.toolCallId, name: part.toolName, input: part.input }
        break
      case "tool-result":
        yield {
          type: "tool-result",
          id: part.toolCallId,
          output: (part.output as { value?: unknown })?.value ?? part.output,
        }
        break
      case "tool-error":
        yield {
          type: "tool-result",
          id: part.toolCallId,
          output: {
            title: part.toolName,
            output: `Error: ${String(part.error instanceof Error ? part.error.message : part.error)}`,
            metadata: {},
          },
        }
        break
      case "finish": {
        const u = part.totalUsage
        yield {
          type: "finish",
          reason: part.finishReason,
          tokens: {
            input: u.inputTokens ?? 0,
            output: u.outputTokens ?? 0,
            total: u.totalTokens ?? 0,
            cache: {
              read: u.inputTokenDetails?.cacheReadTokens ?? 0,
              write: u.inputTokenDetails?.cacheWriteTokens ?? 0,
            },
          },
        }
        break
      }
      case "error":
        yield {
          type: "error",
          error: part.error instanceof Error ? part.error : new Error(String(part.error)),
        }
        break
    }
  }
}
