# Code Agent 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从零实现一个 TypeScript code agent，复刻 opencode 核心架构：双层循环 + 5 工具 + SQLite 持久化 + 子 agent + 压缩 + 快照。

**Architecture:** 外层 runLoop（while 循环，每轮从 DB 重建上下文）+ 内层 AI SDK streamText 单 step；agent 是配置记录；DB 是唯一事实源。

**Tech Stack:** Node 20+, TypeScript, tsx, vitest, AI SDK v6 (`ai` + `@ai-sdk/anthropic`), better-sqlite3, fast-glob, diff

**Spec:** `docs/superpowers/specs/2026-09-24-code-agent-design.md`

## Global Constraints

- 不使用 Effect、LSP、MCP、tree-sitter、apply_patch（spec §10 YAGNI 清单）
- read：2000 行软墙 / 单行 2000 字符 / 50KB 硬墙（spec §3.2）
- prune：保护最近 40,000 token，最小清理量 20,000 token（spec §4②）
- compaction：保留最近 2 个用户轮次，预算 = 可用上下文 25%，钳制 2,000–8,000 token（spec §4③）
- token 估算：`Math.ceil(text.length / 4)`
- 所有测试禁止真实 API 调用（CI 零网络）
- 包管理用 npm；测试命令 `npx vitest run <file>`；运行入口 `npx tsx src/index.ts`

---

### Task 1: 项目脚手架

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `src/util/wildcard.ts`
- Test: `test/util/wildcard.test.ts`

**Interfaces:**
- Produces: `wildcardMatch(pattern: string, value: string): boolean`（`*` 匹配任意字符序列）

- [ ] **Step 1: 初始化项目**

```bash
mkdir -p code-agent && cd code-agent
npm init -y
npm install ai @ai-sdk/anthropic better-sqlite3 fast-glob diff
npm install -D typescript tsx vitest @types/node @types/better-sqlite3 @types/diff
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "types": ["node"], "noEmit": true
  },
  "include": ["src", "test"]
}
```

`package.json` 追加：`"type": "module"`，scripts: `{ "test": "vitest run", "dev": "tsx src/index.ts" }`

- [ ] **Step 2: 写 wildcard 失败测试**

```ts
// test/util/wildcard.test.ts
import { expect, test } from "vitest"
import { wildcardMatch } from "../../src/util/wildcard"

test("star matches any sequence", () => {
  expect(wildcardMatch("*", "anything")).toBe(true)
  expect(wildcardMatch("rm *", "rm -rf /")).toBe(true)
  expect(wildcardMatch("*.env", ".env")).toBe(true)
  expect(wildcardMatch("git *", "npm install")).toBe(false)
  expect(wildcardMatch("read", "read")).toBe(true)
})
```

- [ ] **Step 3: 验证失败**

Run: `npx vitest run test/util/wildcard.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现**

```ts
// src/util/wildcard.ts
export function wildcardMatch(pattern: string, value: string): boolean {
  const regex = new RegExp("^" + pattern.split("*").map(escapeRegex).join(".*") + "$")
  return regex.test(value)
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
```

- [ ] **Step 5: 验证通过并提交**

Run: `npx vitest run test/util/wildcard.test.ts` → PASS
```bash
git add -A && git commit -m "feat: project scaffold + wildcard matcher"
```

---

### Task 2: SQLite 存储层

**Files:**
- Create: `src/storage/schema.sql`, `src/storage/db.ts`
- Test: `test/storage/db.test.ts`

**Interfaces:**
- Produces:
  - `class Storage { constructor(dbPath: string) }`
  - `createSession(input: { directory: string; parentID?: string }): Session`
  - `updateMessage(msg: Message): void`（upsert）
  - `updatePart(part: Part): void`（upsert）
  - `messagesWithParts(sessionID: string): MessageWithParts[]`（按时间升序）
- 类型见 Task 3（`Message`/`Part` 由 message.ts 定义，db.ts 从 message.ts import 类型，避免循环依赖：db.ts 只存取 `data` JSON 字符串，类型标注用泛型 `T = unknown`）

`schema.sql`（与 spec §7 一致，逐字使用）：
```sql
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  title TEXT NOT NULL,
  directory TEXT NOT NULL,
  agent TEXT, model TEXT, permission TEXT,
  time_created INTEGER, time_updated INTEGER
);
CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  time_created INTEGER,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS msg_session_idx ON message(session_id, time_created, id);
CREATE TABLE IF NOT EXISTS part (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  time_created INTEGER,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS part_msg_idx ON part(message_id, id);
```

- [ ] **Step 1: 写失败测试**

```ts
// test/storage/db.test.ts
import { expect, test } from "vitest"
import { Storage } from "../../src/storage/db"

test("session/message/part roundtrip", () => {
  const s = new Storage(":memory:")
  const session = s.createSession({ directory: "/tmp/x" })
  s.updateMessage({ id: "m1", sessionID: session.id, role: "user", time: { created: 1 } })
  s.updatePart({ id: "p1", messageID: "m1", sessionID: session.id, type: "text", text: "hi" })
  const msgs = s.messagesWithParts(session.id)
  expect(msgs).toHaveLength(1)
  expect(msgs[0].info.role).toBe("user")
  expect(msgs[0].parts[0]).toMatchObject({ type: "text", text: "hi" })
})
```

- [ ] **Step 2: 验证失败** — `npx vitest run test/storage/db.test.ts` → FAIL

- [ ] **Step 3: 实现 db.ts**

```ts
// src/storage/db.ts
import Database from "better-sqlite3"
import { readFileSync } from "fs"
import { randomUUID } from "crypto"
import path from "path"

export class Storage {
  private db: Database.Database
  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma("journal_mode = WAL")
    this.db.exec(readFileSync(path.join(import.meta.dirname, "schema.sql"), "utf-8"))
  }
  createSession(input: { directory: string; parentID?: string }) {
    const session = {
      id: randomUUID(), parentID: input.parentID ?? null, title: "New session",
      directory: input.directory, time_created: Date.now(), time_updated: Date.now(),
    }
    this.db.prepare(
      "INSERT INTO session (id, parent_id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?,?)",
    ).run(session.id, session.parentID, session.title, session.directory, session.time_created, session.time_updated)
    return session
  }
  updateMessage(msg: { id: string; sessionID: string; time?: { created: number }; [k: string]: unknown }) {
    const { id, sessionID, ...data } = msg
    const created = msg.time?.created ?? Date.now()
    this.db.prepare(
      `INSERT INTO message (id, session_id, time_created, data) VALUES (?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
    ).run(id, sessionID, created, JSON.stringify(data))
  }
  updatePart(part: { id: string; messageID: string; sessionID: string; [k: string]: unknown }) {
    const { id, messageID, sessionID, ...data } = part
    this.db.prepare(
      `INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
    ).run(id, messageID, sessionID, Date.now(), JSON.stringify(data))
  }
  messagesWithParts(sessionID: string) {
    const msgs = this.db.prepare(
      "SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created, id",
    ).all(sessionID) as { id: string; data: string }[]
    const partStmt = this.db.prepare("SELECT id, data FROM part WHERE message_id = ? ORDER BY id")
    return msgs.map((m) => ({
      info: { id: m.id, sessionID, ...JSON.parse(m.data) },
      parts: (partStmt.all(m.id) as { id: string; data: string }[]).map(
        (p) => ({ id: p.id, messageID: m.id, sessionID, ...JSON.parse(p.data) }),
      ),
    }))
  }
}
```

- [ ] **Step 4: 验证通过并提交**

`npx vitest run test/storage/db.test.ts` → PASS
```bash
git add -A && git commit -m "feat: sqlite storage layer"
```

---

### Task 3: 消息模型与上下文组装

**Files:**
- Create: `src/session/message.ts`
- Test: `test/session/message.test.ts`

**Interfaces:**
- Consumes: `Storage.messagesWithParts`（Task 2）
- Produces:
  - 类型 `Message`、`Part`（`TextPart | ToolPart | CompactionPart | PatchPart`）、`MessageWithParts`
  - `latest(msgs: MessageWithParts[]): { lastUser?: Message; lastAssistant?: Message }`
  - `hasPendingToolCalls(msg: MessageWithParts): boolean`
  - `toModelMessages(msgs: MessageWithParts[]): ModelMessage[]`（AI SDK 类型）
  - `filterCompacted(msgs: MessageWithParts[]): MessageWithParts[]`（M3 用，本任务先实现恒等返回，Task 21 补全）

关键规则（对应 opencode message-v2.ts）：
- ToolPart completed 且 `state.time.compacted` → output 渲染为 `"[Old tool result content cleared]"`
- ToolPart → assistant 消息的 `tool-call` content part + 紧随一条 role:"tool" 消息携带 `tool-result`
- compaction user 消息的 text 渲染为 `"What did we do so far?"`

- [ ] **Step 1: 写失败测试**

```ts
// test/session/message.test.ts
import { expect, test } from "vitest"
import { toModelMessages, hasPendingToolCalls } from "../../src/session/message"

