import { expect, test } from "vitest"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { initSnapshot, track, patch, revertTo } from "../../src/snapshot/index"

test("track → modify → track → patch → revert roundtrip", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "snap-"))
  try {
    const f = path.join(dir, "a.txt")
    writeFileSync(f, "version 1\n")
    initSnapshot(dir)

    const h1 = await track()
    expect(h1).toBeTruthy()

    writeFileSync(f, "version 2\n")
    const h2 = await track()
    expect(h2).toBeTruthy()
    expect(h2).not.toBe(h1)

    const p = await patch(h1!, h2!)
    expect(p.files).toContain("a.txt")
    expect(p.diff).toContain("-version 1")
    expect(p.diff).toContain("+version 2")

    await revertTo(h1!)
    expect(readFileSync(f, "utf-8")).toBe("version 1\n")

    // 恢复后再 track，回到与 h1 相同的状态
    const h3 = await track()
    expect(h3).toBe(h1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("new files tracked and restored correctly", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "snap2-"))
  try {
    writeFileSync(path.join(dir, "a.txt"), "base\n")
    initSnapshot(dir)
    const h0 = await track()
    writeFileSync(path.join(dir, "new.ts"), "export {}\n")
    writeFileSync(path.join(dir, "a.txt"), "changed\n")
    const h1 = await track()
    expect(h1).not.toBe(h0)
    await revertTo(h0!)
    expect(readFileSync(path.join(dir, "a.txt"), "utf-8")).toBe("base\n")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
