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

interface ProviderSpec {
  env: string
  altEnv?: string
  contextLimit: number
  defaultModel: string
  create(modelID: string, apiKey: string): LanguageModel
}

const PROVIDERS: Record<string, ProviderSpec> = {
  anthropic: {
    env: "ANTHROPIC_API_KEY",
    contextLimit: 200_000,
    defaultModel: "claude-sonnet-4-5",
    create: (modelID, apiKey) =>
      createAnthropic({ apiKey })(modelID) as unknown as LanguageModel,
  },
  moonshot: {
    env: "MOONSHOT_API_KEY",
    altEnv: "KIMI_API_KEY",
    contextLimit: 128_000,
    defaultModel: "kimi-k2-0905-preview",
    create: (modelID, apiKey) =>
      createOpenAICompatible({
        name: "moonshot",
        baseURL: "https://api.moonshot.cn/v1",
        apiKey,
      })(modelID) as unknown as LanguageModel,
  },
}

function keyOf(spec: ProviderSpec): string | undefined {
  return process.env[spec.env] ?? (spec.altEnv ? process.env[spec.altEnv] : undefined)
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

  const spec = PROVIDERS[provider]
  const apiKey = keyOf(spec)
  if (!apiKey) throw new Error(`${spec.env} is not set`)

  const modelID = arg?.includes("/") ? arg.split("/").slice(1).join("/") : spec.defaultModel
  return {
    model: spec.create(modelID, apiKey),
    provider,
    modelID,
    contextLimit: spec.contextLimit,
    label: `${modelID} via ${provider}`,
  }
}
