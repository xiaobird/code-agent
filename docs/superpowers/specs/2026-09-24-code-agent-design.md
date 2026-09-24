# Code Agent 设计文档

> 从零实现的 TypeScript code agent —— 学习型复刻 opencode 核心架构
> 日期：2026-09-24 · 状态：已确认 · 语言：TypeScript (Node 20+ / tsx)

## 0. 设计输入

| 维度 | 决策 |
|---|---|
| 定位 | 学习型复刻 opencode，架构概念 1:1 可对照源码 |
| 范围 | runLoop + 5 工具（read/grep/glob/edit/bash）+ SQLite 持久化 + explore 子 agent + compaction/prune + 快照回滚 |
| 排除 | LSP、MCP、插件、多模态、TUI、apply_patch、tree-sitter |
| 模型层 | Vercel AI SDK v6（多 provider，streamText 单 step） |
| 交互 | CLI REPL（readline + 流式渲染 + y/n/a 权限确认） |
| 效果器 | 放弃 Effect，原生 async/await + AbortController |

## 1. 整体架构

```
┌─────────────────────────────────────────────┐
│ cli/          REPL：readline 输入 → 流式渲染  │
├─────────────────────────────────────────────┤
│ session/      runLoop（外层 while 循环）       │
│               processor（单轮 LLM 流处理）     │
├─────────────────────────────────────────────┤
│ llm/          AI SDK 封装：streamText 单 step │
├──────────┬───────────┬──────────┬───────────┤
│ tool/    │permission/│compaction│snapshot/  │
│ 5个工具   │ 规则匹配   │prune+总结 │影子git    │
├──────────┴───────────┴──────────┴───────────┤
│ storage/      SQLite：session/message/part   │
├─────────────────────────────────────────────┤
│ agent/        纯配置：主agent + explore       │
└─────────────────────────────────────────────┘
```

### 核心架构决策

1. **双层循环**：外层 `while(true)` 每轮从 DB 重建上下文；内层 `streamText` 只跑 1 step（不传 stopWhen），工具在流内执行
2. **DB 是唯一事实源**：循环无内存状态，崩溃可恢复
3. **agent 是数据不是代码**：explore = 配置记录（只读权限 + 专用 prompt），复用同一 runLoop + 独立 session 隔离上下文
4. **依赖单向**：cli → session → {llm, tool, compaction, snapshot} → storage

### 目录结构

```
code-agent/
├── package.json  tsconfig.json
├── src/
│   ├── index.ts               # 入口
│   ├── cli/
│   │   ├── repl.ts            # readline 循环、斜杠命令（/revert /compact /exit）
│   │   └── render.ts          # 流式文本/diff/工具调用渲染
│   ├── session/
│   │   ├── run.ts             # runLoop 外层循环
│   │   ├── processor.ts       # 单轮 LLM 流处理、三态结果
│   │   ├── message.ts         # 消息/part 模型、latest()、toModelMessages()
│   │   └── doom.ts            # 重复工具调用检测
│   ├── llm/
│   │   └── stream.ts          # AI SDK 封装、事件归一化、重试
│   ├── tool/
│   │   ├── tool.ts            # ToolDef/ToolContext/ToolResult 接口
│   │   ├── registry.ts        # 注册表 + AI SDK 包装层
│   │   ├── read.ts  grep.ts  glob.ts  edit.ts  bash.ts
│   │   ├── replacers.ts       # edit 容错匹配链
│   │   └── truncate.ts        # 输出截断 + 落盘
│   ├── permission/
│   │   └── index.ts           # 规则 evaluate（allow/ask/deny，wildcard）
│   ├── agent/
│   │   └── agents.ts          # 主agent + explore 配置记录
│   ├── compaction/
│   │   ├── index.ts           # isOverflow / prune / process / select
│   │   └── prompt.ts          # 总结模板
│   ├── snapshot/
│   │   └── index.ts           # 影子 git：track/patch/revert
│   ├── storage/
│   │   ├── db.ts              # better-sqlite3 连接与迁移
│   │   └── schema.sql         # session/message/part 三表
│   └── util/
│       ├── token.ts           # chars/4 估算
│       └── wildcard.ts        // 权限模式匹配
└── test/                      # 镜像 src 结构
```

