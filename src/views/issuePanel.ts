import { randomBytes } from 'node:crypto'

import * as vscode from 'vscode'

import type { JiraApi } from '../jira/api'
import { getBaseUrl } from '../jira/client'
import type { IJiraAttachment, IJiraIssueDetails, IJiraTransition } from '../jira/types'
import { parseIssueKey } from '../utils/issueKey'
import { markdownToJira } from '../utils/markdown'
import { formatJiraDate, parseLocalDateTime, validateTimeSpent } from '../utils/time'
import { escapeHtml, renderIssuePage, sanitizeJiraHtml } from './issueHtml'
import { getIssueUrl } from './issuesTree'

type TPanelMessage =
  | { type: 'open' | 'refresh' | 'branch' }
  | { type: 'openIssue'; key: string }
  | { type: 'comment'; body: string; markdown: boolean }
  | { type: 'editComment'; id: string; body: string }
  | { type: 'deleteComment'; id: string }
  | { type: 'worklog'; timeSpent: string; started: string; comment: string }
  | { type: 'editWorklog'; id: string; timeSpent: string; started: string; comment: string }
  | { type: 'deleteWorklog'; id: string }
  | { type: 'transition'; transitionId: string; fields: Record<string, string> }
  | { type: 'attachment'; id: string; inBrowser: boolean }
  | { type: 'preview'; text: string; markdown: boolean; requestId: number }

const MAX_OPEN_ATTACHMENT_BYTES = 25 * 1024 * 1024
const OPENABLE_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|svg|bmp|ico|txt|md|json|ya?ml|xml|csv|log|html?|css|jsx?|tsx?|vue|sql|sh|diff|patch)$/i

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const text = (raw: Record<string, unknown>, key: string): string | undefined =>
  typeof raw[key] === 'string' ? raw[key] : undefined

/** Сообщения из webview считаем недоверенными: проверяем форму до использования. */
function parseMessage(raw: unknown): TPanelMessage | undefined {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return undefined
  }

  switch (raw.type) {
    case 'open':
    case 'refresh':
    case 'branch':
      return { type: raw.type }
    case 'openIssue': {
      const key = parseIssueKey(text(raw, 'key') ?? '')
      return key ? { type: 'openIssue', key } : undefined
    }
    case 'comment': {
      const body = text(raw, 'body')
      return body === undefined ? undefined : { type: 'comment', body, markdown: raw.markdown === true }
    }
    case 'editComment': {
      const [id, body] = [text(raw, 'id'), text(raw, 'body')]
      return id && body !== undefined ? { type: 'editComment', id, body } : undefined
    }
    case 'deleteComment':
    case 'deleteWorklog': {
      const id = text(raw, 'id')
      return id ? { type: raw.type, id } : undefined
    }
    case 'worklog':
    case 'editWorklog': {
      const [timeSpent, started, comment] = [text(raw, 'timeSpent'), text(raw, 'started'), text(raw, 'comment')]
      if (timeSpent === undefined || started === undefined || comment === undefined) {
        return undefined
      }
      if (raw.type === 'worklog') {
        return { type: 'worklog', timeSpent, started, comment }
      }
      const id = text(raw, 'id')
      return id ? { type: 'editWorklog', id, timeSpent, started, comment } : undefined
    }
    case 'transition': {
      if (typeof raw.transitionId !== 'string' || !isRecord(raw.fields)) {
        return undefined
      }
      const fields = Object.fromEntries(
        Object.entries(raw.fields).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
      return { type: 'transition', transitionId: raw.transitionId, fields }
    }
    case 'attachment': {
      const id = text(raw, 'id')
      return id ? { type: 'attachment', id, inBrowser: raw.inBrowser === true } : undefined
    }
    case 'preview': {
      const body = text(raw, 'text')
      return body !== undefined && typeof raw.requestId === 'number'
        ? { type: 'preview', text: body, markdown: raw.markdown === true, requestId: raw.requestId }
        : undefined
    }
    default:
      return undefined
  }
}

const safeFileName = (name: string): string =>
  name.replace(/[\\/]/g, '_').replace(/[^\p{L}\p{N}._ ()-]/gu, '_').replace(/^\.+/, '_') || 'attachment'

interface IPanelDeps {
  api: JiraApi
  extensionUri: vscode.Uri
  storageUri: vscode.Uri
  onChanged: () => void
  openIssue: (key: string) => Promise<void>
}

class IssuePanel {
  private transitions: IJiraTransition[] = []
  private details?: IJiraIssueDetails
  private readonly panel: vscode.WebviewPanel

