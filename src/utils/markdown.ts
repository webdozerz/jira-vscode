/**
 * Конвертер Markdown → wiki-разметка Jira (Data Center использует именно её).
 * Покрывает то, что реально пишут в комментариях: заголовки, выделение, код, ссылки, списки,
 * цитаты, таблицы, разделители. Всё нераспознанное остаётся обычным текстом.
 */

const CODE_LANGUAGES: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', javascript: 'javascript', ts: 'javascript', tsx: 'javascript',
  typescript: 'javascript', json: 'javascript', vue: 'html', html: 'html', xml: 'xml', css: 'css',
  scss: 'css', sass: 'css', sql: 'sql', bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash',
  yaml: 'yaml', yml: 'yaml', java: 'java', py: 'python', python: 'python', go: 'go', rb: 'ruby',
  ruby: 'ruby', php: 'php', c: 'c', cpp: 'cpp', cs: 'c#', csharp: 'c#', swift: 'swift', scala: 'scala',
}

const PLACEHOLDER = '\u0000'
const WORD_CHAR = /[\p{L}\p{N}]/u
const URL_PATTERN = /^https?:\/\/[^\s<>)\]]+/

/** Символы, которые Jira иначе принимает за свою разметку. */
const escapeWikiText = (text: string): string => text.replace(/([{}[\]*_^~|])/g, '\\$1')

const isSafeUrl = (url: string): boolean => /^(https?:\/\/|mailto:|\/)/i.test(url)

function findClosing(text: string, from: number, delimiter: string): number {
  let index = text.indexOf(delimiter, from)
  while (index !== -1) {
    if (text[index - 1] !== '\\') {
      return index
    }
    index = text.indexOf(delimiter, index + 1)
  }
  return -1
}

