import type { Rule } from "./index"

export type PermissionMode = "plan" | "confirm" | "auto-edit" | "full"

export const MODES: {
  mode: PermissionMode
  icon: string
  label: string
  description: string
}[] = [
  { mode: "plan", icon: "💡", label: "计划模式", description: "只读探索，不改文件不跑命令" },
  { mode: "confirm", icon: "✋", label: "变更前确认", description: "改文件前先问我" },
  { mode: "auto-edit", icon: "🛡", label: "自动编辑", description: "自动编辑文件，命令仍需确认" },
  { mode: "full", icon: "🛡", label: "完全访问", description: "减少确认次数" },
]

/** 各模式的权限规则（read/grep/glob 全模式放行） */
export function modeRules(mode: PermissionMode): Rule[] {
  const base: Rule[] = [
    { permission: "read", pattern: "*", action: "allow" },
    { permission: "grep", pattern: "*", action: "allow" },
    { permission: "glob", pattern: "*", action: "allow" },
  ]
  switch (mode) {
    case "plan":
      return [
        ...base,
        { permission: "edit", pattern: "*", action: "deny" },
        { permission: "bash", pattern: "*", action: "deny" },
      ]
    case "confirm":
      return base
    case "auto-edit":
      return [...base, { permission: "edit", pattern: "*", action: "allow" }]
    case "full":
      return [
        ...base,
        { permission: "edit", pattern: "*", action: "allow" },
        { permission: "bash", pattern: "*", action: "allow" },
      ]
  }
}

export function modeInfo(mode: PermissionMode) {
  return MODES.find((m) => m.mode === mode)!
}

/** 循环切换到下一个模式 */
export function nextMode(mode: PermissionMode): PermissionMode {
  const i = MODES.findIndex((m) => m.mode === mode)
  return MODES[(i + 1) % MODES.length].mode
}
