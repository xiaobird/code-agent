import { MockLanguageModelV3, simulateReadableStream } from "ai/test"
import type { LanguageModel } from "ai"

// 本版本（ai 6.x / provider V4 spec）的 provider 层 chunk 形状：
// - text-delta 用 `delta` 字段
// - finish 的 finishReason 是 `{ unified, raw }`，usage 是 `{ inputTokens: { total } }` 嵌套
// 这里统一封装，供所有 mock 测试复用。

export function text(text: string) {
  return { type: "text-delta" as const, id: "t", delta: text }
}

export function toolCall(toolCallId: string, toolName: string, input: unknown) {
  return { type: "tool-call" as const, toolCallId, toolName, input }
}

export function finish(reason: string, inputTokens = 1, outputTokens = 1) {
  return {
    type: "finish" as const,
    finishReason: { unified: reason, raw: reason },
    usage: { inputTokens: { total: inputTokens }, outputTokens: { total: outputTokens } },
  }
}

/** 每个 turn 一组 chunk；turn 数耗尽再调用会抛错（用于暴露失控循环）。 */
export function scriptedModel(turns: unknown[][]): LanguageModel {
  let call = 0
  const model = new MockLanguageModelV3({
    doStream: async () => {
      if (call >= turns.length)
        throw new Error(`script exhausted: turn ${call + 1} not scripted (possible runaway loop)`)
      const chunks = turns[call]
      call++
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) }
    },
  })
  return model as unknown as LanguageModel
}