  constructor(
    private readonly issueKey: string,
    private readonly deps: IPanelDeps,
    onDispose: () => void,
  ) {
    this.panel = vscode.window.createWebviewPanel('jira.issue', issueKey, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(deps.extensionUri, 'media')],
    })

    this.panel.webview.html = this.renderMessage('Загрузка…')
    this.panel.onDidDispose(onDispose)
    this.panel.webview.onDidReceiveMessage((raw: unknown) => void this.handleMessage(raw))
  }

  reveal(): void {
    this.panel.reveal()
  }

  async load(flash?: string, openForm?: 'transition'): Promise<void> {
    try {
      const { api, extensionUri } = this.deps
      const [details, transitions, me] = await Promise.all([
        api.getIssueDetails(this.issueKey),
        api.getTransitions(this.issueKey),
        api.getMyself().catch(() => undefined),
      ])
      this.details = details
      this.transitions = transitions

      const { webview } = this.panel
      const media = (file: string): string =>
        webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file)).toString()

      this.panel.title = details.key
      webview.html = renderIssuePage({
        details,
        transitions,
        baseUrl: getBaseUrl(),
        nonce: randomBytes(16).toString('hex'),
        cspSource: webview.cspSource,
        styleUri: media('issue.css'),
        scriptUri: media('issue.js'),
        flash,
        currentUser: me?.name,
        markdownDefault: vscode.workspace.getConfiguration('jira').get<boolean>('markdownComments', true),
        openForm,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.panel.webview.html = this.renderMessage(`Не удалось загрузить задачу ${this.issueKey}. ${message}`)
    }
  }

  private renderMessage(message: string): string {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:24px}</style>