function convertInline(text: string): string {
  let result = ''
  let i = 0

  while (i < text.length) {
    const rest = text.slice(i)
    const char = text[i]

    // экранирование Markdown: \* → *
    if (char === '\\' && i + 1 < text.length && /[\\`*_{}[\]()#+\-.!~|>]/.test(text[i + 1])) {
      result += escapeWikiText(text[i + 1])
      i += 2
      continue
    }

    if (char === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i + 1) {
        result += `{{${escapeWikiText(text.slice(i + 1, end))}}}`
        i = end + 1
        continue
      }
    }

    const image = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest)
    if (image && isSafeUrl(image[2])) {
      result += `!${image[2]}!`
      i += image[0].length
      continue
    }

    const link = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest)
    if (link && isSafeUrl(link[2])) {
      const label = convertInline(link[1]).replace(/\|/g, '\\|')
      result += label ? `[${label}|${link[2]}]` : `[${link[2]}]`
      i += link[0].length
      continue
    }

    const autolink = /^<(https?:\/\/[^>\s]+)>/.exec(rest)
    if (autolink) {
      result += `[${autolink[1]}]`
      i += autolink[0].length
      continue
    }

    // голые ссылки Jira распознаёт сама — не трогаем символы внутри
    const bareUrl = URL_PATTERN.exec(rest)
    if (bareUrl && !WORD_CHAR.test(text[i - 1] ?? ' ')) {
      result += bareUrl[0]
      i += bareUrl[0].length
      continue
    }

    const mention = /^@([A-Za-z0-9._-]+)/.exec(rest)
    if (mention && !WORD_CHAR.test(text[i - 1] ?? ' ')) {
      result += `[~${mention[1].replace(/[.-]+$/, '')}]`
      i += mention[1].replace(/[.-]+$/, '').length + 1
      continue
    }

    const emphasis = convertEmphasis(text, i)
    if (emphasis) {
      result += emphasis.output
      i = emphasis.next
      continue
    }

    // подчёркивание внутри слова (snake_case) Jira эмфазой не считает — экранировать не нужно
    const isIntrawordUnderscore =
      char === '_' && WORD_CHAR.test(text[i - 1] ?? ' ') && WORD_CHAR.test(text[i + 1] ?? ' ')
    result += isIntrawordUnderscore ? char : escapeWikiText(char)
    i += 1
  }

  return result
}

interface IEmphasisMatch {
  output: string
  next: number
}

function convertEmphasis(text: string, i: number): IEmphasisMatch | undefined {
  const char = text[i]
  const previous = text[i - 1] ?? ' '

  if (char === '~' && text.startsWith('~~', i)) {
    const end = findClosing(text, i + 2, '~~')
    if (end > i + 2) {
      return { output: `-${convertInline(text.slice(i + 2, end))}-`, next: end + 2 }
    }
  }

  if (char !== '*' && char !== '_') {
    return undefined
  }

  for (const marker of [char.repeat(3), char.repeat(2), char]) {
    if (!text.startsWith(marker, i)) {
      continue
    }
    // подчёркивание внутри слова (snake_case) выделением не считается
    if (char === '_' && WORD_CHAR.test(previous)) {
      return undefined
    }
    if (/\s/.test(text[i + marker.length] ?? ' ')) {
      continue
    }

    const end = findClosing(text, i + marker.length, marker)
    if (end <= i + marker.length || /\s/.test(text[end - 1])) {
      continue
    }
    if (char === '_' && WORD_CHAR.test(text[end + marker.length] ?? ' ')) {
      continue
    }

    const inner = convertInline(text.slice(i + marker.length, end))
    const output = marker.length === 3 ? `*_${inner}_*` : marker.length === 2 ? `*${inner}*` : `_${inner}_`
    return { output, next: end + marker.length }
  }

  return undefined
}

const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/
const HORIZONTAL_RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

const splitTableRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim())

const indentWidth = (indent: string): number => indent.replace(/\t/g, '    ').length

interface IListLevel {
  width: number
  marker: '*' | '#'
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*([\w+#-]*)/

/** Вырезает fenced-блоки кода (``` и ~~~), оставляя на их месте маркеры-заглушки. */
function extractCodeBlocks(markdown: string): { text: string; blocks: string[] } {
  const blocks: string[] = []
  const output: string[] = []
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')

  for (let index = 0; index < lines.length; index++) {
    const open = FENCE_OPEN.exec(lines[index])
    if (!open) {
      output.push(lines[index])
      continue
    }

    const fence = open[1]
    const code: string[] = []
    index += 1
    while (index < lines.length && !new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`).test(lines[index])) {
      code.push(lines[index])
      index += 1
    }

    const language = CODE_LANGUAGES[open[2].toLowerCase()]
    blocks.push(`{code${language ? `:${language}` : ''}}\n${code.join('\n')}\n{code}`)
    output.push(`${PLACEHOLDER}${blocks.length - 1}${PLACEHOLDER}`)
  }

  return { text: output.join('\n'), blocks }
}

export function markdownToJira(markdown: string): string {
  const { text: withoutCode, blocks: codeBlocks } = extractCodeBlocks(markdown)

  const lines = withoutCode.split('\n')
  const output: string[] = []
  let listStack: IListLevel[] = []

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]

    const listItem = LIST_ITEM.exec(line)
    if (!listItem || HORIZONTAL_RULE.test(line)) {
      listStack = []
    }

    if (new RegExp(`^${PLACEHOLDER}\\d+${PLACEHOLDER}$`).test(line.trim())) {
      output.push(line.trim())
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      output.push(`h${heading[1].length}. ${convertInline(heading[2])}`)
      continue
    }

    if (HORIZONTAL_RULE.test(line)) {
      output.push('----')
      continue
    }

    if (listItem) {
      const width = indentWidth(listItem[1])
      const marker: '*' | '#' = /\d/.test(listItem[2]) ? '#' : '*'

      while (listStack.length > 0 && width < listStack[listStack.length - 1].width) {
        listStack.pop()
      }
      if (listStack.length === 0 || width > listStack[listStack.length - 1].width) {
        listStack.push({ width, marker })
      } else {
        listStack[listStack.length - 1].marker = marker
      }

      const task = /^\[([ xX])\]\s+(.*)$/.exec(listItem[3])
      const content = task ? `${task[1] === ' ' ? '☐' : '☑'} ${convertInline(task[2])}` : convertInline(listItem[3])
      output.push(`${listStack.map((level) => level.marker).join('')} ${content}`)
      continue
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(convertInline(lines[index].replace(/^\s*>\s?/, '')))
        index += 1
      }
      index -= 1
      output.push(quote.length === 1 ? `bq. ${quote[0]}` : `{quote}\n${quote.join('\n')}\n{quote}`)
      continue
    }

    if (line.includes('|') && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1]) && line.trim() !== '') {
      const header = splitTableRow(line).map(convertInline)
      output.push(`||${header.join('||')}||`)
      index += 1
      while (index + 1 < lines.length && lines[index + 1].includes('|') && lines[index + 1].trim() !== '') {
        index += 1
        const cells = splitTableRow(lines[index]).map((cell) => convertInline(cell) || ' ')
        output.push(`|${cells.join('|')}|`)
      }
      continue
    }

    output.push(convertInline(line))
  }

  return output
    .join('\n')
    .replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'), (_, id: string) => codeBlocks[Number(id)])
}
