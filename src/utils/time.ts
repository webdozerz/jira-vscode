const TIME_SPENT_PATTERN = /^(\d+(\.\d+)?\s*[wdhm]\s*)+$/i

/** Проверка формата Jira: `1h 30m`, `2d`, `45m`. Возвращает текст ошибки или undefined. */
export function validateTimeSpent(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return 'Укажите затраченное время, например 1h 30m'
  }
  if (!TIME_SPENT_PATTERN.test(trimmed)) {
    return 'Формат: число + w/d/h/m, например 1h 30m или 45m'
  }
  return undefined
}

const pad = (value: number, length = 2): string => String(value).padStart(length, '0')

/** Формат Jira DC: `yyyy-MM-dd'T'HH:mm:ss.SSSZ` со смещением без двоеточия (+0300). */
export function formatJiraDate(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const offset = `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
    offset
  )
}

const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/

/** Разбор `YYYY-MM-DD` или `YYYY-MM-DD HH:mm` (локальное время). */
export function parseLocalDateTime(value: string): Date | undefined {
  const match = DATE_TIME_PATTERN.exec(value.trim())
  if (!match) {
    return undefined
  }

  const [, year, month, day, hours = '09', minutes = '00'] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes))

  return Number.isNaN(date.getTime()) ? undefined : date
}
