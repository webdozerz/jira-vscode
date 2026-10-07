const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*-\d+$/
const BROWSE_PATH = /\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)/

/** Ключ задачи из текста: `se-123`, `SE-123` или ссылка вида `https://jira/browse/SE-123?...`. */
export function parseIssueKey(text: string): string | undefined {
  const value = text.trim()
  if (KEY_PATTERN.test(value)) {
    return value.toUpperCase()
  }

  try {
    const url = new URL(value)
    const fromPath = BROWSE_PATH.exec(url.pathname)?.[1]
    const fromQuery = url.searchParams.get('selectedIssue')
    const candidate = fromPath ?? (fromQuery && KEY_PATTERN.test(fromQuery) ? fromQuery : undefined)
    return candidate?.toUpperCase()
  } catch {
    return undefined
  }
}
