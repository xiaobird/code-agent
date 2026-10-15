#!/usr/bin/env node
// 全局入口：npm link 后可在任意工程目录执行 `code-agent`，
// 以当前目录为工作区启动 REPL（tsx 从本仓库的 node_modules 解析）
import { spawnSync } from "child_process"
import path from "path"
import { fileURLToPath } from "url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const tsx = path.join(root, "node_modules", ".bin", "tsx")
const entry = path.join(root, "src", "index.ts")
const result = spawnSync(tsx, [entry, ...process.argv.slice(2)], { stdio: "inherit" })
process.exit(result.status ?? 1)