const base = { sessionID: "s1" }
test("tool call pair becomes assistant tool-call + tool result", () => {
  const msgs = [
    { info: { ...base, id: "u1", role: "user" as const }, parts: [{ ...base, id: "p1", messageID: "u1", type: "text" as const, text: "hi" }] },
    { info: { ...base, id: "a1", role: "assistant" as const }, parts: [
      { ...base, id: "p2", messageID: "a1", type: "tool" as const, tool: "read", callID: "c1",
        state: { status: "completed" as const, input: { filePath: "/x" }, output: "file content", title: "x", metadata: {}, time: { start: 1, end: 2 } } },
    ]},
  ]
  const out = toModelMessages(msgs)
  expect(out[0]).toMatchObject({ role: "user" })
  expect(out[1].role).toBe("assistant")
  expect(out[2].role).toBe("tool")
})

test("compacted tool output is cleared", () => {
  const msgs = [{ info: { ...base, id: "a1", role: "assistant" as const }, parts: [
    { ...base, id: "p2", messageID: "a1", type: "tool" as const, tool: "read", callID: "c1",
      state: { status: "completed" as const, input: {}, output: "huge...", title: "", metadata: {}, time: { start: 1, end: 2, compacted: 3 } } },
  ]}]
  const out = toModelMessages(msgs)
  expect(JSON.stringify(out)).toContain("[Old tool result content cleared]")
  expect(JSON.stringify(out)).not.toContain("huge...")
})

test("pending tool call detection", () => {
  const msg = { info: { ...base, id: "a1", role: "assistant" as const, finish: "stop" }, parts: [
    { ...base, id: "p2", messageID: "a1", type: "tool" as const, tool: "read", callID: "c1",
      state: { status: "running" as const, input: {}, time: { start: 1 } } },
  ]}
  expect(hasPendingToolCalls(msg)).toBe(true)
})
```

- [ ] **Step 2: 验证失败** — `npx vitest run test/session/message.test.ts` → FAIL

- [ ] **Step 3: 实现 message.ts**

```ts
// src/session/message.ts
import type { ModelMessage } from "ai"

export type Message = { id: string; sessionID: string; role: "user" | "assistant"
  finish?: string; summary?: boolean; parentID?: string; agent?: string
  tokens?: { total?: number; input: number; output: number; cache: { read: number; write: number } }
  time: { created: number; completed?: number }; [k: string]: unknown }
export type Part = { id: string; messageID: string; sessionID: string } & (
  | { type: "text"; text: string }
  | { type: "tool"; tool: string; callID: string; state: ToolState }
  | { type: "compaction"; auto: boolean; tail_start_id?: string }
  | { type: "patch"; hash: string; files: string[] }
)
export type ToolState =
  | { status: "pending" | "running"; input: Record<string, unknown>; time?: { start: number } }
  | { status: "completed"; input: Record<string, unknown>; output: string; title: string
      metadata: Record<string, unknown>; time: { start: number; end: number; compacted?: number } }
  | { status: "error"; input: Record<string, unknown>; error: string; time: { start: number; end: number } }
export type MessageWithParts = { info: Message; parts: Part[] }

export function latest(msgs: MessageWithParts[]) {
  let lastUser: Message | undefined, lastAssistant: Message | undefined
  for (const m of msgs) {
    if (m.info.role === "user") lastUser = m.info
    else lastAssistant = m.info
  }
  return { lastUser, lastAssistant }
}

export function hasPendingToolCalls(msg: MessageWithParts): boolean {
  return msg.parts.some((p) => p.type === "tool" && (p.state.status === "pending" || p.state.status === "running"))
}

export function filterCompacted(msgs: MessageWithParts[]): MessageWithParts[] {
  return msgs // Task 21 实现真正的压缩过滤
}

export function toModelMessages(msgs: MessageWithParts[]): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const msg of msgs) {
    if (msg.info.role === "user") {
      const text = msg.parts.map((p) =>
        p.type === "text" ? p.text : p.type === "compaction" ? "What did we do so far?" : "",
      ).filter(Boolean).join("\n")
      if (text) out.push({ role: "user", content: text })
      continue
    }
    const content: unknown[] = []
    const toolResults: unknown[] = []
    for (const part of msg.parts) {
      if (part.type === "text") content.push({ type: "text", text: part.text })
      if (part.type === "tool") {
        content.push({ type: "tool-call", toolCallId: part.callID, toolName: part.tool, input: part.state.input })
        if (part.state.status === "completed") {
          toolResults.push({ type: "tool-result", toolCallId: part.callID, toolName: part.tool,
            output: { type: "text", value: part.state.time.compacted
              ? "[Old tool result content cleared]" : part.state.output } })
        }
        if (part.state.status === "error") {
          toolResults.push({ type: "tool-result", toolCallId: part.callID, toolName: part.tool,
            output: { type: "text", value: `Error: ${part.state.error}` } })
        }
      }
    }
    if (content.length) out.push({ role: "assistant", content: content as never })
    if (toolResults.length) out.push({ role: "tool", content: toolResults as never })
  }
  return out
}
```

- [ ] **Step 4: 验证通过并提交**

`npx vitest run test/session/message.test.ts` → PASS
```bash
git add -A && git commit -m "feat: message model + model message conversion"
```

---

### Task 4: 工具接口与注册表

**Files:**
- Create: `src/tool/tool.ts`, `src/tool/registry.ts`
- Test: `test/tool/registry.test.ts`

**Interfaces:**
- Produces:
  - `ToolDef` / `ToolContext` / `ToolResult`（签名逐字取自 spec §3.1）
  - `registerTool(def: ToolDef): void`、`getTools(): ToolDef[]`
  - `toAISDKTools(ctx: ToolContext): Record<string, AITool>` — 包装 execute：调 `ctx.ask` → 执行 → 异常归一化为 `{ output: "Error: ..." }` 不抛出（错误回喂模型）

- [ ] **Step 1: 写失败测试**

```ts
// test/tool/registry.test.ts
import { expect, test } from "vitest"
import { registerTool, toAISDKTools } from "../../src/tool/registry"

test("wraps tool for AI SDK and normalizes errors", async () => {
  registerTool({
    id: "boom", description: "fails", parameters: { type: "object", properties: {} },
    async execute() { throw new Error("kaboom") },
  })
  const tools = toAISDKTools({ sessionID: "s", abort: new AbortController().signal,
    ask: async () => {}, metadata: async () => {} })
  const result = await tools.boom.execute!({}, { toolCallId: "t1", messages: [] })
  expect(result.output).toContain("kaboom")
})
```

- [ ] **Step 2: 验证失败** → FAIL

- [ ] **Step 3: 实现**

```ts
// src/tool/tool.ts
export interface ToolDef<P = Record<string, unknown>> {
  id: string
  description: string
  parameters: Record<string, unknown>          // JSON Schema
  execute(args: P, ctx: ToolContext): Promise<ToolResult>
}
export interface ToolContext {
  sessionID: string
  abort: AbortSignal
  ask(req: { permission: string; patterns: string[]; metadata?: Record<string, unknown> }): Promise<void>
  metadata(patch: { title?: string; metadata?: Record<string, unknown> }): Promise<void>
}
export interface ToolResult { title: string; output: string; metadata?: Record<string, unknown> }
```

```ts
// src/tool/registry.ts
import { tool, jsonSchema, type Tool as AITool } from "ai"
import type { ToolDef, ToolContext } from "./tool"

const registry = new Map<string, ToolDef>()
export function registerTool(def: ToolDef): void { registry.set(def.id, def) }
export function getTools(): ToolDef[] { return [...registry.values()] }

