import { execFile, execFileSync } from "child_process"
import { promisify } from "util"
import { createHash } from "crypto"
import { mkdirSync } from "fs"
import { homedir } from "os"
import path from "path"

const execFileP = promisify(execFile)

const SNAPSHOT_ROOT = path.join(homedir(), ".local", "share", "code-agent", "snapshot")

let worktree: string | undefined
let gitDir: string | undefined

/** 影子仓库：与用户仓库完全独立的 git 目录，按 worktree 路径哈希分桶 */
export function initSnapshot(dir: string): void {
  worktree = path.resolve(dir)
  gitDir = path.join(SNAPSHOT_ROOT, createHash("sha1").update(worktree).digest("hex"))
  mkdirSync(gitDir, { recursive: true })
  // init 必须同步完成，后续 track 才能立即使用
  execFileSync("git", ["--git-dir", gitDir, "init", "--quiet"], { stdio: "ignore" })
}

async function gitCmd(args: string[]): Promise<string> {
  if (!gitDir || !worktree) throw new Error("snapshot not initialized")
  const { stdout } = await execFileP("git", ["--git-dir", gitDir, "--work-tree", worktree, ...args], {
    maxBuffer: 50 * 1024 * 1024,
  })
  return stdout
}

/** 记录当前 worktree 全量状态，返回 tree hash；任何失败返回 undefined */
export async function track(): Promise<string | undefined> {
  try {
    await gitCmd(["add", "-A"])
    return (await gitCmd(["write-tree"])).trim()
  } catch {
    return undefined
  }
}

export async function patch(
  fromHash: string,
  toHash: string,
): Promise<{ files: string[]; diff: string }> {
  const diff = await gitCmd(["diff", "--name-status", fromHash, toHash])
  const fullDiff = await gitCmd(["diff", fromHash, toHash])
  const files = diff
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t").slice(1).join("\t"))
  return { files, diff: fullDiff }
}

/** 把 worktree 恢复到指定 tree hash */
export async function revertTo(hash: string): Promise<void> {
  await gitCmd(["read-tree", hash])
  await gitCmd(["checkout-index", "-a", "-f"])
  await gitCmd(["add", "-A"]) // 让影子索引与恢复后的状态一致
}

export function snapshotActive(): boolean {
  return Boolean(worktree && gitDir)
}
