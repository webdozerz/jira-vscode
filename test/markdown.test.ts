import { describe, expect, it } from 'vitest'

import { markdownToJira } from '../src/utils/markdown'

describe('markdownToJira', () => {
  it('converts headings and emphasis', () => {
    expect(markdownToJira('# Заголовок\n## Второй')).toBe('h1. Заголовок\nh2. Второй')
    expect(markdownToJira('**жирный**, *курсив*, _тоже курсив_, ~~зачёркнутый~~')).toBe(
      '*жирный*, _курсив_, _тоже курсив_, -зачёркнутый-',
    )
    expect(markdownToJira('***всё сразу***')).toBe('*_всё сразу_*')
  })

  it('keeps snake_case and stray markers intact', () => {
    expect(markdownToJira('use snake_case_name here')).toBe('use snake_case_name here')
    expect(markdownToJira('2 * 3 = 6')).toBe('2 \\* 3 = 6')
  })

  it('converts inline code and escapes wiki chars inside', () => {
    expect(markdownToJira('Вызови `foo()` и `a*b`')).toBe('Вызови {{foo()}} и {{a\\*b}}')
  })

  it('converts fenced code blocks with language mapping', () => {
    const md = 'До\n```ts\nconst a = *1*\n```\nПосле'
    expect(markdownToJira(md)).toBe('До\n{code:javascript}\nconst a = *1*\n{code}\nПосле')
    expect(markdownToJira('```\nplain\n```')).toBe('{code}\nplain\n{code}')
  })

  it('does not touch markdown inside code blocks and closes unfinished ones', () => {
    expect(markdownToJira('```\n# not a heading\n- not a list')).toBe('{code}\n# not a heading\n- not a list\n{code}')
  })

  it('converts links, images, autolinks and mentions', () => {
    expect(markdownToJira('[сайт](https://example.com/a_b)')).toBe('[сайт|https://example.com/a_b]')
    expect(markdownToJira('![схема](https://example.com/i.png)')).toBe('!https://example.com/i.png!')
    expect(markdownToJira('<https://example.com>')).toBe('[https://example.com]')
    expect(markdownToJira('см. https://example.com/a_b_c ок')).toBe('см. https://example.com/a_b_c ок')
    expect(markdownToJira('привет @webdozerz!')).toBe('привет [~webdozerz]!')
    expect(markdownToJira('почта a@b.com')).toBe('почта a@b.com')
  })

  it('rejects unsafe link schemes', () => {
    expect(markdownToJira('[x](javascript:alert(1))')).not.toContain('javascript:alert(1)|')
  })

  it('converts nested bullet and numbered lists', () => {
    const md = '- один\n  - вложенный\n- два\n\n1. первый\n2. второй\n   - внутри'
    expect(markdownToJira(md)).toBe('* один\n** вложенный\n* два\n\n# первый\n# второй\n#* внутри')
  })

  it('converts task list items', () => {
    expect(markdownToJira('- [ ] todo\n- [x] done')).toBe('* ☐ todo\n* ☑ done')
  })

  it('converts quotes', () => {
    expect(markdownToJira('> одна строка')).toBe('bq. одна строка')
    expect(markdownToJira('> первая\n> вторая')).toBe('{quote}\nпервая\nвторая\n{quote}')
  })

  it('converts tables', () => {
    const md = '| Имя | Роль |\n|---|---|\n| Аня | dev |\n| Боря | qa |'
    expect(markdownToJira(md)).toBe('||Имя||Роль||\n|Аня|dev|\n|Боря|qa|')
  })

  it('converts horizontal rules and escapes macros in text', () => {
    expect(markdownToJira('---')).toBe('----')
    expect(markdownToJira('шаблон {panel} и [x]')).toBe('шаблон \\{panel\\} и \\[x\\]')
  })

  it('respects markdown escapes', () => {
    expect(markdownToJira('\\*не курсив\\*')).toBe('\\*не курсив\\*')
  })

  it('does not strip trailing # from titles like C#', () => {
    expect(markdownToJira('# Язык C#')).toBe('h1. Язык C#')
  })
})