## 2. 核心循环与数据流

### 2.1 外层 runLoop（`session/run.ts`）

```ts
async function runLoop(sessionID: string): Promise<void> {
  let step = 0
  while (true) {
    // ① 每轮从 DB 重读全部消息（过滤已压缩部分）
    const msgs = await storage.messagesWithParts(sessionID)
    const { lastUser, lastAssistant } = latest(msgs)

    // ② 退出判断：finish≠tool-calls 且无未回传工具调用
    if (lastAssistant?.finish && lastAssistant.finish !== "tool-calls"
        && !hasPendingToolCalls(lastAssistant)) break

    // ③ compaction 任务优先
    if (pendingCompaction(msgs)) { await compaction.process(...); continue }

    // ④ 溢出预防：上轮 token 超阈值 → 入队压缩
    if (isOverflow(lastAssistant.tokens, model)) { compaction.enqueue(); continue }

    // ⑤ 一轮 LLM 交互
    step++
    const assistantMsg = await storage.createAssistantMessage(...)
    const result = await processor.process({ messages: msgs, tools, model, ... })

    // ⑥ 三态结果
    if (result === "stop") break
    if (result === "compact") { await compaction.process(...); continue }
  }
}
```

### 2.2 内层单轮（`session/processor.ts`）

```
streamText({ tools, messages, model, abortSignal })
  │
  ├─ text-delta   → 流式渲染 + 累积
  ├─ tool-call    → 权限 ask → doom-loop 检测（同工具同参数3次→问用户）→ 执行
  ├─ tool-result  → 落库（part，status=completed）
  └─ finish → 收尾判断：
       token 超阈值 → "compact"
       权限被拒/出错 → "stop"
       否则          → "continue"
```

### 2.3 消息生命周期示例（"读 xxx.ts 改 bug"）

```
用户输入 → user 消息落库
runLoop#1: 组装上下文 → LLM → tool-call(read) → 结果落库 → continue
runLoop#2: 重读DB(含read结果) → LLM → tool-call(edit) → 权限y/n → 执行落库 → continue
runLoop#3: LLM 纯文本 → finish=stop → break
```

### 2.4 子 agent（explore）

```
主agent tool-call(task, subagent_type="explore", prompt)
  → 深度检查（depth ≥ 1 拒绝，explore 不能再套娃）
  → 创建子 session（parent_id 关联）
  → 子 session 跑同一个 runLoop：系统提示换 explore 专用 + 权限 {*: deny, read/grep/glob/bash: allow}
  → 子 agent 结束 → 只取最后一条 text 作为 task 工具 output 回传
  → 中间检索过程留在子 session，不污染主上下文
```

### 2.5 相对 opencode 的简化

| opencode | 本项目 | 理由 |
|---|---|---|
| Effect 重试/中断 | AbortController + try/catch | 可读性 |
| tree-sitter 解析 bash | 整命令前缀匹配 | 够演示权限模型 |
| 每 step 快照 | 每轮循环边界快照 | 机制保留，频率降低 |
| MCP/插件/多模态/LSP | 砍掉 | 聚焦核心 |

## 3. 工具系统

### 3.1 接口（`tool/tool.ts`）

```ts
interface ToolDef<P> {
  id: string
  description: string
  parameters: JSONSchema
  execute(args: P, ctx: ToolContext): Promise<ToolResult>
}
interface ToolContext {
  sessionID: string
  abort: AbortSignal
  ask(req: PermissionRequest): Promise<void>
  metadata(patch: Partial<ToolResult>): Promise<void>
}
interface ToolResult { title: string; output: string; metadata?: Record<string, unknown> }
```

注册进 AI SDK 时统一包装：权限 ask + 错误归一化为 tool-error 回喂模型。

### 3.2 五个工具规格

