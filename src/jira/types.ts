export interface IJiraUser {
  name: string
  displayName: string
}

export type TSprintState = 'active' | 'future' | 'closed'

export interface IJiraSprint {
  id: number
  name: string
  state: TSprintState
}

export interface IJiraProject {
  key: string
  name: string
}

export interface IJiraStatus {
  id: string
  name: string
  statusCategory: { key: string }
}

export interface IJiraIssue {
  key: string
  fields: {
    summary: string
    status: IJiraStatus
    issuetype: { name: string; subtask: boolean }
    priority?: { name: string }
    assignee?: IJiraUser | null
  }
  /** Спринты задачи: Jira отдаёт их в поиске строками, мы разбираем их в объекты. */
  sprints: IJiraSprint[]
}

export interface IJiraSearchResult {
  startAt: number
  total: number
  issues: IJiraIssue[]
}

export interface IJiraTransitionField {
  required: boolean
  hasDefaultValue?: boolean
  name: string
  allowedValues?: Array<{ id: string; name?: string; value?: string }>
}

export interface IJiraTransition {
  id: string
  name: string
  to: IJiraStatus
  fields?: Record<string, IJiraTransitionField>
}

export interface IJiraProjectStatusGroup {
  statuses: IJiraStatus[]
}

export interface IJiraComment {
  id: string
  author: IJiraUser
  body: string
  created: string
  updated?: string
}

export interface IJiraWorklog {
  id: string
  author: IJiraUser
  timeSpent: string
  started: string
  comment?: string
}

export interface IJiraIssueRef {
  key: string
  fields: {
    summary: string
    status: IJiraStatus
    issuetype: { name: string; subtask: boolean }
  }
}

export interface IJiraIssueLink {
  id: string
  type: { name: string; inward: string; outward: string }
  inwardIssue?: IJiraIssueRef
  outwardIssue?: IJiraIssueRef
}

export interface IJiraAttachment {
  id: string
  filename: string
  size: number
  mimeType?: string
  created: string
  content: string
  author?: IJiraUser
}

export interface IJiraIssueDetails {
  key: string
  fields: {
    summary: string
    description?: string | null
    status: IJiraStatus
    issuetype: { name: string; subtask: boolean }
    priority?: { name: string }
    assignee?: IJiraUser | null
    reporter?: IJiraUser | null
    labels: string[]
    created: string
    updated: string
    comment: { total: number; comments: IJiraComment[] }
    worklog: { total: number; worklogs: IJiraWorklog[] }
    timetracking?: { originalEstimate?: string; remainingEstimate?: string; timeSpent?: string }
    parent?: IJiraIssueRef
    subtasks?: IJiraIssueRef[]
    issuelinks?: IJiraIssueLink[]
    attachment?: IJiraAttachment[]
  }
  /** Ключ эпика (поле Epic Link) — у обычных задач; у подзадач родитель лежит в `parent`. */
  epicKey?: string
  sprints: IJiraSprint[]
  renderedFields: {
    description?: string | null
    comment?: { comments: Array<{ id: string; body: string }> }
  }
}

export interface IWorklogInput {
  timeSpent: string
  started: string
  comment?: string
}