export function toAISDKTools(ctx: ToolContext): Record<string, AITool> {
  return Object.fromEntries([...registry.values()].map((def) => [def.id, tool({
    description: def.description,
    inputSchema: jsonSchema(def.parameters as never),
    async execute(args) {
      try {
        return await def.execute(args as Record<string, unknown>, ctx)
      } catch (e) {
        return { title: def.id, output: `Error: ${e instanceof Error ? e.message : String(e)}` }
      }
    },
  })]))
}
```

- [ ] **Step 4: 验证通过并提交**

```bash
npx vitest run test/tool/registry.test.ts
git add -A && git commit -m "feat: tool interface + AI SDK registry"
```

---

### Task 5: read 工具（三重截断）

**Files:**
- Create: `src/tool/read.ts`
- Test: `test/tool/read.test.ts`

**Interfaces:**
- Consumes: `registerTool`（Task 4）
- Produces: 工具 id `"read"`，参数 `{ filePath: string; offset?: number; limit?: number }`
- 限量常量（导出供测试）：`READ_MAX_LINES = 2000`、`READ_MAX_LINE_LENGTH = 2000`、`READ_MAX_BYTES = 50 * 1024`

行为契约（spec §3.2）：
- 目录 → `<entries>` 列表 + offset/limit 分页
- 不存在 → 报错含 `Did you mean`（同目录模糊匹配 ≤3 个）
- 二进制（含 `\0` 或采样 4KB 中不可打印字符 >30%）→ 报错
- 文本 → 行号前缀输出；三墙：行数到限置 `more` 继续数总行；单行超长截断；50KB 到限置 `cut` 立即停
- 尾部标记三选一（cut / more / 完整）

- [ ] **Step 1: 写失败测试**

```ts
// test/tool/read.test.ts
import { expect, test } from "vitest"
import { mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { executeRead } from "../../src/tool/read"

const ctx = { sessionID: "s", abort: new AbortController().signal, ask: async () => {}, metadata: async () => {} }

test("reads with line numbers and end marker", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "read-"))
  writeFileSync(path.join(dir, "a.txt"), "foo\nbar\n")
  const r = await executeRead({ filePath: path.join(dir, "a.txt") }, ctx)
  expect(r.output).toContain("1: foo")
  expect(r.output).toContain("(End of file - total 2 lines)")
})

test("line limit produces continue hint", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "read-"))
  writeFileSync(path.join(dir, "big.txt"), Array.from({ length: 50 }, (_, i) => `line${i}`).join("\n"))
  const r = await executeRead({ filePath: path.join(dir, "big.txt"), limit: 10 }, ctx)
  expect(r.output).toContain("(Showing lines 1-10 of 50. Use offset=11 to continue.)")
})

test("binary file rejected", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "read-"))
  writeFileSync(path.join(dir, "b.bin"), Buffer.from([0, 1, 2, 3]))
  await expect(executeRead({ filePath: path.join(dir, "b.bin") }, ctx)).rejects.toThrow("binary")
})
```

- [ ] **Step 2: 验证失败** → FAIL

- [ ] **Step 3: 实现 read.ts**

```ts
// src/tool/read.ts
import { readFileSync, readdirSync, statSync } from "fs"
import path from "path"
import { registerTool, } from "./registry"
import type { ToolContext, ToolResult } from "./tool"

export const READ_MAX_LINES = 2000
export const READ_MAX_LINE_LENGTH = 2000
export const READ_MAX_BYTES = 50 * 1024

export async function executeRead(
  params: { filePath: string; offset?: number; limit?: number },
  ctx: ToolContext,
): Promise<ToolResult> {
  const filePath = path.resolve(params.filePath)
  await ctx.ask({ permission: "read", patterns: [filePath] })

  let stat
  try { stat = statSync(filePath) } catch {
    const dir = path.dirname(filePath), base = path.basename(filePath).toLowerCase()
    const similar = readdirSync(dir).filter((n) =>
      n.toLowerCase().includes(base) || base.includes(n.toLowerCase())).slice(0, 3)
    throw new Error(`File not found: ${filePath}` +
      (similar.length ? `\n\nDid you mean one of these?\n${similar.join("\n")}` : ""))
  }

  if (stat.isDirectory()) {
    const entries = readdirSync(filePath).map((n) =>
      statSync(path.join(filePath, n)).isDirectory() ? n + "/" : n).sort()
    const offset = params.offset ?? 1
    const sliced = entries.slice(offset - 1, offset - 1 + (params.limit ?? READ_MAX_LINES))
    const truncated = offset - 1 + sliced.length < entries.length
    return { title: path.basename(filePath), output: [
      `<path>${filePath}</path>`, `<type>directory</type>`, `<entries>`,
      ...sliced,
      truncated ? `(Showing ${sliced.length} of ${entries.length} entries. Use 'offset' to continue.)`
                : `(${entries.length} entries)`,
      `</entries>`].join("\n"), metadata: { truncated } }
  }

  const sample = readFileSync(filePath).subarray(0, 4096)
  if (sample.includes(0) || [...sample].filter((b) => b < 9 || (b > 13 && b < 32)).length / sample.length > 0.3)
    throw new Error(`Cannot read binary file: ${filePath}`)

  const all = readFileSync(filePath, "utf-8").split("\n")
  const offset = params.offset ?? 1
  const limit = params.limit ?? READ_MAX_LINES
  if (offset > all.length && all.length > 0)
    throw new Error(`Offset ${offset} is out of range for this file (${all.length} lines)`)

  const raw: string[] = []
  let bytes = 0, cut = false
  for (let i = offset - 1; i < all.length && raw.length < limit; i++) {
    const line = all[i].length > READ_MAX_LINE_LENGTH
      ? all[i].slice(0, READ_MAX_LINE_LENGTH) + `... (line truncated to ${READ_MAX_LINE_LENGTH} chars)` : all[i]
    const size = Buffer.byteLength(line) + 1
    if (bytes + size > READ_MAX_BYTES) { cut = true; break }
    raw.push(line); bytes += size
  }
  const last = offset + raw.length - 1
  const more = last < all.length
  const marker = cut ? `(Output capped at 50 KB. Showing lines ${offset}-${last}. Use offset=${last + 1} to continue.)`
    : more ? `(Showing lines ${offset}-${last} of ${all.length}. Use offset=${last + 1} to continue.)`
    : `(End of file - total ${all.length} lines)`

  return { title: path.basename(filePath), metadata: { truncated: cut || more }, output: [
    `<path>${filePath}</path>`, `<type>file</type>`, `<content>`,
    raw.map((l, i) => `${offset + i}: ${l}`).join("\n"),
    "", marker, `</content>`].join("\n") }
}

registerTool({
  id: "read",
  description: `Read a file or directory. Returns up to 2000 lines with line numbers.
Use offset/limit to paginate. Use grep to locate content in large files.
Avoid tiny repeated slices; read a larger window when more context is needed.`,
  parameters: { type: "object", required: ["filePath"], properties: {
    filePath: { type: "string", description: "Absolute path to file or directory" },
    offset: { type: "number", description: "Line number to start from (1-indexed)" },
    limit: { type: "number", description: "Max lines (default 2000)" },
  } },
  execute: executeRead,
})
```

- [ ] **Step 4: 验证通过并提交**

```bash
npx vitest run test/tool/read.test.ts
git add -A && git commit -m "feat: read tool with three-wall truncation"
```

---

### Task 6: grep 工具

**Files:**
- Create: `src/tool/grep.ts`
- Test: `test/tool/grep.test.ts`

**Interfaces:**
- Produces: 工具 id `"grep"`，参数 `{ pattern: string; path?: string; include?: string }`
- 调系统 `rg`，限 100 条；输出格式 `Found N matches` + `path:` + `  Line M: text`；无结果返回 `"No files found"`

- [ ] **Step 1: 写失败测试**

```ts
// test/tool/grep.test.ts
import { expect, test } from "vitest"
import { mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { executeGrep } from "../../src/tool/grep"

const ctx = { sessionID: "s", abort: new AbortController().signal, ask: async () => {}, metadata: async () => {} }

test("finds matches with line numbers", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "grep-"))
  writeFileSync(path.join(dir, "a.ts"), "const runLoop = 1\nconst other = 2\n")
  const r = await executeGrep({ pattern: "runLoop", path: dir }, ctx)
  expect(r.output).toContain("Found 1 matches")
  expect(r.output).toContain("Line 1: const runLoop = 1")
})

