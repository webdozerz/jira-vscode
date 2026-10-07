import sanitizeHtml from 'sanitize-html'

import type {
  IJiraAttachment,
  IJiraIssueDetails,
  IJiraIssueRef,
  IJiraTransition,
  IJiraUser,
} from '../jira/types'

export interface IIssuePageOptions {
  details: IJiraIssueDetails
  transitions: IJiraTransition[]
  baseUrl: string
  nonce: string
  cspSource: string
  styleUri: string
  scriptUri: string
  flash?: string
  /** Логин текущего пользователя: правка и удаление доступны только для его записей. */
  currentUser?: string
  /** Значение переключателя «Markdown → Jira» в форме комментария по умолчанию. */
  markdownDefault: boolean
  /** Форма, которую нужно открыть сразу после загрузки (продолжение цепочки статусов). */
  openForm?: 'transition'
}

export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const toAbsoluteUrl = (href: string, baseUrl: string): string => {
  try {
    return new URL(href, `${baseUrl}/`).toString()
  } catch {
    return ''
  }
}

/**
 * HTML из Jira (renderedFields) пишут пользователи, поэтому он обязательно проходит через allowlist.
 * Картинки требуют авторизации в браузере и в панели не загрузятся — заменяем их ссылкой.
 */
export function sanitizeJiraHtml(html: string, baseUrl: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'hr', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'sub', 'sup', 'tt',
      'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'span', 'div',
    ],
    allowedAttributes: { a: ['href', 'title'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      // якоря заголовков (`<a name>`) без href ссылками не считаем — иначе получится пустая ссылка
      a: (tagName, attribs) =>
        attribs.href
          ? { tagName, attribs: { ...attribs, href: toAbsoluteUrl(attribs.href, baseUrl) } }
          : { tagName: 'span', attribs: {} },
      img: (_tagName, attribs) => ({
        tagName: 'a',
        attribs: { href: toAbsoluteUrl(attribs.src ?? '', baseUrl) },
        text: attribs.alt || attribs['data-attachment-name'] || '[изображение]',
      }),
    },
  })
}

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })

const userName = (user?: IJiraUser | null): string => user?.displayName ?? 'не назначен'

/** Значение для `<input type="datetime-local">` в локальном времени. */
export function toLocalInputValue(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} Б`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} КБ`
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function renderMeta(details: IJiraIssueDetails): string {
  const { fields } = details
  const time = fields.timetracking
  const rows: Array<[string, string]> = [
    ['Исполнитель', escapeHtml(userName(fields.assignee))],
    ['Автор', escapeHtml(userName(fields.reporter))],
    ['Обновлено', escapeHtml(formatDate(fields.updated))],
  ]
  if (details.sprints.length > 0) {
    rows.push(['Спринт', escapeHtml(details.sprints.map((sprint) => sprint.name).join(', '))])
  }
  if (time?.timeSpent) {
    rows.push(['Затрачено', escapeHtml(time.timeSpent)])
  }
  if (time?.remainingEstimate) {
    rows.push(['Осталось', escapeHtml(time.remainingEstimate)])
  }
  if (fields.labels.length > 0) {
    rows.push(['Метки', escapeHtml(fields.labels.join(', '))])
  }

  return rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')
}

/** Ссылка на другую задачу: по клику панель открывает её же. */
function renderIssueRef(issue: IJiraIssueRef, prefix = ''): string {
  return `<button type="button" class="issue-ref" data-issue="${escapeHtml(issue.key)}">
    ${prefix ? `<span class="issue-ref__relation">${escapeHtml(prefix)}</span>` : ''}
    <span class="issue-ref__key">${escapeHtml(issue.key)}</span>
    <span class="issue-ref__summary">${escapeHtml(issue.fields.summary)}</span>
    <span class="status status_small">${escapeHtml(issue.fields.status.name)}</span>
  </button>`
}

function renderHierarchy(details: IJiraIssueDetails): string {
  const parts: string[] = []
  const { parent } = details.fields

  if (parent) {
    parts.push(`<div class="relations__row"><span class="relations__label">Родитель</span>${renderIssueRef(parent)}</div>`)
  }
  if (details.epicKey) {
    parts.push(
      `<div class="relations__row"><span class="relations__label">Эпик</span><button type="button" class="issue-ref" data-issue="${escapeHtml(details.epicKey)}"><span class="issue-ref__key">${escapeHtml(details.epicKey)}</span></button></div>`,
    )
  }
  return parts.length > 0 ? `<div class="relations">${parts.join('')}</div>` : ''
}

