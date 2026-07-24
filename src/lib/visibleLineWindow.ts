export type VisibleLineWindow = {
  start: number
  end: number
  offsetPx: number
}

export function visibleLineWindow(
  lineCount: number,
  scrollTop: number,
  viewportHeight: number,
  lineHeight: number,
  overscan = 4,
): VisibleLineWindow {
  const count = Math.max(1, Math.trunc(lineCount))
  const height = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 20
  const first = Math.max(0, Math.floor(Math.max(0, scrollTop) / height) - overscan)
  const visible = Math.max(1, Math.ceil(Math.max(height, viewportHeight) / height))
  const end = Math.min(count, first + visible + overscan * 2)
  return { start: first, end, offsetPx: first * height - Math.max(0, scrollTop) }
}

export function countTextLines(value: string): number {
  let count = 1
  for (let index = 0; index < value.length; index += 1) if (value.charCodeAt(index) === 10) count += 1
  return count
}