</head><body>${escapeHtml(message)}</body></html>`
  }

  private async handleMessage(raw: unknown): Promise<void> {
    const message = parseMessage(raw)
    if (!message) {
      return
    }

    try {
      switch (message.type) {
        case 'open':
          await vscode.env.openExternal(vscode.Uri.parse(getIssueUrl(this.issueKey)))
          return
        case 'refresh':
          await this.load()
          return
        case 'branch':
          await vscode.commands.executeCommand('jira.createBranch', this.issueKey)
          return
        case 'openIssue':
          await this.deps.openIssue(message.key)
          return
        case 'comment':
          await this.addComment(message.body, message.markdown)
          return
        case 'editComment':
          await this.editComment(message.id, message.body)
          return
        case 'deleteComment':
          await this.deleteComment(message.id)
          return
        case 'worklog':
          await this.saveWorklog(undefined, message)
          return
        case 'editWorklog':
          await this.saveWorklog(message.id, message)
          return
        case 'deleteWorklog':
          await this.deleteWorklog(message.id)
          return
        case 'transition':
          await this.transition(message)
          return
        case 'attachment':
          await this.openAttachment(message.id, message.inBrowser)
          return
        case 'preview':
          await this.preview(message)
          return
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err)
      void this.panel.webview.postMessage({
        type: message.type === 'preview' ? 'previewError' : 'error',
        message: errorText,
        requestId: message.type === 'preview' ? message.requestId : undefined,
      })
    }
  }

  private async addComment(body: string, markdown: boolean): Promise<void> {
    if (!body.trim()) {
      throw new Error('Комментарий не может быть пустым')
    }
    await this.deps.api.addComment(this.issueKey, markdown ? markdownToJira(body.trim()) : body.trim())
    await this.load('Комментарий добавлен')
  }

  private async editComment(id: string, body: string): Promise<void> {
    if (!body.trim()) {
      throw new Error('Комментарий не может быть пустым')
    }
    await this.deps.api.updateComment(this.issueKey, id, body.trim())
    await this.load('Комментарий обновлён')
  }

  private async confirmDelete(what: string): Promise<boolean> {
    const answer = await vscode.window.showWarningMessage(
      `${what} будет удалён без возможности восстановления.`,
      { modal: true },
      'Удалить',
    )
    return answer === 'Удалить'
  }

  private async deleteComment(id: string): Promise<void> {
    if (!(await this.confirmDelete('Комментарий'))) {
      void this.panel.webview.postMessage({ type: 'cancelled' })
      return
    }
    await this.deps.api.deleteComment(this.issueKey, id)
    await this.load('Комментарий удалён')
  }

  private async saveWorklog(
    id: string | undefined,
    message: { timeSpent: string; started: string; comment: string },
  ): Promise<void> {
    const timeError = validateTimeSpent(message.timeSpent)
    if (timeError) {
      throw new Error(timeError)
    }
    const started = parseLocalDateTime(message.started)
    if (!started) {
      throw new Error('Некорректная дата начала')
    }

    const comment = message.comment.trim()
    const worklog = {
      timeSpent: message.timeSpent.trim(),
      started: formatJiraDate(started),
      ...(comment ? { comment } : {}),
    }

    if (id) {
      await this.deps.api.updateWorklog(this.issueKey, id, worklog)
      await this.load(`Ворклог обновлён: ${worklog.timeSpent}`)
    } else {
      await this.deps.api.addWorklog(this.issueKey, worklog)
      await this.load(`Ворклог записан: ${worklog.timeSpent}`)
    }
  }

  private async deleteWorklog(id: string): Promise<void> {
    if (!(await this.confirmDelete('Ворклог'))) {
      void this.panel.webview.postMessage({ type: 'cancelled' })
      return
    }
    await this.deps.api.deleteWorklog(this.issueKey, id)
    await this.load('Ворклог удалён')
  }

  private async transition(message: Extract<TPanelMessage, { type: 'transition' }>): Promise<void> {
    const transition = this.transitions.find((item) => item.id === message.transitionId)
    if (!transition) {
      throw new Error('Этот переход больше недоступен. Обновите задачу.')
    }

    const fields: Record<string, unknown> = {}
    for (const [fieldId, field] of Object.entries(transition.fields ?? {})) {
      if (!field.required || field.hasDefaultValue) {
        continue
      }

      const allowed = field.allowedValues ?? []
      if (allowed.length === 0) {
        throw new Error(`Для этого перехода нужно заполнить поле «${field.name}». Сделайте это в Jira.`)
      }

      const value = message.fields[fieldId]
      if (!allowed.some((item) => item.id === value)) {
        throw new Error(`Выберите значение поля «${field.name}»`)
      }
      fields[fieldId] = { id: value }
    }

    await this.deps.api.doTransition(this.issueKey, transition.id, fields)
    this.deps.onChanged()

    const chain = vscode.workspace.getConfiguration('jira').get<boolean>('chainTransitions', true)
    await this.load(`Статус изменён: ${transition.to.name}`, chain ? 'transition' : undefined)
  }

  private async preview(message: Extract<TPanelMessage, { type: 'preview' }>): Promise<void> {
    const wiki = message.markdown ? markdownToJira(message.text) : message.text
    const html = wiki.trim() ? await this.deps.api.renderWiki(wiki, this.issueKey) : ''

    void this.panel.webview.postMessage({
      type: 'preview',
      requestId: message.requestId,
      html: sanitizeJiraHtml(html, getBaseUrl()),
      wiki,
    })
  }

  private findAttachment(id: string): IJiraAttachment {
    const attachment = this.details?.fields.attachment?.find((item) => item.id === id)
    if (!attachment) {
      throw new Error('Вложение не найдено. Обновите задачу.')
    }
    return attachment
  }

  private async openAttachment(id: string, inBrowser: boolean): Promise<void> {
    const attachment = this.findAttachment(id)

    if (inBrowser) {
      await vscode.env.openExternal(vscode.Uri.parse(attachment.content))
      return
    }

    if (attachment.size > MAX_OPEN_ATTACHMENT_BYTES) {
      const answer = await vscode.window.showWarningMessage(
        `Файл «${attachment.filename}» весит ${(attachment.size / 1024 / 1024).toFixed(0)} МБ. Скачать?`,
        'Скачать',
      )
      if (!answer) {
        return
      }
    }

    const directory = vscode.Uri.joinPath(
      this.deps.storageUri,
      'attachments',
      this.issueKey,
      safeFileName(attachment.id),
    )
    const target = vscode.Uri.joinPath(directory, safeFileName(attachment.filename))

    await vscode.workspace.fs.createDirectory(directory)
    await vscode.workspace.fs.writeFile(target, await this.deps.api.downloadAttachment(attachment.content))

    if (OPENABLE_EXTENSIONS.test(attachment.filename)) {
      await vscode.commands.executeCommand('vscode.open', target, { preview: true })
      return
    }

    const answer = await vscode.window.showInformationMessage(
      `Файл «${attachment.filename}» скачан.`,
      'Показать в папке',
    )
    if (answer) {
      await vscode.commands.executeCommand('revealFileInOS', target)
    }
  }
}

export class IssuePanelManager {
  private readonly panels = new Map<string, IssuePanel>()

  constructor(
    private readonly api: JiraApi,
    private readonly extensionUri: vscode.Uri,
    private readonly storageUri: vscode.Uri,
    private readonly onChanged: () => void,
  ) {}

  /** Перезагружает панель задачи, если она открыта (после действий из дерева или команд). */
  async refreshIfOpen(issueKey: string, flash?: string): Promise<void> {
    await this.panels.get(issueKey)?.load(flash)
  }

  async open(issueKey: string): Promise<void> {
    const existing = this.panels.get(issueKey)
    if (existing) {
      existing.reveal()
      await existing.load()
      return
    }

    const panel = new IssuePanel(
      issueKey,
      {
        api: this.api,
        extensionUri: this.extensionUri,
        storageUri: this.storageUri,
        onChanged: this.onChanged,
        openIssue: (key) => this.open(key),
      },
      () => this.panels.delete(issueKey),
    )
    this.panels.set(issueKey, panel)
    await panel.load()
  }
}