function renderSubtasks(details: IJiraIssueDetails): string {
  const subtasks = details.fields.subtasks ?? []
  if (subtasks.length === 0) {
    return ''
  }

  const done = subtasks.filter((item) => item.fields.status.statusCategory.key === 'done').length
  return `<section><h2>Подзадачи <span class="count">${done}/${subtasks.length}</span></h2>
    <div class="relations">${subtasks.map((item) => `<div class="relations__row">${renderIssueRef(item)}</div>`).join('')}</div>
  </section>`
}

function renderLinks(details: IJiraIssueDetails): string {
  const links = details.fields.issuelinks ?? []
  if (links.length === 0) {
    return ''
  }

  const rows = links
    .map((link) => {
      const issue = link.outwardIssue ?? link.inwardIssue
      if (!issue) {
        return ''
      }
      const relation = link.outwardIssue ? link.type.outward : link.type.inward
      return `<div class="relations__row">${renderIssueRef(issue, relation)}</div>`
    })
    .join('')

  return `<section><h2>Связанные задачи <span class="count">${links.length}</span></h2><div class="relations">${rows}</div></section>`
}

function renderAttachments(attachments: IJiraAttachment[]): string {
  if (attachments.length === 0) {
    return ''
  }

  const rows = attachments
    .map(
      (file) => `<div class="attachment">
        <button type="button" class="link attachment__name" data-attachment="${escapeHtml(file.id)}" title="Открыть в VS Code">${escapeHtml(file.filename)}</button>
        <span class="attachment__meta">${escapeHtml(formatSize(file.size))}${file.author ? ` · ${escapeHtml(file.author.displayName)}` : ''} · ${escapeHtml(formatDate(file.created))}</span>
        <button type="button" class="link attachment__browser" data-attachment-browser="${escapeHtml(file.id)}">в браузере</button>
      </div>`,
    )
    .join('')

  return `<section><h2>Вложения <span class="count">${attachments.length}</span></h2>${rows}</section>`
}

function renderRecordActions(): string {
  return `<div class="card__actions"><button type="button" class="link" data-edit>Изменить</button><button type="button" class="link link_danger" data-delete>Удалить</button></div>`
}

function renderComments(details: IJiraIssueDetails, baseUrl: string, currentUser?: string): string {
  const rendered = new Map((details.renderedFields.comment?.comments ?? []).map((item) => [item.id, item.body]))
  const { comments, total } = details.fields.comment

  const items = comments
    .map((comment) => {
      const html = sanitizeJiraHtml(rendered.get(comment.id) ?? escapeHtml(comment.body), baseUrl)
      const isOwn = Boolean(currentUser) && comment.author.name === currentUser
      const edited = comment.updated && comment.updated !== comment.created ? ' · изменён' : ''
      return `<article class="card" data-comment-id="${escapeHtml(comment.id)}" data-raw="${escapeHtml(comment.body)}">
        <div class="card__head"><strong>${escapeHtml(comment.author.displayName)}</strong><span>${escapeHtml(formatDate(comment.created))}${edited}</span></div>
        <div class="rendered" data-view>${html}</div>
        ${isOwn ? renderRecordActions() : ''}
      </article>`
    })
    .join('')

  return `<section><h2>Комментарии <span class="count">${total}</span></h2>${items || '<p class="empty">Комментариев нет</p>'}</section>`
}

function renderWorklogs(details: IJiraIssueDetails, currentUser?: string): string {
  const { worklogs, total } = details.fields.worklog

  const items = worklogs
    .map((worklog) => {
      const isOwn = Boolean(currentUser) && worklog.author.name === currentUser
      return `<article class="card" data-worklog-id="${escapeHtml(worklog.id)}" data-time-spent="${escapeHtml(worklog.timeSpent)}" data-started="${escapeHtml(toLocalInputValue(worklog.started))}" data-comment="${escapeHtml(worklog.comment ?? '')}">
        <div class="card__head"><strong>${escapeHtml(worklog.timeSpent)}</strong><span>${escapeHtml(worklog.author.displayName)} · ${escapeHtml(formatDate(worklog.started))}</span></div>
        ${worklog.comment ? `<div class="plain" data-view>${escapeHtml(worklog.comment)}</div>` : ''}
        ${isOwn ? renderRecordActions() : ''}
      </article>`
    })
    .join('')

  const hidden = total > worklogs.length ? `<p class="empty">Показаны ${worklogs.length} из ${total}</p>` : ''

  return `<section><h2>Ворклоги <span class="count">${total}</span></h2>${items || '<p class="empty">Ворклогов нет</p>'}${hidden}</section>`
}

