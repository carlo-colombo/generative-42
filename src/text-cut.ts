export const CUT_LIMIT_MIN = 1
export const CUT_LIMIT_MAX = 200
export const CUT_LIMIT_DEFAULT = 24

export function clampCutLimit(limit: number): number {
  if (!Number.isFinite(limit)) return CUT_LIMIT_DEFAULT
  return Math.min(CUT_LIMIT_MAX, Math.max(CUT_LIMIT_MIN, Math.round(limit)))
}

function cutParagraph(paragraph: string, limit: number): string {
  const words = paragraph.split(/\s+/).filter((word) => word !== '')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (word.length > limit) {
      if (line !== '') {
        lines.push(line)
        line = ''
      }
      let rest = word
      while (rest.length > limit) {
        lines.push(rest.slice(0, limit))
        rest = rest.slice(limit)
      }
      line = rest
      continue
    }
    if (line === '') {
      line = word
      continue
    }
    if (line.length + 1 + word.length > limit) {
      lines.push(line)
      line = word
      continue
    }
    line = `${line} ${word}`
  }
  if (line !== '') lines.push(line)
  return lines.join('\n')
}

export function cutTextAtWords(text: string, limit: number): string {
  const width = clampCutLimit(limit)
  return text
    .split('\n')
    .map((paragraph) => cutParagraph(paragraph, width))
    .join('\n')
}
