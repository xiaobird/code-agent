import type { TokenUsage } from "../llm/stream"

// Task 17 替换为完整版（含预留 buffer）
export const isOverflow = (t: TokenUsage, limit: number) => t.total >= limit