test("no matches", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "grep-"))
  const r = await executeGrep({ pattern: "zzz", path: dir }, ctx)
  expect(r.output).toBe("No files found")
})
```

- [ ] **Step 2: 验证失败** → FAIL

- [ ] **Step 3: 实现**

```ts
// src/tool/grep.ts
import { execFile } from "child_process"
import { promisify } from "util"
import path from "path"
import { registerTool } from "./registry"
import type { ToolContext, ToolResult } from "./tool"

const execFileP = promisify(execFile)
const LIMIT = 100

export async function executeGrep(
  params: { pattern: string; path?: string; include?: string },
  ctx: ToolContext,
): Promise<ToolResult> {
  await ctx.ask({ permission: "grep", patterns: [params.pattern] })
  const cwd = params.path ?? process.cwd()
  const args = ["--line-number", "--max-count", String(LIMIT), "--color", "never"]
  if (params.include) args.push("--glob", params.include)
  args.push(params.pattern, ".")
  const { stdout } = await execFileP("rg", args, { cwd }).catch((e: { code?: number }) => {
    if (e.code === 1) return { stdout: "" } // rg: 1 = no matches
    throw e
  })
  const lines = stdout.trim().split("\n").filter(Boolean)
  if (!lines.length) return { title: params.pattern, output: "No files found", metadata: { matches: 0 } }
  let current = ""
  const out = [`Found ${lines.length} matches${lines.length >= LIMIT ? " (more available)" : ""}`]
  for (const line of lines) {
    const idx = line.indexOf(":")
    const file = line.slice(0, idx), rest = line.slice(idx + 1)
    const idx2 = rest.indexOf(":")
    if (current !== file) { if (current) out.push(""); current = file; out.push(`${path.resolve(cwd, file)}:`) }
    out.push(`  Line ${rest.slice(0, idx2)}: ${rest.slice(idx2 + 1)}`)
  }
  return { title: params.pattern, output: out.join("\n"), metadata: { matches: lines.length } }
}

registerTool({
  id: "grep",
  description: "Search file contents with regex (ripgrep). Max 100 matches. Use include to filter file types (e.g. '*.ts').",
  parameters: { type: "object", required: ["pattern"], properties: {
    pattern: { type: "string" }, path: { type: "string" }, include: { type: "string" },
  } },
  execute: executeGrep,
})
```

- [ ] **Step 4: 验证通过并提交**

```bash
which rg || brew install ripgrep   # 依赖系统 rg
npx vitest run test/tool/grep.test.ts
git add -A && git commit -m "feat: grep tool via ripgrep"
```

---

### Task 7: glob 工具

**Files:**
- Create: `src/tool/glob.ts`
- Test: `test/tool/glob.test.ts`

**Interfaces:**
- Produces: 工具 id `"glob"`，参数 `{ pattern: string; path?: string }`；限 100 条按 mtime 倒序；无结果返回 `"No files found"`

- [ ] **Step 1: 写失败测试**

```ts
// test/tool/glob.test.ts
import { expect, test } from "vitest"
import { mkdtempSync, writeFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { executeGlob } from "../../src/tool/glob"

const ctx = { sessionID: "s", abort: new AbortController().signal, ask: async () => {}, metadata: async () => {} }

test("matches files by pattern", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "glob-"))
  mkdirSync(path.join(dir, "src"))
  writeFileSync(path.join(dir, "src", "a.ts"), "")
  writeFileSync(path.join(dir, "b.md"), "")
  const r = await executeGlob({ pattern: "**/*.ts", path: dir }, ctx)
  expect(r.output).toContain("a.ts")
  expect(r.output).not.toContain("b.md")
})
```

- [ ] **Step 2: 验证失败** → FAIL

- [ ] **Step 3: 实现**

```ts
// src/tool/glob.ts
import fg from "fast-glob"
import { statSync } from "fs"
import path from "path"
import { registerTool } from "./registry"
import type { ToolContext, ToolResult } from "./tool"

const LIMIT = 100

export async function executeGlob(
  params: { pattern: string; path?: string },
  ctx: ToolContext,
): Promise<ToolResult> {
  await ctx.ask({ permission: "glob", patterns: [params.pattern] })
  const cwd = params.path ?? process.cwd()
  const files = await fg(params.pattern, { cwd, absolute: true, onlyFiles: true, dot: false })
  const sorted = files
    .map((f) => ({ f, mtime: statSync(f).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, LIMIT)
  if (!sorted.length) return { title: params.pattern, output: "No files found", metadata: { matches: 0 } }
  return { title: params.pattern, output: sorted.map((x) => x.f).join("\n") +
    (files.length > LIMIT ? `\n(Results truncated to ${LIMIT})` : ""),
    metadata: { matches: sorted.length } }
}

registerTool({
  id: "glob",
  description: "Find files by glob pattern (e.g. 'src/**/*.ts'). Returns up to 100 paths sorted by modification time.",
  parameters: { type: "object", required: ["pattern"], properties: {
    pattern: { type: "string" }, path: { type: "string" },
  } },
  execute: executeGlob,
})
```

- [ ] **Step 4: 验证通过并提交**

```bash
npx vitest run test/tool/glob.test.ts
git add -A && git commit -m "feat: glob tool"
```

---

### Task 8: LLM 流封装

**Files:**
- Create: `src/llm/stream.ts`
- Test: `test/llm/stream.test.ts`

**Interfaces:**
- Produces:
  - `type LLMEvent = { type: "text-delta"; text: string } | { type: "tool-call"; id: string; name: string; input: unknown } | { type: "tool-result"; id: string; output: unknown } | { type: "finish"; reason: string; tokens: TokenUsage } | { type: "error"; error: Error }`
  - `streamLLM(input: { model: LanguageModel; system: string[]; messages: ModelMessage[]; tools: Record<string, AITool>; abort: AbortSignal }): AsyncIterable<LLMEvent>`
  - 内部：`streamText`（不传 stopWhen，单 step）→ `fullStream` 映射为 LLMEvent；429/5xx/网络错误指数退避重试 3 次（1s/2s/4s）

- [ ] **Step 1: 写失败测试（用 AI SDK MockLanguageModel）**

```ts
// test/llm/stream.test.ts
import { expect, test } from "vitest"
import { MockLanguageModelV3, simulateReadableStream } from "ai/test"
import { streamLLM } from "../../src/llm/stream"

test("maps text deltas and finish", async () => {
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks: [
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "hello" },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      ]}),
    }),
  })
  const events = []
  for await (const e of streamLLM({ model: model as never, system: [], messages: [], tools: {},
    abort: new AbortController().signal })) events.push(e)
  expect(events[0]).toMatchObject({ type: "text-delta", text: "hello" })
  expect(events.at(-1)).toMatchObject({ type: "finish", reason: "stop" })
})
```

- [ ] **Step 2: 验证失败** → FAIL

- [ ] **Step 3: 实现**

```ts
// src/llm/stream.ts
import { streamText, type LanguageModel, type ModelMessage, type Tool as AITool } from "ai"

export type TokenUsage = { input: number; output: number; total: number; cache: { read: number; write: number } }
export type LLMEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; id: string; name: string; input: unknown }
  | { type: "tool-result"; id: string; output: unknown }
  | { type: "finish"; reason: string; tokens: TokenUsage }
  | { type: "error"; error: Error }

