import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IJiraIssueDetails, IJiraTransition } from '../src/jira/types'
import { renderIssuePage } from '../src/views/issueHtml'

const status = { id: '1', name: 'In progress', statusCategory: { key: 'indeterminate' } }
const me = { name: 'me', displayName: 'Me' }
const other = { name: 'other', displayName: 'Other' }

const details: IJiraIssueDetails = {
  key: 'SE-1',
  fields: {
    summary: 'Тест <b>XSS</b>',
    description: 'desc',
    status,
    issuetype: { name: 'Task', subtask: false },
    labels: [],
    created: '2026-10-01T10:00:00.000+0000',
    updated: '2026-10-02T10:00:00.000+0000',
    comment: {
      total: 2,
      comments: [
        { id: '10', author: me, body: '*мой* комментарий', created: '2026-10-01T10:00:00.000+0000' },
        { id: '11', author: other, body: 'чужой', created: '2026-10-01T11:00:00.000+0000' },
      ],
    },
    worklog: {
      total: 2,
      worklogs: [
        { id: '20', author: me, timeSpent: '2h', started: '2026-09-30T06:48:00.000+0000', comment: 'ресерч' },
        { id: '21', author: other, timeSpent: '1h', started: '2026-09-30T08:00:00.000+0000' },
      ],
    },
    parent: { key: 'SE-0', fields: { summary: 'Родитель', status, issuetype: { name: 'Story', subtask: false } } },
    subtasks: [{ key: 'SE-2', fields: { summary: 'Под', status: { ...status, statusCategory: { key: 'done' } }, issuetype: { name: 'Sub', subtask: true } } }],
    attachment: [{ id: '5', filename: 'a.png', size: 2048, created: '2026-10-01T10:00:00.000+0000', content: 'https://jira/x' }],
  },
  sprints: [],
  renderedFields: { description: '<p>desc</p>', comment: { comments: [{ id: '10', body: '<p><b>мой</b></p>' }, { id: '11', body: '<p>чужой</p>' }] } },
}

const transitions: IJiraTransition[] = [{ id: '31', name: 'Ready', to: { ...status, id: '2', name: 'In Review' } }]
const script = readFileSync(resolve(__dirname, '../media/issue.js'), 'utf8')

function mount(options: { openForm?: 'transition'; draft?: string; flash?: string } = {}) {
  const html = renderIssuePage({
    details,
    transitions,
    baseUrl: 'https://jira.example',
    nonce: 'N',
    cspSource: 'csp',
    styleUri: 's.css',
    scriptUri: 'issue.js',
    currentUser: 'me',
    markdownDefault: true,
    flash: options.flash,
    openForm: options.openForm,
  })

  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true })
  const postMessage = vi.fn()
  let state: unknown = options.draft ? { commentDraft: options.draft } : undefined
  Object.assign(dom.window, {
    acquireVsCodeApi: () => ({
      postMessage,
      getState: () => state,
      setState: (value: unknown) => {
        state = value
      },
    }),
  })
  dom.window.eval(script)

  const doc = dom.window.document
  const click = (selector: string, index = 0) =>
    (doc.querySelectorAll(selector)[index] as HTMLElement).click()
  const submit = (form: Element) => (form as HTMLFormElement).requestSubmit()
  const reply = (data: unknown) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data }))

  return { dom, doc, postMessage, click, submit, reply, getState: () => state }
}

