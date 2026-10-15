import { MockLanguageModelV3, simulateReadableStream } from "ai/test"
import type { LanguageModel } from "ai"

// 本版本（ai 6.x / provider V4 spec）的 provider 层 chunk 形状：
// - text-delta 必须夹在 text-start/text-end 之间，字段名为 `delta`
// - tool-call 需 `dynamic: false` 且 input 为 JSON 字符串，SDK 才会走静态工具执行路径
// - finish 的 finishReason 是 `{ unified, raw }`，usage 是 `{ inputTokens: { total } }` 嵌套
// 这里统一封装，供所有 mock 测试复用。

export function text(text: string) {
  const id = "t" + Math.random().toString(36).slice(2, 8)
  return [
    { type: "text-start" as const, id },
    { type: "text-delta" as const, id, delta: text },
    { type: "text-end" as const, id },
  ]
}

export function reasoning(text: string) {
  const id = "r" + Math.random().toString(36).slice(2, 8)
  return [
    { type: "reasoning-start" as const, id },
    { type: "reasoning-delta" as const, id, delta: text },
    { type: "reasoning-end" as const, id },
  ]
}

export function toolCall(toolCallId: string, toolName: string, input: unknown) {
  return { type: "tool-call" as const, toolCallId, toolName, input: JSON.stringify(input), dynamic: false }
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
      const chunks = turns[call].flat()
      call++
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) }
    },
  })
  return model as unknown as LanguageModel
}