export async function* streamLLM(input: {
  model: LanguageModel; system: string[]; messages: ModelMessage[]
  tools: Record<string, AITool>; abort: AbortSignal
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
      case "text-delta": yield { type: "text-delta", text: part.text }; break
      case "tool-call":
        yield { type: "tool-call", id: part.toolCallId, name: part.toolName, input: part.input }; break
      case "tool-result":
        yield { type: "tool-result", id: part.toolCallId,
          output: (part.output as { value?: unknown })?.value ?? part.output }; break
      case "finish": {
        const u = part.totalUsage
        yield { type: "finish", reason: part.finishReason, tokens: {
          input: u.inputTokens ?? 0, output: u.outputTokens ?? 0, total: u.totalTokens ?? 0,
          cache: { read: 0, write: 0 } } }
        break
      }
      case "error":
        yield { type: "error", error: part.error instanceof Error ? part.error : new Error(String(part.error)) }
        break
    }
  }
}
```

- [ ] **Step 4: 验证通过并提交**

```bash
npx vitest run test/llm/stream.test.ts
git add -A && git commit -m "feat: LLM stream wrapper with event normalization"
```

---

### Task 9: processor — 单轮 LLM 处理

**Files:**
- Create: `src/session/processor.ts`
- Test: `test/session/processor.test.ts`

**Interfaces:**
- Consumes: `streamLLM`（Task 8）、`Storage`（Task 2）、`toModelMessages`（Task 3）、`toAISDKTools`（Task 4）
- Produces: `processTurn(input: ProcessInput): Promise<"stop" | "continue" | "compact">`

```ts
interface ProcessInput {
  storage: Storage
  sessionID: string
  assistantMsg: Message           // 已落库的空 assistant 消息
  model: LanguageModel
  modelInfo: { contextLimit: number }
  system: string[]
  messages: MessageWithParts[]
  ask: ToolContext["ask"]
  onText: (delta: string) => void // CLI 流式渲染回调
  abort: AbortSignal
}
```

处理逻辑（对应 opencode processor.ts）：
- `text-delta` → `onText` + 累积到 TextPart
- `tool-call` → ToolPart（running）落库
- `tool-result` → ToolPart（completed，含 output/title/metadata）落库
- `finish` → 写 finish reason + tokens；`isOverflow(tokens, contextLimit)` → 返回 `"compact"`
- `error` → 消息标 error → 返回 `"stop"`
- 返回三态 `"stop" | "continue" | "compact"`

- [ ] **Step 1: 写失败测试（MockLanguageModel 脚本化一轮工具调用）**

```ts
// test/session/processor.test.ts
import { expect, test } from "vitest"
import { MockLanguageModelV3, simulateReadableStream } from "ai/test"
import { Storage } from "../../src/storage/db"
import { processTurn } from "../../src/session/processor"

test("tool call flows to storage and returns continue", async () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  storage.updateMessage({ id: "u1", sessionID: session.id, role: "user", time: { created: 1 } })
  storage.updateMessage({ id: "a1", sessionID: session.id, role: "assistant", parentID: "u1", time: { created: 2 } })

  const model = new MockLanguageModelV3({
    doStream: async () => ({ stream: simulateReadableStream({ chunks: [
      { type: "tool-call", toolCallId: "c1", toolName: "noop", input: {} },
      { type: "finish", finishReason: "tool-calls",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
    ]})}),
  })
  const result = await processTurn({
    storage, sessionID: session.id,
    assistantMsg: { id: "a1", sessionID: session.id, role: "assistant", time: { created: 2 } },
    model: model as never, modelInfo: { contextLimit: 100000 }, system: [],
    messages: [], ask: async () => {}, onText: () => {}, abort: new AbortController().signal,
  })
  expect(result).toBe("continue")
  const msgs = storage.messagesWithParts(session.id)
  const toolPart = msgs[1].parts.find((p) => p.type === "tool")
  expect(toolPart).toBeDefined()
})
```

- [ ] **Step 2: 验证失败** → FAIL

- [ ] **Step 3: 实现 processor.ts**

```ts
// src/session/processor.ts
import { randomUUID } from "crypto"
import type { LanguageModel } from "ai"
import type { Storage } from "../storage/db"
import type { Message, MessageWithParts } from "./message"
import { toModelMessages } from "./message"
import { toAISDKTools } from "../tool/registry"
import { streamLLM, type TokenUsage } from "../llm/stream"
import { isOverflow } from "../compaction/overflow"

export interface ProcessInput {
  storage: Storage; sessionID: string; assistantMsg: Message
  model: LanguageModel; modelInfo: { contextLimit: number }
  system: string[]; messages: MessageWithParts[]
  ask: (req: { permission: string; patterns: string[]; metadata?: Record<string, unknown> }) => Promise<void>
  onText: (delta: string) => void; abort: AbortSignal
}

export async function processTurn(input: ProcessInput): Promise<"stop" | "continue" | "compact"> {
  const { storage, sessionID, assistantMsg } = input
  let text = ""
  const tools = toAISDKTools({ sessionID, abort: input.abort, ask: input.ask, metadata: async () => {} })
  const modelMessages = toModelMessages(input.messages)

  for await (const event of streamLLM({
    model: input.model, system: input.system, messages: modelMessages, tools, abort: input.abort,
  })) {
    switch (event.type) {
      case "text-delta":
        text += event.text
        input.onText(event.text)
        break
      case "tool-call":
        storage.updatePart({ id: randomUUID(), messageID: assistantMsg.id, sessionID,
          type: "tool", tool: event.name, callID: event.id,
          state: { status: "running", input: event.input ?? {}, time: { start: Date.now() } } })
        break
      case "tool-result": {
        const msgs = storage.messagesWithParts(sessionID)
        const part = msgs.flatMap((m) => m.parts).find(
          (p) => p.type === "tool" && p.callID === event.id)
        if (part?.type === "tool") {
          const output = event.output as { output?: string; title?: string; metadata?: Record<string, unknown> }
          storage.updatePart({ ...part, state: { status: "completed", input: part.state.input,
            output: output?.output ?? String(event.output), title: output?.title ?? part.tool,
            metadata: output?.metadata ?? {},
            time: { start: part.state.time?.start ?? Date.now(), end: Date.now() } } })
        }
        break
      }
      case "finish": {
        if (text) storage.updatePart({ id: randomUUID(), messageID: assistantMsg.id, sessionID,
          type: "text", text })
        storage.updateMessage({ ...assistantMsg, finish: event.reason, tokens: event.tokens,
          time: { ...assistantMsg.time, completed: Date.now() } })
        if (isOverflow(event.tokens, input.modelInfo.contextLimit)) return "compact"
        break
      }
      case "error":
        storage.updateMessage({ ...assistantMsg, error: event.error.message, finish: "error",
          time: { ...assistantMsg.time, completed: Date.now() } })
        return "stop"
    }
  }
  return "continue"
}
```

注：`isOverflow` 由 Task 17 正式实现；本任务先建 `src/compaction/overflow.ts` 占位导出 `export const isOverflow = (t: TokenUsage, limit: number) => t.total >= limit`，Task 17 替换为完整版（含预留 buffer）。

- [ ] **Step 4: 验证通过并提交**

```bash
npx vitest run test/session/processor.test.ts
git add -A && git commit -m "feat: single-turn processor with three-state result"
```

---

### Task 10: runLoop 外层循环

**Files:**
- Create: `src/session/run.ts`
- Test: `test/session/run.test.ts`

**Interfaces:**
- Consumes: 全部前序
- Produces: `runLoop(input: RunInput): Promise<void>`

```ts
interface RunInput {
  storage: Storage; sessionID: string
  model: LanguageModel; modelInfo: { contextLimit: number }
  system: string[]; ask: ProcessInput["ask"]; onText: (d: string) => void
  abort: AbortSignal
}
```

循环逻辑（spec §2.1 逐字实现）：重读 DB → `filterCompacted` → `latest` → 退出判断 → 溢出预防 → 创建 assistant 消息 → `processTurn` → 三态分支。`compact` 分支本任务先 `break`（Task 20 接入真压缩）。

- [ ] **Step 1: 写失败测试（脚本化两轮：先 tool-calls 后 stop）**

```ts
// test/session/run.test.ts
import { expect, test } from "vitest"
import { MockLanguageModelV3, simulateReadableStream } from "ai/test"
import { Storage } from "../../src/storage/db"
import { runLoop } from "../../src/session/run"
import { registerTool } from "../../src/tool/registry"

test("loop continues on tool-calls, breaks on stop", async () => {
  const storage = new Storage(":memory:")
  const session = storage.createSession({ directory: "/tmp" })
  storage.updateMessage({ id: "u1", sessionID: session.id, role: "user", time: { created: 1 } })
  registerTool({ id: "noop", description: "", parameters: { type: "object", properties: {} },
    execute: async () => ({ title: "noop", output: "done" }) })

  let call = 0
  const model = new MockLanguageModelV3({
    doStream: async () => {
      call++
      return { stream: simulateReadableStream({ chunks: call === 1
        ? [ { type: "tool-call", toolCallId: "c1", toolName: "noop", input: {} },
            { type: "finish", finishReason: "tool-calls",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } ]
        : [ { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "done" },
            { type: "text-end", id: "t" },
            { type: "finish", finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } ] }) }
    },
  })
  await runLoop({ storage, sessionID: session.id, model: model as never,
    modelInfo: { contextLimit: 100000 }, system: [], ask: async () => {},
    onText: () => {}, abort: new AbortController().signal })
  expect(call).toBe(2)
  const msgs = storage.messagesWithParts(session.id)
  expect(msgs.filter((m) => m.info.role === "assistant")).toHaveLength(2)
})
```

- [ ] **Step 2: 验证失败** → FAIL

- [ ] **Step 3: 实现 run.ts**

```ts
// src/session/run.ts
import { randomUUID } from "crypto"
import type { LanguageModel } from "ai"
import type { Storage } from "../storage/db"
import { filterCompacted, hasPendingToolCalls, latest, type MessageWithParts } from "./message"
import { processTurn, type ProcessInput } from "./processor"
import { isOverflow } from "../compaction/overflow"

