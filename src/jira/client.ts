import * as vscode from 'vscode'

import type { TokenStore } from '../auth/secrets'

const REQUEST_TIMEOUT_MS = 20_000

export class JiraError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'JiraError'
  }
}

export function getBaseUrl(): string {
  const url = vscode.workspace.getConfiguration('jira').get<string>('baseUrl', '')
  return url.trim().replace(/\/+$/, '')
}

function formatApiError(status: number, text: string): string {
  if (status === 401) {
    return 'Токен недействителен или просрочен. Укажите новый токен.'
  }
  if (status === 403) {
    return 'Недостаточно прав для этого действия в Jira.'
  }
  if (status === 404) {
    return 'Не найдено: проверьте, что задача или проект существуют и доступны вам.'
  }

  try {
    const body = JSON.parse(text) as { errorMessages?: string[]; errors?: Record<string, string> }
    const messages = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})]
    if (messages.length > 0) {
      return `Jira (${status}): ${messages.join('; ')}`
    }
  } catch {
    // тело не JSON — покажем как есть
  }

  return `Jira API ${status}: ${text.slice(0, 300)}`
}

export interface IRequestOptions {
  method?: string
  body?: unknown
  /** Ответ не JSON, а текст (например, отрендеренный HTML). */
  accept?: 'json' | 'html'
}

export class JiraClient {
  constructor(private readonly tokens: TokenStore) {}

  private async prepare(): Promise<{ token: string; baseUrl: string }> {
    const token = await this.tokens.get()
    if (!token) {
      throw new JiraError('Токен Jira не указан.')
    }

    const baseUrl = getBaseUrl()
    if (!baseUrl) {
      throw new JiraError('Не задан адрес Jira (настройка jira.baseUrl).')
    }

    return { token, baseUrl }
  }

  private async send(url: string, token: string, init: RequestInit): Promise<Response> {
    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...init.headers },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new JiraError(`Не удалось связаться с Jira: ${reason}`)
    }

    if (!response.ok) {
      throw new JiraError(formatApiError(response.status, await response.text()), response.status)
    }
    return response
  }

  async request<T>(endpoint: string, options: IRequestOptions = {}): Promise<T> {
    const { token, baseUrl } = await this.prepare()
    const isHtml = options.accept === 'html'

    const response = await this.send(baseUrl + endpoint, token, {
      method: options.method ?? 'GET',
      headers: {
        Accept: isHtml ? 'text/html' : 'application/json',
        'Content-Type': 'application/json',
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

    if (response.status === 204) {
      return undefined as T
    }

    const text = await response.text()
    if (isHtml) {
      return text as T
    }
    return (text ? JSON.parse(text) : undefined) as T
  }

  /** Скачивает файл. Токен отправляется только на адрес самой Jira. */
  async download(url: string): Promise<Uint8Array> {
    const { token, baseUrl } = await this.prepare()

    if (new URL(url, `${baseUrl}/`).origin !== new URL(baseUrl).origin) {
      throw new JiraError('Файл расположен не на сервере Jira, скачивание отменено.')
    }

    const response = await this.send(url, token, { headers: { Accept: '*/*' }, redirect: 'error' })
    return new Uint8Array(await response.arrayBuffer())
  }
}