| 工具 | 参数 | 限量策略 | 权限 |
|---|---|---|---|
| `read` | filePath, offset?, limit? | 2000 行软墙（继续数总行数）+ 单行 2000 字符 + 50KB 硬墙（立即断流）；显式标记 `Use offset=N to continue` | read |
| `grep` | pattern, path?, include? | 调系统 ripgrep，限 100 条 | grep |
| `glob` | pattern, path? | 限 100 条，mtime 排序 | glob |
| `edit` | filePath, oldString, newString, replaceAll? | 容错链见 3.3 | edit（带 diff 预览） |
| `bash` | command, timeout? | 输出 2000 行/50KB 截断，全文落盘临时文件，提示用 grep/offset 或委托 explore | bash |

read 的文件类别分流：目录 → 条目切片；二进制（扩展名黑名单 + 采样不可打印字符 >30%）→ 拒绝；文本 → 三重截断。

### 3.3 edit 容错匹配链（`tool/replacers.ts`）

opencode 9 级简化为 4 级，按序尝试：

1. `exact` — 原样精确匹配
2. `lineTrimmed` — 逐行 trim 后比对
3. `indentationFlex` — 去公共缩进后比对
4. `blockAnchor` — 首行+尾行锚点，中间行 Levenshtein 相似度 ≥ 0.65

安全闸完整保留：
- **唯一性**：多处匹配 → 报错"提供更多上下文"
- **防失控**：匹配跨度 > oldString 2 倍行数 → 拒绝执行

落盘流程：生成 diff → `ask(permission:"edit", diff 预览)` → 写入 → 重新算 diff 落库。

### 3.4 权限模型（`permission/index.ts`）

```ts
type Rule = { permission: string; pattern: string; action: "allow" | "ask" | "deny" }
// evaluate(): 最后命中的规则生效；ask → REPL 阻塞等 y/n/a(lways)
// 配置示例：
{ "bash": { "*": "ask", "rm *": "deny", "git *": "allow" },
  "edit": { "*": "ask" },
  "read": { "*": "allow", "*.env": "ask" } }
```

**执行时拦截**而非预先隐藏工具：explore 调 edit 收到权限拒绝错误，模型从错误中学会只用只读工具。

## 4. 上下文管理（三层防线）

### ① 工具截断（执行时）
read/bash 输出限 2000 行 / 50KB。超出：全文写 `~/.local/share/<agent>/truncation/<id>`，模型收到预览 + 提示（有 task 权限时提示委托 explore 子 agent 处理）。

### ② prune（每轮结束后台）
从最新往回扫描，保护最近 **40,000 token** 的工具输出；更旧的标记 `compacted`，上下文渲染为 `[Old tool result content cleared]`（保留调用记录，只清 output）。实际清理量 < **20,000 token** 不动手。配置开关 `compaction.prune`。

### ③ 总结压缩（溢出时）
- **触发**：`总token（含cache）≥ 模型上下文上限 - 预留（min(20k, maxOutputTokens)）`；流中超标立即中断，或循环开头检测上轮溢出
- **头尾分离**：保留最近 2 个用户轮次原文（`tail_turns` 可配），保留预算 = 可用上下文 25%（钳制 2k-8k token，`preserve_recent_tokens` 可配）
- **总结 agent**：无工具，固定模板输出：
  ```
  ## Objective          — 用户目标
  ## Important Details  — 约束、决策及原因
  ## Work State         — Completed / Active / Blocked
  ## Next Move          — 下一步具体动作
  ## Relevant Files     — 关键文件路径及原因
  ```
  规则：保留精确文件路径、符号名、命令、错误串
- **锚定增量**：已有旧总结则"更新旧总结：保留仍成立的、删过时的、合并新事实"，不重复总结
- **上下文重组**：`[user: "What did we do so far?"] → [总结] → [保留的尾部轮次] → [user: "Continue if you have next steps..."]`，旧消息留在 DB 但不再发送
- **失败兜底**：压缩请求本身溢出 → 报错停止

token 估算：`chars / 4`。

## 5. 快照与回滚（`snapshot/index.ts`）