export interface RunInput {
  storage: Storage; sessionID: string
  model: LanguageModel; modelInfo: { contextLimit: number }
  system: string[]; ask: ProcessInput["ask"]; onText: (d: string) => void
  abort: AbortSignal
}

export async function runLoop(input: RunInput): Promise<void> {
  const { storage, sessionID } = input
  while (true) {
    const msgs: MessageWithParts[] = filterCompacted(storage.messagesWithParts(sessionID))
    const { lastUser, lastAssistant } = latest(msgs)
    if (!lastUser) throw new Error("No user message found")

    const lastAssistantMsg = msgs.findLast((m) => m.info.id === lastAssistant?.id)
    const pending = lastAssistantMsg ? hasPendingToolCalls(lastAssistantMsg) : false
    if (lastAssistant?.finish && lastAssistant.finish !== "tool-calls" && !pending
        && lastAssistant.parentID === lastUser.id) break

    // 溢出预防：上轮 token 超限 → 本任务先 break（Task 20 接入压缩）
    if (lastAssistant?.tokens && isOverflow(lastAssistant.tokens as never, input.modelInfo.contextLimit)) break

    const assistantMsg = { id: randomUUID(), sessionID, role: "assistant" as const,
      parentID: lastUser.id, time: { created: Date.now() } }
    storage.updateMessage(assistantMsg)

    const result = await processTurn({ ...input, assistantMsg, messages: msgs })
    if (result === "stop") break
    if (result === "compact") break // Task 20 替换为压缩后续跑
  }
}
```

- [ ] **Step 4: 验证通过并提交**

```bash
npx vitest run test/session/run.test.ts
git add -A && git commit -m "feat: outer run loop with db-rebuild context"
```

---

### Task 11: CLI REPL

**Files:**
- Create: `src/cli/repl.ts`, `src/cli/render.ts`, `src/index.ts`
- 无自动化测试（人工验证：`npm run dev`）

**Interfaces:**
- Consumes: `runLoop`（Task 10）、全部工具（import 即注册）
- 行为：
  - 启动读 `ANTHROPIC_API_KEY`，模型 `anthropic/claude-sonnet-4-5`（`--model provider/id` 可换）
  - readline 循环：输入 → user 消息落库 → `runLoop` → 流式打印 text
  - 工具调用时打印 `▸ read src/a.ts`，完成打印 `✓ read (2.1s)`
  - `/exit` 退出；`/revert`、`/compact` 占位打印 "not implemented"（M5/M3 接入）
  - 上下文窗口：`modelInfo.contextLimit = 200_000`（常量，M3 前够用）

`src/index.ts`：
```ts
import "../src/tool/read" // 按实际相对路径调整
// ... 各工具 import 触发 registerTool
import { startRepl } from "./cli/repl"
startRepl().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 1: 实现 repl.ts + render.ts + index.ts**
- [ ] **Step 2: 人工验证**：`ANTHROPIC_API_KEY=... npm run dev`，提问"读一下 package.json 并总结"，确认 read 被调用、结果流式渲染
- [ ] **Step 3: 提交**

```bash
git add -A && git commit -m "feat: CLI REPL — M1 minimal loop complete"
```

**M1 验收**：能对话、能读文件搜代码、多轮工具循环。

---

### Task 12: 权限系统

**Files:**
- Create: `src/permission/index.ts`
- Modify: `src/cli/repl.ts`（ask 回调接 y/n/a 交互）
- Test: `test/permission/index.test.ts`

**Interfaces:**
- Produces:
  - `type Rule = { permission: string; pattern: string; action: "allow" | "ask" | "deny" }`
  - `evaluate(permission: string, pattern: string, rules: Rule[]): "allow" | "ask" | "deny"` — wildcard 匹配 `permission` 和 `pattern`，**最后命中生效**
  - `createAsk(rules: Rule[], prompt: (q: string) => Promise<string>): ToolContext["ask"]` — allow 放行；deny 抛 `PermissionDeniedError`；ask 回调交互，答 `a` 时把规则追加进内存 ruleset

- [ ] **Step 1: 写失败测试**

```ts
// test/permission/index.test.ts
import { expect, test } from "vitest"
import { evaluate } from "../../src/permission"

const rules = [
  { permission: "*", pattern: "*", action: "ask" as const },
  { permission: "bash", pattern: "git *", action: "allow" as const },
  { permission: "bash", pattern: "rm *", action: "deny" as const },
]
test("last matching rule wins", () => {
  expect(evaluate("bash", "git status", rules)).toBe("allow")
  expect(evaluate("bash", "rm -rf /", rules)).toBe("deny")
  expect(evaluate("bash", "npm test", rules)).toBe("ask")
  expect(evaluate("read", "/etc/passwd", rules)).toBe("ask")
})
test("no match defaults to ask", () => {
  expect(evaluate("edit", "x.ts", [])).toBe("ask")
})
```

- [ ] **Step 2: 验证失败** → FAIL

- [ ] **Step 3: 实现**

```ts
// src/permission/index.ts
import { wildcardMatch } from "../util/wildcard"

export type Rule = { permission: string; pattern: string; action: "allow" | "ask" | "deny" }

export function evaluate(permission: string, pattern: string, rules: Rule[]): "allow" | "ask" | "deny" {
  const match = rules.findLast((r) =>
    wildcardMatch(r.permission, permission) && wildcardMatch(r.pattern, pattern))
  return match?.action ?? "ask"
}

export class PermissionDeniedError extends Error {
  constructor(permission: string, pattern: string) {
    super(`Permission denied: ${permission} (${pattern})`)
  }
}

export function createAsk(
  rules: Rule[],
  prompt: (question: string) => Promise<string>,
) {
  const sessionRules = [...rules]
  return async function ask(req: { permission: string; patterns: string[]; metadata?: Record<string, unknown> }) {
    for (const pattern of req.patterns) {
      const action = evaluate(req.permission, pattern, sessionRules)
      if (action === "allow") continue
      if (action === "deny") throw new PermissionDeniedError(req.permission, pattern)
      if (req.metadata?.diff) console.log(`\n${req.metadata.diff}`)
      const answer = await prompt(`Allow ${req.permission} "${pattern}"? [y]es/[n]o/[a]lways: `)
      if (answer === "a") sessionRules.push({ permission: req.permission, pattern, action: "allow" })
      else if (answer !== "y") throw new PermissionDeniedError(req.permission, pattern)
    }
  }
}
```

- [ ] **Step 4: REPL 接入 ask**（readline question 实现 prompt 回调）
- [ ] **Step 5: 验证通过并提交**

```bash
npx vitest run test/permission/index.test.ts
git add -A && git commit -m "feat: permission rules with interactive ask"
```

---

### Task 13: edit 容错匹配链

**Files:**
- Create: `src/tool/replacers.ts`
- Test: `test/tool/replacers.test.ts`

**Interfaces:**
- Produces: `replace(content: string, oldString: string, newString: string, replaceAll?: boolean): string`
- 4 级 replacer（exact → lineTrimmed → indentationFlex → blockAnchor），唯一性闸门 + 防失控闸门（`isDisproportionateMatch`：匹配行数 ≥ max(old+3, old×2) 拒绝）

- [ ] **Step 1: 写失败测试**

```ts
// test/tool/replacers.test.ts
import { expect, test } from "vitest"
import { replace } from "../../src/tool/replacers"

test("exact match", () => {
  expect(replace("a\nb\nc", "b", "B")).toBe("a\nB\nc")
})
test("indentation flexible", () => {
  const content = "function f() {\n    return 1\n}"
  expect(replace(content, "return 1", "return 2")).toBe("function f() {\n    return 2\n}")
})
test("multiple matches rejected without replaceAll", () => {
  expect(() => replace("x\nx", "x", "y")).toThrow("multiple")
})
test("block anchor with fuzzy middle", () => {
  const content = "START\nmiddle line changed a bit\nmore\nEND"
  const result = replace(content, "START\nmiddle line changed\nEND", "REPLACED")
  expect(result).toContain("REPLACED")
})
test("not found", () => {
  expect(() => replace("abc", "zzz", "y")).toThrow("Could not find")
})
```

