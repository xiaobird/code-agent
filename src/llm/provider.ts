import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"

export interface ResolvedModel {
  model: LanguageModel
  provider: string
  modelID: string
  contextLimit: number
  label: string
}

/**
 * Kimi Code 端点（api.kimi.com/coding/v1）的 SSE 把 usage 嵌在 choices[0] 里，
 * OpenAI 标准位置是顶层；openai-compatible 只认顶层。这里包一层 fetch，
 * 流式改写每个 data: 行，把 choices[0].usage 提升到顶层。
 */
const kimiUsageFixupFetch: typeof globalThis.fetch = async (input, init) => {
  const res = await globalThis.fetch(input, init)
  if (!res.body || !res.url.includes("/chat/completions")) return res
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let carry = ""
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = res.body!.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          carry += decoder.decode(value, { stream: true })
          const lines = carry.split("\n")
          carry = lines.pop() ?? "" // 末行可能不完整，留到下一块
          for (const line of lines) controller.enqueue(encoder.encode(rewriteLine(line) + "\n"))
        }
        if (carry) controller.enqueue(encoder.encode(rewriteLine(carry)))
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { status: res.status, statusText: res.statusText, headers: res.headers })
}

function rewriteLine(line: string): string {
  if (!line.startsWith("data: ")) return line
  const payload = line.slice(6).trim()
  if (!payload || payload === "[DONE]") return line
  try {
    const obj = JSON.parse(payload) as { usage?: unknown; choices?: { usage?: unknown }[] }
    const usage = obj.choices?.[0]?.usage
    if (usage != null && obj.usage == null) return "data: " + JSON.stringify({ ...obj, usage })
  } catch {
    // 非 JSON 行原样保留
  }
  return line
}

interface ProviderSpec {
  env: string
  altEnv?: string
  defaultModel: string
  contextLimit: number
  create(modelID: string, apiKey: string): LanguageModel
}

/**
 * moonshot 有两个平台，按 key 前缀区分：
 * - `sk-kimi-`：Kimi Code 订阅（api.kimi.com/coding/v1，默认 kimi-for-coding）
 * - 普通 `sk-`：开放平台（api.moonshot.cn/v1，默认 kimi-k3）
 * MOONSHOT_BASE_URL 可强制覆盖。
 */
function moonshotProvider(apiKey: string): ProviderSpec {
  const isKimiCode = apiKey.startsWith("sk-kimi-")
  const baseURL =
    process.env.MOONSHOT_BASE_URL ??
    (isKimiCode ? "https://api.kimi.com/coding/v1" : "https://api.moonshot.cn/v1")
  return {
    env: "MOONSHOT_API_KEY",
    altEnv: "KIMI_API_KEY",
    defaultModel: isKimiCode ? "kimi-for-coding" : "kimi-k3",
    contextLimit: isKimiCode ? 256_000 : 128_000,
    create: (modelID, key) =>
      createOpenAICompatible({
        name: "moonshot",
        baseURL,
        apiKey: key,
        ...(isKimiCode ? { fetch: kimiUsageFixupFetch } : {}),
      })(modelID) as unknown as LanguageModel,
  }
}

const PROVIDERS: Record<string, ProviderSpec> = {
  anthropic: {
    env: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-5",
    contextLimit: 200_000,
    create: (modelID, apiKey) =>
      createAnthropic({ apiKey })(modelID) as unknown as LanguageModel,
  },
  moonshot: {
    env: "MOONSHOT_API_KEY",
    altEnv: "KIMI_API_KEY",
    defaultModel: "", // 由 moonshotProvider 按 key 决定
    contextLimit: 128_000,
    create: (modelID, apiKey) => moonshotProvider(apiKey).create(modelID, apiKey),
  },
}

function keyOf(spec: ProviderSpec): string | undefined {
  return process.env[spec.env] ?? (spec.altEnv ? process.env[spec.altEnv] : undefined)
}

/** moonshot 的默认模型/上下文随 key 平台变化，这里单独解析 */
function specFor(provider: string, apiKey: string): ProviderSpec {
  return provider === "moonshot" ? moonshotProvider(apiKey) : PROVIDERS[provider]
}

/**
 * 解析 `--model provider/id` 参数；未指定时按可用 env key 自动选择 provider。
 * ai@6 的 LanguageModel 类型联合滞后于 provider V4 spec，运行时兼容，各 create 内收窄类型。
 */
export function resolveModel(arg?: string): ResolvedModel {
  const provider = arg?.includes("/")
    ? arg.split("/")[0]
    : Object.keys(PROVIDERS).find((p) => keyOf(PROVIDERS[p]))

  if (!provider || !PROVIDERS[provider]) {
    const supported = Object.entries(PROVIDERS)
      .map(([name, s]) => `${name} (env: ${s.env})`)
      .join(", ")
    throw new Error(
      `No model provider available. Set one of the API keys or pass --model provider/id. Supported: ${supported}`,
    )
  }

  const apiKey = keyOf(PROVIDERS[provider])
  if (!apiKey) throw new Error(`${PROVIDERS[provider].env} is not set`)

  const spec = specFor(provider, apiKey)
  const modelID = arg?.includes("/") ? arg.split("/").slice(1).join("/") : spec.defaultModel
  return {
    model: spec.create(modelID, apiKey),
    provider,
    modelID,
    contextLimit: spec.contextLimit,
    label: `${modelID} via ${provider}`,
  }
}
