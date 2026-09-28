// 4 级容错替换链：exact → lineTrimmed → indentationFlex → blockAnchor
// 每级过两道闸门：唯一性（除非 replaceAll）与防失控（匹配行数不得远超 old）。

export function isDisproportionateMatch(matchedLines: number, oldLines: number): boolean {
  return matchedLines >= Math.max(oldLines + 3, oldLines * 2)
}

interface LineInfo {
  text: string
  start: number
  end: number // 不含换行
}

function splitLines(content: string): LineInfo[] {
  const out: LineInfo[] = []
  let start = 0
  for (let i = 0; i <= content.length; i++) {
    if (i === content.length || content[i] === "\n") {
      out.push({ text: content.slice(start, i), start, end: i })
      start = i + 1
    }
  }
  return out
}

function allIndexOf(haystack: string, needle: string): number[] {
  const out: number[] = []
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    out.push(i)
    i = haystack.indexOf(needle, i + 1)
  }
  return out
}

/** 行窗口匹配：返回每个候选窗口的 [start, end) 偏移与行数组 */
function findWindowMatches(
  contentLines: LineInfo[],
  oldLines: string[],
  cmp: (contentLine: string, oldLine: string) => boolean,
): { start: number; end: number; lines: string[] }[] {
  const matches: { start: number; end: number; lines: string[] }[] = []
  if (oldLines.length === 0 || contentLines.length < oldLines.length) return matches
  for (let i = 0; i + oldLines.length <= contentLines.length; i++) {
    let ok = true
    for (let k = 0; k < oldLines.length; k++) {
      if (!cmp(contentLines[i + k].text, oldLines[k])) {
        ok = false
        break
      }
    }
    if (ok) {
      const first = contentLines[i]
      const last = contentLines[i + oldLines.length - 1]
      matches.push({ start: first.start, end: last.end, lines: contentLines.slice(i, i + oldLines.length).map((l) => l.text) })
    }
  }
  return matches
}

function indentOf(line: string): number {
  const m = line.match(/^[ \t]*/)
  return m ? m[0].length : 0
}

function baseIndent(lines: string[]): number {
  const inds = lines.filter((l) => l.trim()).map(indentOf)
  return inds.length ? Math.min(...inds) : 0
}

function leadingWs(line: string): string {
  const m = line.match(/^[ \t]*/)
  return m ? m[0] : ""
}

function commonPrefixLen(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/** L3 逐行重定缩进：文本未变的行保留内容行原样；变化的行 = 内容行缩进 + 新行相对 old 的额外缩进 */
function reindentLine(contentLine: string, oldLine: string, newLine: string): string {
  if (!newLine.trim()) return newLine
  if (newLine.trim() === contentLine.trim()) return contentLine
  const cws = leadingWs(contentLine)
  const ows = leadingWs(oldLine)
  const nws = leadingWs(newLine)
  const extra = nws.slice(commonPrefixLen(ows, nws))
  return cws + extra + newLine.slice(nws.length)
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length,
    n = b.length
  if (!m || !n) return m || n
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

function fuzzyLineEq(a: string, b: string): boolean {
  const at = a.trim(),
    bt = b.trim()
  if (!at || !bt) return at === bt
  const tolerance = Math.max(2, Math.floor(Math.max(at.length, bt.length) / 4))
  return levenshtein(at, bt) <= tolerance
}

function applyMatches(
  content: string,
  rawMatches: { start: number; end: number; lines?: string[] }[],
  build: (m: { start: number; end: number; lines: string[] }) => string,
  replaceAll: boolean,
): string {
  const matches = rawMatches.map((m) => ({ ...m, lines: m.lines ?? [] }))
  if (matches.length > 1 && !replaceAll)
    throw new Error(
      `oldString matches ${matches.length} locations (multiple matches); provide replaceAll or add surrounding context`,
    )
  const targets = replaceAll ? matches : matches.slice(0, 1)
  let out = ""
  let cursor = 0
  for (const m of targets) {
    out += content.slice(cursor, m.start) + build(m)
    cursor = m.end
  }
  return out + content.slice(cursor)
}

export function replace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): string {
  // L1: exact 子串（保留匹配范围外的缩进）
  const exact = allIndexOf(content, oldString)
  if (exact.length) {
    return applyMatches(
      content,
      exact.map((s) => ({ start: s, end: s + oldString.length })),
      () => newString,
      replaceAll,
    )
  }

  const contentLines = splitLines(content)
  const oldLines = oldString.split("\n")

  // L2: 行尾空白容忍（行首必须一致）
  const trimmedMatches = findWindowMatches(contentLines, oldLines, (a, b) =>
    a.replace(/\s+$/, "") === b.replace(/\s+$/, ""),
  )
  if (trimmedMatches.length) {
    return applyMatches(content, trimmedMatches, () => newString, replaceAll)
  }

  // L3: 缩进灵活 —— 行级 trim 匹配，逐行保留内容的原始缩进
  const flexMatches = findWindowMatches(contentLines, oldLines, (a, b) => a.trim() === b.trim())
  if (flexMatches.length) {
    return applyMatches(
      content,
      flexMatches,
      (m) => {
        const newLines = newString.split("\n")
        return newLines
          .map((nl, k) => {
            const cl = m.lines[Math.min(k, m.lines.length - 1)]
            const ol = oldLines[Math.min(k, oldLines.length - 1)]
            return reindentLine(cl, ol, nl)
          })
          .join("\n")
      },
      replaceAll,
    )
  }

  // L4: 块锚 —— 首尾行精确（trim 后），中间行模糊
  if (oldLines.length >= 2) {
    const first = oldLines[0].trim(),
      last = oldLines[oldLines.length - 1].trim()
    const oldMiddles = oldLines.slice(1, -1)
    const anchors: { start: number; end: number; lines: string[] }[] = []
    for (let i = 0; i < contentLines.length - 1; i++) {
      if (contentLines[i].text.trim() !== first) continue
      for (let j = i + 1; j < contentLines.length; j++) {
        if (contentLines[j].text.trim() !== last) continue
        const matchedLineCount = j - i + 1
        if (isDisproportionateMatch(matchedLineCount, oldLines.length)) continue
        const middles = contentLines.slice(i + 1, j).map((l) => l.text)
        // 每条 old 中间行都要模糊命中内容中间区的某一行
        const ok = oldMiddles.every((om) => middles.some((cm) => fuzzyLineEq(cm, om)))
        if (ok)
          anchors.push({
            start: contentLines[i].start,
            end: contentLines[j].end,
            lines: contentLines.slice(i, j + 1).map((l) => l.text),
          })
      }
    }
    if (anchors.length) {
      return applyMatches(content, anchors, () => newString, replaceAll)
    }
  }

  throw new Error(
    "Could not find oldString in file (tried exact, line-trimmed, indentation-flexible, block-anchor matching)",
  )
}
