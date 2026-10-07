import { describe, expect, it } from 'vitest'

import { buildBranchName, slugify, validateBranchName } from '../src/utils/branch'

describe('slugify', () => {
  it('transliterates Russian and strips punctuation', () => {
    expect(slugify('Реализовать форму вывода (Travel Rule)')).toBe('realizovat-formu-vyvoda-travel-rule')
    expect(slugify('Ёжик, щука & Ъ')).toBe('ezhik-schuka')
  })

  it('truncates without trailing dash', () => {
    const slug = slugify('очень длинное название задачи для проверки', 20)
    expect(slug.length).toBeLessThanOrEqual(20)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('buildBranchName', () => {
  it('uses the default team template', () => {
    expect(buildBranchName({ template: 'feat/{key}', key: 'SE-123', summary: 'Что-то' })).toBe('feat/SE-123')
  })

  it('appends slug when requested', () => {
    expect(buildBranchName({ template: 'feat/{key}-{slug}', key: 'SE-1', summary: 'Форма вывода' })).toBe(
      'feat/SE-1-forma-vyvoda',
    )
  })

  it('drops dangling separator when slug is empty', () => {
    expect(buildBranchName({ template: 'feat/{key}-{slug}', key: 'SE-1', summary: '!!!' })).toBe('feat/SE-1')
  })
})

describe('validateBranchName', () => {
  it('accepts normal names', () => {
    expect(validateBranchName('feat/SE-123')).toBeUndefined()
    expect(validateBranchName('feat/SE-123-forma')).toBeUndefined()
  })

  it.each(['', 'feat SE-1', 'feat/SE-1.', 'feat//x', '/x', 'a..b', 'x.lock', 'a~b', '-x'])('rejects %j', (name) => {
    expect(validateBranchName(name)).toBeTypeOf('string')
  })
})
