import type { JiraClient } from './client'
import type {
  IJiraIssue,
  IJiraIssueDetails,
  IJiraProject,
  IJiraProjectStatusGroup,
  IJiraSearchResult,
  IJiraSprint,
  IJiraStatus,
  IJiraTransition,
  IJiraUser,
  IJiraWorklog,
  IWorklogInput,
  TSprintState,
} from './types'

const PAGE_SIZE = 100

export type TSprintFilter =
  | { kind: 'any' }
  | { kind: 'open' }
  | { kind: 'none' }
  | { kind: 'sprint'; id: number; name: string }

export interface IIssueFilter {
  projectKey: string
  onlyMine: boolean
  statuses: string[]
  sprint: TSprintFilter
}

export interface ISprintOption extends IJiraSprint {
  boardName: string
}

const STATUS_CATEGORY_ORDER: Record<string, number> = { new: 0, indeterminate: 1, done: 2 }

export const getStatusCategoryOrder = (status: IJiraStatus): number =>
  STATUS_CATEGORY_ORDER[status.statusCategory.key] ?? 1

const quoteJql = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export function buildJql(filter: IIssueFilter): string {
  const clauses = [`project = ${quoteJql(filter.projectKey)}`]

  if (filter.onlyMine) {
    clauses.push('assignee = currentUser()')
  }
  if (filter.statuses.length > 0) {
    clauses.push(`status in (${filter.statuses.map(quoteJql).join(', ')})`)
  }

  switch (filter.sprint.kind) {
    case 'open':
      clauses.push('sprint in openSprints()')
      break
    case 'none':
      clauses.push('sprint is EMPTY')
      break
    case 'sprint':
      clauses.push(`sprint = ${Math.trunc(filter.sprint.id)}`)
      break
  }

  return `${clauses.join(' AND ')} ORDER BY updated DESC`
}

/**
 * Поиск отдаёт спринты старым строковым форматом:
 * `com.atlassian...Sprint@77ba[id=177,name=SE Sprint 9'26,rapidViewId=52,...,state=ACTIVE,...]`.
 * Название может содержать запятые, поэтому режем его по соседним полям, а не по запятой.
 */