- 影子 git 仓库：`~/.local/share/<agent>/snapshot/<hash(worktree)>`，`--git-dir` 与 `--work-tree` 分离，不动用户 `.git`
- `track()`：每轮 LLM 调用前 `git add -A` + `git write-tree` → tree hash
- 轮结束：`git diff <旧hash> <新hash>` 生成 PatchPart 落库
- 尊重 .gitignore；未跟踪大文件（>1MB）跳过
- REPL `/revert`：`git read-tree <hash>` + `checkout` 恢复

## 6. 错误处理

| 场景 | 策略 |
|---|---|
| LLM 429/5xx/网络错误 | 指数退避重试 3 次（1s/2s/4s） |
| 用户中断（Ctrl+C） | AbortController → 消息标 aborted，未完成工具标 interrupted |
| 工具执行异常 | error 落库 → tool-error 回喂模型自我修正 |
| Doom loop | 同工具同参数连续 3 次 → 权限询问用户 |
| edit 匹配失败 | 报错回喂（"找不到 oldString"/"多处匹配"）→ 模型重读后重试 |
| 上下文溢出 | 中断流 → compaction → 继续 |
| 进程崩溃 | 重启后从 DB 恢复会话；interrupted 工具不阻塞退出判断 |

## 7. 数据模型（`storage/schema.sql`）

```sql
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  parent_id TEXT,              -- 子 agent 关联
  title TEXT NOT NULL,
  directory TEXT NOT NULL,
  agent TEXT, model TEXT,      -- JSON
  permission TEXT,             -- JSON ruleset
  time_created INTEGER, time_updated INTEGER
);
CREATE TABLE message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  time_created INTEGER,
  data TEXT NOT NULL           -- JSON: role/agent/model/finish/tokens/cost/error
);
CREATE INDEX msg_session_idx ON message(session_id, time_created, id);
CREATE TABLE part (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  time_created INTEGER,
  data TEXT NOT NULL           -- JSON: TextPart/ToolPart/CompactionPart/PatchPart/...
);
CREATE INDEX part_msg_idx ON part(message_id, id);
```

part 的 data 联合类型：
- `TextPart { text }`
- `ToolPart { tool, callID, state: pending|running|completed{input,output,title,metadata,time}|error{error,time} }`
- `CompactionPart { auto, tail_start_id }`
- `PatchPart { hash, files }`
- `SubtaskPart { agent, prompt, description }`

## 8. 测试策略

| 层 | 对象 | 方法 |
|---|---|---|
| 单元 | replacer 链 / 权限 evaluate / wildcard / prune 与 compaction 的 select 逻辑 / token 估算 | 纯函数直测，无 LLM |
| 集成 | runLoop + processor | mock LLM（脚本化 streamText 响应序列），断言 DB 状态机流转 |
| 工具 | read 截断三墙 / edit 容错链 / grep 限量 | 临时 fixture 文件树 |
| 快照 | track/patch/revert | 临时 git 仓库 |
| E2E | 完整会话 | fixture 仓库 + 录制式 LLM 响应，黄金 transcript 比对 |

CI 零真实 API 调用。

## 9. 实施里程碑

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| M1 最小闭环 | storage + llm 封装 + read/grep/glob + runLoop + CLI REPL | 能对话、能读文件搜代码、多轮工具循环 |
| M2 写能力 | edit（4级容错链）+ bash + 权限系统 + 流式渲染 | 能改代码跑命令，权限 y/n 生效 |
| M3 上下文管理 | 截断落盘 + prune + 总结压缩 | 长会话溢出自动压缩续跑 |
| M4 子 agent | task 工具 + explore 配置 + 子 session 隔离 | 主 agent 能派生 explore，结果回传 |
| M5 快照回滚 | 影子 git + PatchPart + /revert | 编辑可逐步回滚 |
| M6 加固 | doom loop + 重试 + 崩溃恢复 + E2E 黄金测试 | 异常路径全覆盖 |

## 10. 明确不做（YAGNI）

LSP、MCP、插件系统、图片/PDF、TUI、多会话 UI、apply_patch、webfetch/websearch、tree-sitter 命令解析、Effect。需要时按既有分层扩展，不预留抽象。