- [ ] **Step 2: 验证失败** → FAIL

- [ ] **Step 3: 实现 replacers.ts**（4 个 replacer 参照 opencode `tool/edit.ts:244-497` 的 SimpleReplacer / LineTrimmedReplacer / IndentationFlexibleReplacer / BlockAnchorReplacer 逐行移植，Levenshtein 函数一并移植；`replace` 主函数参照 :682-737，含两道闸门）

- [ ] **Step 4: 验证通过并提交**

```bash
npx vitest run test/tool/replacers.test.ts
git add -A && git commit -m "feat: 4-level tolerant replacer chain"
```

---

### Task 14: edit 工具

**Files:**
- Create: `src/tool/edit.ts`
- Test: `test/tool/edit.test.ts`

**Interfaces:**
- Consumes: `replace`（Task 13）、权限（Task 12）
- Produces: 工具 id `"edit"`，参数 `{ filePath, oldString, newString, replaceAll? }`
- 行为：diff（用 `diff` 包的 `createTwoFilesPatch`）→ `ask({ permission: "edit", metadata: { diff } })` → 落盘 → 返回 `{ title: 相对路径, output: "Edit applied successfully.", metadata: { diff, additions, deletions } }`
- 前置校验：`oldString === newString` 报错；`oldString === ""` 且文件存在 → 报错提示用 write 语义（本项目无 write，报错文案改为 "oldString cannot be empty when editing an existing file"）

- [ ] **Step 1: 写失败测试**

```ts
// test/tool/edit.test.ts
import { expect, test } from "vitest"
import { mkdtempSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { executeEdit } from "../../src/tool/edit"

const allowAll = { sessionID: "s", abort: new AbortController().signal,
  ask: async () => {}, metadata: async () => {} }

test("edits file and returns diff", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "edit-"))
  const f = path.join(dir, "a.ts")
  writeFileSync(f, "const x = 1\n")
  const r = await executeEdit({ filePath: f, oldString: "const x = 1", newString: "const x = 2" }, allowAll)
  expect(readFileSync(f, "utf-8")).toBe("const x = 2\n")
  expect(r.metadata?.diff).toContain("-const x = 1")
  expect(r.metadata?.diff).toContain("+const x = 2")
})

test("identical strings rejected", async () => {
  await expect(executeEdit({ filePath: "/x", oldString: "a", newString: "a" }, allowAll)).rejects.toThrow("identical")
})
```

- [ ] **Step 2: 验证失败** → FAIL
- [ ] **Step 3: 实现**（结构参照 opencode `tool/edit.ts:69-215`：校验 → 读文件 → CRLF 归一化 → `replace` → diff → ask → 落盘 → 统计 additions/deletions。砍掉 BOM/格式化/LSP/事件）
- [ ] **Step 4: 验证通过并提交**

```bash
npx vitest run test/tool/edit.test.ts
git add -A && git commit -m "feat: edit tool with diff preview permission"
```

---

### Task 15: bash 工具 + 输出截断落盘

**Files:**
- Create: `src/tool/truncate.ts`, `src/tool/bash.ts`
- Test: `test/tool/bash.test.ts`

**Interfaces:**
- Produces:
  - `truncateOutput(text: string, filePath?: string): { content: string; truncated: boolean; outputPath?: string }` — 2000 行/50KB，超出写 `~/.local/share/code-agent/truncation/<uuid>`，尾部提示 `Use Grep to search the full content or Read with offset/limit`
  - 工具 id `"bash"`，参数 `{ command: string; timeout?: number }`（默认 120s）；权限 `bash`，pattern = 完整命令字符串
  - 输出截断方向：**stdout 保留尾部**（日志类输出错误通常在末尾）

- [ ] **Step 1: 写失败测试**

```ts
// test/tool/bash.test.ts
import { expect, test } from "vitest"
import { executeBash } from "../../src/tool/bash"
import { truncateOutput } from "../../src/tool/truncate"

const ctx = { sessionID: "s", abort: new AbortController().signal, ask: async () => {}, metadata: async () => {} }

test("runs command", async () => {
  const r = await executeBash({ command: "echo hello" }, ctx)
  expect(r.output).toContain("hello")
})

test("truncate keeps tail for long output", () => {
  const text = Array.from({ length: 3000 }, (_, i) => `line${i}`).join("\n")
  const r = truncateOutput(text)
  expect(r.truncated).toBe(true)
  expect(r.content).toContain("line2999")
  expect(r.content).toContain("truncated")
  expect(r.outputPath).toBeTruthy()
})
```

- [ ] **Step 2: 验证失败** → FAIL
- [ ] **Step 3: 实现**（bash 用 `execFile(shell, ["-c", command])`，stdout+stderr 合并；truncateOutput 双向：bash 传 `direction: "tail"`，read 类用默认 "head"）
- [ ] **Step 4: 验证通过并提交**

```bash
npx vitest run test/tool/bash.test.ts
git add -A && git commit -m "feat: bash tool with tail-truncation to disk"
```

---

### Task 16: REPL 权限交互与 diff 渲染

**Files:**
- Modify: `src/cli/repl.ts`, `src/cli/render.ts`

- [ ] **Step 1: 实现** — ask 回调打印 diff（`metadata.diff` 着色：`-` 红 `+` 绿），阻塞等 y/n/a；工具进行中打印 spinner 行
- [ ] **Step 2: 人工验证**：让 agent 修改一个文件，确认 diff 预览 → y 后落盘
- [ ] **Step 3: 提交** `git commit -m "feat: REPL permission prompt with diff render — M2 complete"`

**M2 验收**：能改代码跑命令，权限 y/n/a 生效。

---

### Task 17: token 估算与溢出判断

**Files:**
- Create: `src/util/token.ts`
- Modify: `src/compaction/overflow.ts`（替换 Task 9 占位实现）
- Test: `test/compaction/overflow.test.ts`

**Interfaces:**
- Produces: `estimateTokens(text: string): number`（chars/4）；`isOverflow(tokens: TokenUsage, contextLimit: number, reserved?: number): boolean` — `total >= contextLimit - (reserved ?? min(20000, 8192))`

- [ ] **Step 1-4: TDD 循环**（测试：4000 字符 → 1000 token；total 达 limit-buffer 触发；未达不触发）
- [ ] **Step 5: 提交** `git commit -m "feat: token estimation + overflow threshold"`

---

### Task 18: prune — 旧工具输出清理

**Files:**
- Create: `src/compaction/prune.ts`
- Modify: `src/session/run.ts`（每轮结束后台调 `prune`）
- Test: `test/compaction/prune.test.ts`

**Interfaces:**
- Produces: `prune(storage: Storage, sessionID: string): Promise<number>`（返回清理的 token 数）
- 规则（spec §4② 逐字）：从最新往回扫描，跳过最近 2 个 user 轮次；累计工具 output token ≤ 40,000 的部分保护；超出部分标记 `state.time.compacted = Date.now()` 并 updatePart；总清理量 < 20,000 token 则全部放弃（回滚标记）

- [ ] **Step 1: 写失败测试** — 构造 5 个工具 part（各 15,000 token 的 output），断言最旧的 2 个被标记 compacted，最近 40k 的保留；总量不足 20k 时不动
- [ ] **Step 2: 验证失败** → FAIL
- [ ] **Step 3: 实现**（倒序遍历 + 阈值逻辑，约 40 行）
- [ ] **Step 4: 验证通过并提交** `git commit -m "feat: prune old tool outputs"`

---

### Task 19: compaction select — 头尾分离

**Files:**
- Create: `src/compaction/select.ts`
- Test: `test/compaction/select.test.ts`

**Interfaces:**
- Produces: `selectTail(msgs: MessageWithParts[], budget: number): { head: MessageWithParts[]; tailStartID?: string }`
- 规则：以 user 消息划 turn（含 compaction part 的 user 消息不算）；从最新 turn 往回累加 token（`estimateTokens(JSON.stringify(msgs))`），预算内保留；不足一个完整 turn 时在该 turn 内按消息粒度切（`splitTurn`）；默认保留最近 2 轮，预算 = 可用上下文 25% 钳制 2,000–8,000