export function parseSprint(raw: unknown): IJiraSprint | undefined {
  if (typeof raw !== 'string') {
    return undefined
  }

  const id = /[[,]id=(\d+)[,\]]/.exec(raw)?.[1]
  const name = /,name=(.*?),(?:rapidViewId|startDate|endDate|completeDate|activatedDate|sequence|goal|state)=/.exec(
    raw,
  )?.[1]
  const state = /[[,]state=(\w+)/.exec(raw)?.[1]?.toLowerCase()

  if (!id || !name) {
    return undefined
  }

  const known: TSprintState = state === 'active' || state === 'future' || state === 'closed' ? state : 'closed'
  return { id: Number(id), name, state: known }
}

export function parseSprints(raw: unknown): IJiraSprint[] {
  return Array.isArray(raw) ? raw.map(parseSprint).filter((item): item is IJiraSprint => item !== undefined) : []
}

interface ICustomFieldIds {
  epicLink?: string
  sprint?: string
}

export class JiraApi {
  private myself?: Promise<IJiraUser>
  private customFields?: Promise<ICustomFieldIds>

  constructor(private readonly client: JiraClient) {}

  /** Сбрасывает кеш (например, после смены токена: пользователь мог измениться). */
  resetCache(): void {
    this.myself = undefined
    this.customFields = undefined
  }

  getMyself(): Promise<IJiraUser> {
    if (!this.myself) {
      this.myself = this.client.request<IJiraUser>('/rest/api/2/myself')
      this.myself.catch(() => {
        this.myself = undefined
      })
    }
    return this.myself
  }

  /** Идентификаторы полей Epic Link и Sprint отличаются между инсталляциями — ищем по имени. */
  private getCustomFields(): Promise<ICustomFieldIds> {
    if (!this.customFields) {
      this.customFields = this.client
        .request<Array<{ id: string; name: string }>>('/rest/api/2/field')
        .then((fields) => ({
          epicLink: fields.find((field) => field.name === 'Epic Link')?.id,
          sprint: fields.find((field) => field.name === 'Sprint')?.id,
        }))
        // эпики и спринты — дополнение: если список полей недоступен, задачи всё равно должны открываться
        .catch(() => {
          this.customFields = undefined
          return {}
        })
    }
    return this.customFields
  }

  async getProjects(): Promise<IJiraProject[]> {
    const projects = await this.client.request<IJiraProject[]>('/rest/api/2/project')
    return projects
      .map(({ key, name }) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Статусы всех типов задач проекта без дублей, в порядке «к выполнению → в работе → готово». */
  async getProjectStatuses(projectKey: string): Promise<IJiraStatus[]> {
    const groups = await this.client.request<IJiraProjectStatusGroup[]>(
      `/rest/api/2/project/${encodeURIComponent(projectKey)}/statuses`,
    )

    const byName = new Map<string, IJiraStatus>()
    for (const group of groups) {
      for (const status of group.statuses) {
        if (!byName.has(status.name)) {
          byName.set(status.name, status)
        }
      }
    }

    return [...byName.values()].sort(
      (a, b) => getStatusCategoryOrder(a) - getStatusCategoryOrder(b) || a.name.localeCompare(b.name),
    )
  }

  /** Активные и будущие спринты всех досок проекта (Agile API), без дублей. */
  async getProjectSprints(projectKey: string): Promise<ISprintOption[]> {
    const boards = await this.client.request<{ values: Array<{ id: number; name: string }> }>(
      `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&maxResults=50`,
    )

    const lists = await Promise.all(
      boards.values.map(async (board) => {
        try {
          const result = await this.client.request<{ values: IJiraSprint[] }>(
            `/rest/agile/1.0/board/${board.id}/sprint?state=active,future&maxResults=50`,
          )
          return result.values.map((sprint): ISprintOption => ({ ...sprint, boardName: board.name }))
        } catch {
          // у отдельных досок (например, kanban) спринтов нет — это не ошибка
          return []
        }
      }),
    )

    const byId = new Map<number, ISprintOption>()
    for (const sprint of lists.flat()) {
      if (!byId.has(sprint.id)) {
        byId.set(sprint.id, sprint)
      }
    }
    return [...byId.values()].sort((a, b) => (a.state === b.state ? b.id - a.id : a.state === 'active' ? -1 : 1))
  }

  async searchIssues(filter: IIssueFilter, limit: number): Promise<IJiraIssue[]> {
    const jql = buildJql(filter)
    const { sprint: sprintField } = await this.getCustomFields()
    const fields = ['summary', 'status', 'issuetype', 'priority', 'assignee', ...(sprintField ? [sprintField] : [])]

    const issues: IJiraIssue[] = []
    let startAt = 0

    while (issues.length < limit) {
      const maxResults = Math.min(PAGE_SIZE, limit - issues.length)
      const params = new URLSearchParams({
        jql,
        startAt: String(startAt),
        maxResults: String(maxResults),
        fields: fields.join(','),
      })
      const page = await this.client.request<IJiraSearchResult & { issues: Array<IJiraIssue & { fields: Record<string, unknown> }> }>(
        `/rest/api/2/search?${params}`,
      )

      for (const issue of page.issues) {
        issues.push({ ...issue, sprints: sprintField ? parseSprints(issue.fields[sprintField]) : [] })
      }
      startAt += page.issues.length

      if (page.issues.length === 0 || startAt >= page.total) {
        break
      }
    }

    return issues
  }

  async getIssueDetails(issueKey: string): Promise<IJiraIssueDetails> {
    const { epicLink, sprint } = await this.getCustomFields()
    const extra = [epicLink, sprint].filter((id): id is string => Boolean(id))

    const params = new URLSearchParams({
      fields: [
        'summary,description,status,issuetype,priority,assignee,reporter,labels,created,updated',
        'comment,worklog,timetracking,parent,subtasks,issuelinks,attachment',
        ...extra,
      ].join(','),
      expand: 'renderedFields',
    })
    const raw = await this.client.request<IJiraIssueDetails & { fields: Record<string, unknown> }>(
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}?${params}`,
    )

    const details: IJiraIssueDetails = {
      ...raw,
      epicKey: epicLink && typeof raw.fields[epicLink] === 'string' ? (raw.fields[epicLink] as string) : undefined,
      sprints: sprint ? parseSprints(raw.fields[sprint]) : [],
    }

    // в карточке задачи Jira отдаёт не больше 20 ворклогов — догружаем остальные
    if (details.fields.worklog.total > details.fields.worklog.worklogs.length) {
      const all = await this.client.request<{ worklogs: IJiraWorklog[] }>(
        `/rest/api/2/issue/${encodeURIComponent(issueKey)}/worklog`,
      )
      details.fields.worklog = { total: all.worklogs.length, worklogs: all.worklogs }
    }

    return details
  }

  async addComment(issueKey: string, body: string): Promise<void> {
    await this.client.request(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`, {
      method: 'POST',
      body: { body },
    })
  }

  async updateComment(issueKey: string, commentId: string, body: string): Promise<void> {
    await this.client.request(
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment/${encodeURIComponent(commentId)}`,
      { method: 'PUT', body: { body } },
    )
  }

  async deleteComment(issueKey: string, commentId: string): Promise<void> {
    await this.client.request(
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment/${encodeURIComponent(commentId)}`,
      { method: 'DELETE' },
    )
  }

  async addWorklog(issueKey: string, worklog: IWorklogInput): Promise<void> {
    await this.client.request(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/worklog`, {
      method: 'POST',
      body: worklog,
    })
  }

  async updateWorklog(issueKey: string, worklogId: string, worklog: IWorklogInput): Promise<void> {
    await this.client.request(
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}/worklog/${encodeURIComponent(worklogId)}`,
      { method: 'PUT', body: worklog },
    )
  }

  async deleteWorklog(issueKey: string, worklogId: string): Promise<void> {
    await this.client.request(
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}/worklog/${encodeURIComponent(worklogId)}`,
      { method: 'DELETE' },
    )
  }

  async getTransitions(issueKey: string): Promise<IJiraTransition[]> {
    const result = await this.client.request<{ transitions: IJiraTransition[] }>(
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions?expand=transitions.fields`,
    )
    return result.transitions
  }

  async doTransition(issueKey: string, transitionId: string, fields?: Record<string, unknown>): Promise<void> {
    await this.client.request(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`, {
      method: 'POST',
      body: { transition: { id: transitionId }, ...(fields && Object.keys(fields).length > 0 ? { fields } : {}) },
    })
  }

  /** Рендерит wiki-разметку силами самой Jira — предпросмотр показывает ровно то, что увидят в задаче. */
  renderWiki(markup: string, issueKey: string): Promise<string> {
    return this.client.request<string>('/rest/api/1.0/render', {
      method: 'POST',
      accept: 'html',
      body: { rendererType: 'atlassian-wiki-renderer', unrenderedMarkup: markup, issueKey },
    })
  }

  downloadAttachment(url: string): Promise<Uint8Array> {
    return this.client.download(url)
  }
}