/** Данные для формы смены статуса: webview строит поля обязательных значений сам, через DOM. */
function serializeTransitions(transitions: IJiraTransition[]): string {
  const data = transitions.map((transition) => ({
    id: transition.id,
    name: transition.to.name,
    fields: Object.entries(transition.fields ?? {})
      .filter(([, field]) => field.required && !field.hasDefaultValue && (field.allowedValues?.length ?? 0) > 0)
      .map(([id, field]) => ({
        id,
        name: field.name,
        values: (field.allowedValues ?? []).map((value) => ({ id: value.id, name: value.name ?? value.value ?? value.id })),
      })),
  }))
  return escapeHtml(JSON.stringify(data))
}

export function renderIssuePage(options: IIssuePageOptions): string {
  const { details, transitions, baseUrl, nonce, cspSource, styleUri, scriptUri, flash, currentUser, markdownDefault, openForm } =
    options
  const { fields } = details

  const description = details.renderedFields.description
    ? sanitizeJiraHtml(details.renderedFields.description, baseUrl)
    : ''

  const transitionOptions = transitions
    .map((transition) => {
      const hint = transition.name === transition.to.name ? '' : ` — ${transition.name}`
      return `<option value="${escapeHtml(transition.id)}">${escapeHtml(transition.to.name + hint)}</option>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>${escapeHtml(details.key)}</title>
</head>
<body data-transitions="${serializeTransitions(transitions)}" data-open-form="${transitions.length > 0 ? (openForm ?? '') : ''}">
  <main>
    <header>
      <div class="eyebrow">${escapeHtml(details.key)} · ${escapeHtml(fields.issuetype.name)}${fields.priority ? ` · ${escapeHtml(fields.priority.name)}` : ''}</div>
      <h1>${escapeHtml(fields.summary)}</h1>
      <div class="badges"><span class="status">${escapeHtml(fields.status.name)}</span></div>
      ${renderHierarchy(details)}
      <dl class="meta">${renderMeta(details)}</dl>
      <div class="toolbar">
        <button type="button" class="link" data-action="open">Открыть в браузере</button>
        <button type="button" class="link" data-action="branch">Создать ветку</button>
        <button type="button" class="link" data-action="refresh">Обновить</button>
      </div>
    </header>

    <section>
      <h2>Описание</h2>
      ${description ? `<div class="rendered">${description}</div>` : '<p class="empty">Описание отсутствует</p>'}
    </section>

    ${renderSubtasks(details)}
    ${renderLinks(details)}
    ${renderAttachments(fields.attachment ?? [])}
    ${renderComments(details, baseUrl, currentUser)}
    ${renderWorklogs(details, currentUser)}
  </main>

  <footer>
    <div class="flash" id="flash" ${flash ? '' : 'hidden'}>${flash ? escapeHtml(flash) : ''}</div>
    <div class="error" id="error" hidden></div>

    <form class="form" id="form-comment" data-form="comment" hidden>
      <label>Комментарий<textarea name="body" rows="5" required data-preview-source></textarea></label>
      <div class="form__options">
        <label class="check"><input type="checkbox" name="markdown" ${markdownDefault ? 'checked' : ''}> Markdown → разметка Jira</label>
        <button type="button" class="link" data-toggle-preview>Предпросмотр</button>
      </div>
      <div class="preview" data-preview hidden>
        <div class="rendered" data-preview-body></div>
        <details><summary>Разметка, которая уйдёт в Jira</summary><pre data-preview-wiki></pre></details>
      </div>
      <div class="form__actions"><button type="submit">Отправить</button><button type="button" class="secondary" data-cancel>Отмена</button></div>
    </form>

    <form class="form" id="form-worklog" data-form="worklog" hidden>
      <div class="form__row">
        <label>Время<input name="timeSpent" type="text" placeholder="1h 30m" required autocomplete="off"></label>
        <label>Начало<input name="started" type="datetime-local" required></label>
      </div>
      <label>Комментарий (необязательно)<textarea name="comment" rows="3"></textarea></label>
      <div class="form__actions"><button type="submit">Записать</button><button type="button" class="secondary" data-cancel>Отмена</button></div>
    </form>

    <form class="form" id="form-transition" data-form="transition" hidden>
      ${
        transitions.length > 0
          ? `<label>Новый статус<select name="transition">${transitionOptions}</select></label>
      <div id="transition-fields"></div>
      <div class="form__actions"><button type="submit">Сменить статус</button><button type="button" class="secondary" data-cancel>Отмена</button></div>`
          : '<p class="empty">Нет доступных переходов</p><div class="form__actions"><button type="button" class="secondary" data-cancel>Закрыть</button></div>'
      }
    </form>

    <div class="buttons">
      <button type="button" data-open-form="comment">Комментарий</button>
      <button type="button" data-open-form="worklog">Ворклог</button>
      <button type="button" data-open-form="transition">Статус: ${escapeHtml(fields.status.name)}</button>
    </div>
  </footer>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
}