- [ ] **Step 1: 写失败测试** — 5 个 turn 各 3,000 token，预算 6,000 → 保留 2 个 turn；预算 4,000 → 保留 1 个 turn + 部分切分
- [ ] **Step 2-4: TDD 实现并提交** `git commit -m "feat: compaction tail selection"`

---

### Task 20: compaction process — 总结压缩主流程

**Files:**
- Create: `src/compaction/index.ts`, `src/compaction/prompt.ts`
- Modify: `src/session/run.ts`（`"compact"` 分支接入；循环开头溢出预防接入）
- Test: `test/compaction/index.test.ts`

**Interfaces:**
- Produces: `compact(storage, sessionID, model, modelInfo): Promise<"continue" | "stop">`
- 流程（spec §4③）：
  1. `selectTail` 分头尾
  2. 头部序列化为 `[User]: / [Assistant]: / [Assistant tool call]: name(input) / [Tool result]:`（工具 output 截 2,000 字符）
  3. 无工具 LLM 调用，prompt = `prompt.ts` 的总结模板（Objective/Important Details/Work State/Next Move/Relevant Files + 保留精确路径符号规则）；已有旧总结用增量更新 prompt
  4. 总结存为 `summary: true` 的 assistant 消息；compaction user 消息的 CompactionPart 记 `tail_start_id`
  5. 注入合成 user 消息 `"Continue if you have next steps..."` → 返回 "continue"

总结模板（`prompt.ts`，逐字）：
```ts
export const SUMMARY_PROMPT = `Create a structured summary of this conversation for context continuation.

## Objective
- [one or two sentences: what the user is trying to accomplish]
## Important Details
- [constraints, decisions and why, key facts]
## Work State
### Completed / ### Active / ### Blocked
## Next Move
1. [immediate concrete action]
## Relevant Files
- [path: why it matters]

Rules: terse bullets; preserve exact file paths, symbols, commands, error strings.`
```

- [ ] **Step 1: 写失败测试** — mock model 返回固定总结文本；构造超限会话，执行 compact，断言：summary 消息落库、合成 continue 消息存在、返回 "continue"
- [ ] **Step 2-4: 实现并提交** `git commit -m "feat: compaction with anchored summary"`

---

### Task 21: filterCompacted — 上下文重组

**Files:**
- Modify: `src/session/message.ts:filterCompacted`（替换 Task 3 的恒等实现）
- Test: `test/session/message.test.ts`（追加用例）

**Interfaces:**
- 规则：找到最近一条带 `tail_start_id` 的 CompactionPart → 上下文 = `[compaction user 消息, 总结 assistant 消息, ...tail_start_id 起的尾部消息, ...其后的新消息]`；之前的消息丢弃（DB 保留）

- [ ] **Step 1: 写失败测试** — 构造压缩前 3 条 + compaction + 总结 + 尾部 2 条 + 压缩后新消息 1 条，断言输出恰好 5 条且顺序正确、头部被丢弃
- [ ] **Step 2-4: 实现并提交** `git commit -m "feat: compacted context rebuild — M3 complete"`

**M3 验收**：构造 200k token 会话，溢出自动压缩并续跑。

---

### Task 22: 子 agent（task 工具 + explore）

**Files:**
- Create: `src/agent/agents.ts`, `src/tool/task.ts`
- Test: `test/agent/task.test.ts`

**Interfaces:**
- Produces:
  - `agents.ts`：`AGENTS: Record<string, { name: string; prompt?: string; permission: Rule[]; mode: "primary" | "subagent" }>`，含 `main`（默认权限配置）与 `explore`（`*: deny` + read/grep/glob/bash allow + 专用 prompt："You are a file search specialist..."）
  - 工具 id `"task"`，参数 `{ subagent_type: string; prompt: string; description: string }`
- 流程（spec §2.4）：深度检查（session.parentID 链 ≥1 拒绝）→ 建子 session（继承父 directory）→ 子 runLoop（system 换 explore prompt，ask 用 explore 规则）→ 取子 session 最后一条 assistant text 作为 output
- system prompt 组装点从 runLoop 入参传入：子 agent 调用时 `system = [explore.prompt, ...基础环境信息]`

- [ ] **Step 1: 写失败测试** — mock model 对子 session 返回 "found 3 files"；断言：子 session 创建（parent_id 正确）、task output 恰为 "found 3 files"、子 session 的 tool part 不进父 session
- [ ] **Step 2-4: 实现并提交** `git commit -m "feat: task tool + explore subagent — M4 complete"`

**M4 验收**：主 agent 派生 explore 检索，结果回传，中间过程隔离。

---

### Task 23: 快照与回滚

**Files:**
- Create: `src/snapshot/index.ts`
- Modify: `src/session/run.ts`（循环边界 track）、`src/cli/repl.ts`（`/revert`）
- Test: `test/snapshot/index.test.ts`

**Interfaces:**
- Produces:
  - `initSnapshot(worktree: string): void` — 影子仓库 `~/.local/share/code-agent/snapshot/<sha1(worktree)>`，`git init` + `--git-dir X --work-tree Y` 封装
  - `track(): Promise<string | undefined>` — `git add -A` + `git write-tree` 返回 hash；失败（非 git 环境可用性无关，影子仓库不依赖用户仓库）返回 undefined
  - `patch(fromHash: string, toHash: string): Promise<{ files: string[]; diff: string }>`
  - `revertTo(hash: string): Promise<void>` — `git read-tree <hash>` + `git checkout-index -a -f`
- runLoop：每轮 processTurn 前 track，结束后 patch 存 PatchPart
- `/revert`：恢复最近一个 PatchPart 的 from hash

- [ ] **Step 1: 写失败测试** — 临时目录：track → 改文件 → track → patch 断言 files 含改动文件 → revertTo 第一个 hash → 断言文件内容恢复
- [ ] **Step 2-4: 实现并提交** `git commit -m "feat: shadow git snapshot + revert — M5 complete"`

**M5 验收**：agent 改乱文件后 `/revert` 一键恢复。

---

### Task 24: doom loop 检测与重试加固

**Files:**
- Create: `src/session/doom.ts`
- Modify: `src/session/processor.ts`（tool-call 事件接入）、`src/llm/stream.ts`（确认 maxRetries 行为 + 补测试）
- Test: `test/session/doom.test.ts`

**Interfaces:**
- Produces: `checkDoomLoop(storage, sessionID, toolName, input): boolean` — 最近 3 个 tool part 同 `tool` 且 `JSON.stringify(input)` 相同 → true；processor 命中时调用 `ask({ permission: "doom_loop", ... })`（用户可拒绝打断循环）

- [ ] **Step 1-4: TDD 并提交** `git commit -m "feat: doom loop detection"`

---

### Task 25: 崩溃恢复 + E2E 黄金测试

**Files:**
- Modify: `src/cli/repl.ts`（启动时列出可恢复会话，中断的 running tool part 标记 interrupted）
- Create: `test/e2e/golden.test.ts`, `test/e2e/fixtures/`（小代码仓库 fixture）
- Test: E2E 用脚本化 mock model 跑完整会话（read → edit → 文本总结），断言最终 DB 状态与文件内容

- [ ] **Step 1: 实现恢复逻辑**（`UPDATE part SET data` 中 running → error/interrupted）
- [ ] **Step 2: E2E 黄金测试**
- [ ] **Step 3: 提交** `git commit -m "feat: crash recovery + e2e golden test — M6 complete"`

**M6 验收**：Ctrl+C 中断后重启可恢复；E2E 全绿。

---

## Self-Review 记录

- **Spec 覆盖**：M1–M6 ↔ Task 1–25 一一对应；spec §2.5 简化项均体现为"砍掉"说明
- **占位符**：Task 13/14 的 replacer 与 edit 实现指引了 opencode 源码的具体行号作移植参照（学习型项目刻意为之的对照阅读点），其余任务均含完整代码
- **类型一致性**：`ToolDef/ToolContext/ToolResult`（Task 4）、`Message/Part/ToolState`（Task 3）、`ProcessInput`（Task 9）、`RunInput`（Task 10）、`Rule/evaluate/createAsk`（Task 12）跨任务引用一致；`isOverflow` 签名在 Task 17 定型，Task 9/10 的占位调用兼容