describe('issue webview script', () => {
  let page: ReturnType<typeof mount>
  beforeEach(() => {
    page = mount()
  })
  afterEach(() => page.dom.window.close())

  it('escapes the summary and renders relations and attachments', () => {
    expect(page.doc.querySelector('h1')?.innerHTML).toBe('Тест &lt;b&gt;XSS&lt;/b&gt;')
    expect(page.doc.querySelectorAll('[data-issue]')).toHaveLength(2)
    expect(page.doc.querySelector('[data-attachment]')?.textContent).toBe('a.png')
    expect(page.doc.body.innerHTML).not.toMatch(/\son\w+=/)
  })

  it('opens another issue and attachments through messages', () => {
    page.click('[data-issue]', 1)
    page.click('[data-attachment]')
    page.click('[data-attachment-browser]')
    expect(page.postMessage.mock.calls.map(([m]) => m)).toEqual([
      { type: 'openIssue', key: 'SE-2' },
      { type: 'attachment', id: '5' },
      { type: 'attachment', id: '5', inBrowser: true },
    ])
  })

  it('shows edit and delete only for own records', () => {
    const cards = page.doc.querySelectorAll('.card')
    const hasActions = Array.from(cards).map((card) => Boolean(card.querySelector('[data-edit]')))
    expect(hasActions).toEqual([true, false, true, false])
  })

  it('sends a comment with the markdown flag and keeps empty ones out', () => {
    page.click('[data-open-form="comment"]')
    const form = page.doc.getElementById('form-comment') as HTMLFormElement
    expect(form.hidden).toBe(false)

    // пустое поле останавливает встроенная проверка `required`; строку из пробелов — наш код
    ;(form.elements.namedItem('body') as HTMLTextAreaElement).value = '   '
    page.submit(form)
    expect(page.doc.getElementById('error')?.textContent).toBe('Комментарий не может быть пустым')
    expect(page.postMessage).not.toHaveBeenCalled()

    ;(form.elements.namedItem('body') as HTMLTextAreaElement).value = '**привет**'
    page.submit(form)
    expect(page.postMessage).toHaveBeenCalledWith({ type: 'comment', body: '**привет**', markdown: true })
  })

  it('requests a preview and applies only the latest answer', () => {
    page.click('[data-open-form="comment"]')
    const form = page.doc.getElementById('form-comment') as HTMLFormElement
    ;(form.elements.namedItem('body') as HTMLTextAreaElement).value = '# hi'

    page.click('[data-toggle-preview]')
    const first = page.postMessage.mock.calls[0][0]
    expect(first).toMatchObject({ type: 'preview', text: '# hi', markdown: true })

    page.click('[data-toggle-preview]')
    page.click('[data-toggle-preview]')
    const latest = page.postMessage.mock.calls.at(-1)?.[0]
    expect(latest.requestId).toBeGreaterThan(first.requestId)

    page.reply({ type: 'preview', requestId: first.requestId, html: '<p>stale</p>', wiki: 'old' })
    expect(page.doc.querySelector('[data-preview-body]')?.innerHTML).not.toContain('stale')

    page.reply({ type: 'preview', requestId: latest.requestId, html: '<h1>hi</h1>', wiki: 'h1. hi' })
    expect(page.doc.querySelector('[data-preview-body]')?.innerHTML).toBe('<h1>hi</h1>')
    expect(page.doc.querySelector('[data-preview-wiki]')?.textContent).toBe('h1. hi')
  })

  it('edits an own worklog inline with validation', () => {
    page.click('.card[data-worklog-id="20"] [data-edit]')
    const form = page.doc.querySelector('.form_inline') as HTMLFormElement
    expect((form.elements.namedItem('timeSpent') as HTMLInputElement).value).toBe('2h')
    expect((form.elements.namedItem('comment') as HTMLTextAreaElement).value).toBe('ресерч')

    ;(form.elements.namedItem('timeSpent') as HTMLInputElement).value = 'abc'
    page.submit(form)
    expect(form.querySelector('.error')?.textContent).toContain('1h 30m')
    expect(page.postMessage).not.toHaveBeenCalled()

    ;(form.elements.namedItem('timeSpent') as HTMLInputElement).value = '3h'
    page.submit(form)
    expect(page.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'editWorklog', id: '20', timeSpent: '3h', comment: 'ресерч' }),
    )
  })

  it('edits and cancels an own comment, restoring the original view', () => {
    page.click('.card[data-comment-id="10"] [data-edit]')
    const card = page.doc.querySelector('.card[data-comment-id="10"]') as HTMLElement
    expect((card.querySelector('[data-view]') as HTMLElement).hidden).toBe(true)
    expect((card.querySelector('textarea') as HTMLTextAreaElement).value).toBe('*мой* комментарий')

    ;(card.querySelector('.secondary') as HTMLElement).click()
    expect(card.querySelector('form')).toBeNull()
    expect((card.querySelector('[data-view]') as HTMLElement).hidden).toBe(false)
  })

  it('posts delete messages and re-enables controls when the user declines', () => {
    page.click('.card[data-worklog-id="20"] [data-delete]')
    expect(page.postMessage).toHaveBeenCalledWith({ type: 'deleteWorklog', id: '20' })
    const button = page.doc.querySelector('.card[data-worklog-id="20"] [data-delete]') as HTMLButtonElement
    expect(button.disabled).toBe(true)

    page.reply({ type: 'cancelled' })
    expect(button.disabled).toBe(false)
  })

  it('shows host errors and unlocks the form', () => {
    page.click('[data-open-form="worklog"]')
    const form = page.doc.getElementById('form-worklog') as HTMLFormElement
    ;(form.elements.namedItem('timeSpent') as HTMLInputElement).value = '1h'
    page.submit(form)
    expect((form.elements.namedItem('timeSpent') as HTMLInputElement).disabled).toBe(true)

    page.reply({ type: 'error', message: 'Недостаточно прав' })
    expect(page.doc.getElementById('error')?.textContent).toBe('Недостаточно прав')
    expect((form.elements.namedItem('timeSpent') as HTMLInputElement).disabled).toBe(false)
  })

  it('stores the comment draft', () => {
    page.click('[data-open-form="comment"]')
    const body = page.doc.querySelector('#form-comment textarea') as HTMLTextAreaElement
    body.value = 'черновик'
    body.dispatchEvent(new page.dom.window.Event('input'))
    expect(page.getState()).toEqual({ commentDraft: 'черновик' })
  })
})

describe('issue webview start-up state', () => {
  it('continues the status chain: opens the transition form and keeps the flash', () => {
    const page = mount({ openForm: 'transition', flash: 'Статус изменён: In Review' })
    expect((page.doc.getElementById('form-transition') as HTMLElement).hidden).toBe(false)
    expect((page.doc.getElementById('flash') as HTMLElement).hidden).toBe(false)
    page.dom.window.close()
  })

  it('restores a saved draft and opens the comment form', () => {
    const page = mount({ draft: 'не потерять' })
    expect((page.doc.getElementById('form-comment') as HTMLElement).hidden).toBe(false)
    expect((page.doc.querySelector('#form-comment textarea') as HTMLTextAreaElement).value).toBe('не потерять')
    page.dom.window.close()
  })
})
