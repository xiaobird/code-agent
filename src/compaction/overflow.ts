import type { TokenUsage } from "../llm/stream"

export const DEFAULT_RESERVED_BUFFER = Math.min(20000, 8192)

export function isOverflow(tokens: TokenUsage, contextLimit: number, reserved?: number): boolean {
  const buffer = reserved ?? DEFAULT_RESERVED_BUFFER
  return tokens.total >= contextLimit - buffer
}
