import * as vscode from 'vscode'

import { getStatusCategoryOrder, type JiraApi, type TSprintFilter } from '../jira/api'
import { getBaseUrl } from '../jira/client'
import type { IJiraIssue, IJiraSprint } from '../jira/types'
import type { JiraState } from '../state'
import { GroupExpansion } from './groupExpansion'

export class StatusGroupNode {
  constructor(
    readonly id: string,
    readonly title: string,
    readonly issues: IJiraIssue[],
  ) {}
}

export class IssueNode {
  constructor(readonly issue: IJiraIssue) {}

  get key(): string {
    return this.issue.key
  }
}

export type TJiraTreeNode = StatusGroupNode | IssueNode

export class IssuesTreeProvider implements vscode.TreeDataProvider<TJiraTreeNode> {
  private readonly emitter = new vscode.EventEmitter<TJiraTreeNode | undefined>()
  readonly onDidChangeTreeData = this.emitter.event

  private treeView?: vscode.TreeView<TJiraTreeNode>
  private groups: StatusGroupNode[] = []
  private readonly expansion = new GroupExpansion()
  /** Следующая перерисовка берёт уже загруженные задачи, без запроса к Jira. */
  private reuseLoaded = false

  constructor(
    private readonly api: JiraApi,
    private readonly state: JiraState,
    private readonly hasToken: () => Thenable<boolean>,
  ) {}

  attach(treeView: vscode.TreeView<TJiraTreeNode>): vscode.Disposable {
    this.treeView = treeView
    this.syncContext()

    return vscode.Disposable.from(
      treeView.onDidExpandElement(({ element }) => {
        if (element instanceof StatusGroupNode) {
          this.expansion.markExpanded(element.id)
          this.syncContext()
        }
      }),
      treeView.onDidCollapseElement(({ element }) => {
        if (element instanceof StatusGroupNode) {
          this.expansion.markCollapsed(element.id)
          this.syncContext()
        }
      }),
    )
  }

  refresh(): void {
    this.emitter.fire(undefined)
  }

  /** Разворачивает или сворачивает все группы; задачи заново не запрашиваются. */
  setAllExpanded(expanded: boolean): void {
    this.expansion.setAll(
      expanded,
      this.groups.map((group) => group.id),
    )
    this.syncContext()
    this.reuseLoaded = true
    this.emitter.fire(undefined)
  }

  private syncContext(): void {
    void vscode.commands.executeCommand('setContext', 'jira.anyExpanded', this.expansion.anyExpanded)
  }

  getTreeItem(node: TJiraTreeNode): vscode.TreeItem {
    return node instanceof StatusGroupNode ? this.createGroupItem(node) : this.createIssueItem(node)
  }

  async getChildren(node?: TJiraTreeNode): Promise<TJiraTreeNode[]> {
    if (node instanceof StatusGroupNode) {
      return node.issues.map((issue) => new IssueNode(issue))
    }
    if (node) {
      return []
    }
    return this.loadGroups()
  }

  private async loadGroups(): Promise<StatusGroupNode[]> {
    if (this.reuseLoaded) {
      this.reuseLoaded = false
      return this.groups
    }

    this.setHeader(undefined, undefined)
    this.groups = []

    const projectKey = this.state.projectKey
    if (!projectKey || !(await this.hasToken())) {
      return []
    }

    const limit = vscode.workspace.getConfiguration('jira').get<number>('maxIssues', 200)

    try {
      const issues = await this.api.searchIssues(
        {
          projectKey,
          onlyMine: this.state.onlyMine,
          statuses: this.state.statuses,
          sprint: this.state.sprint,
        },
        limit,
      )

      this.setHeader(this.buildDescription(projectKey), issues.length === 0 ? 'Задач не найдено.' : undefined)
      this.groups = this.state.groupBy === 'sprint' ? this.groupBySprint(issues) : this.groupByStatus(issues)
      this.expansion.reconcile(this.groups.map((group) => group.id))
      this.syncContext()
      return this.groups
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.setHeader(this.buildDescription(projectKey), `Не удалось загрузить задачи. ${message}`)
      return []
    }
  }

  private groupByStatus(issues: IJiraIssue[]): StatusGroupNode[] {
    const groups = new Map<string, IJiraIssue[]>()
    for (const issue of issues) {
      const name = issue.fields.status.name
      groups.set(name, [...(groups.get(name) ?? []), issue])
    }

    return [...groups.entries()]
      .sort(
        ([, a], [, b]) =>
          getStatusCategoryOrder(a[0].fields.status) - getStatusCategoryOrder(b[0].fields.status),
      )
      .map(([name, items]) => new StatusGroupNode(`status:${name}`, name, items))
  }

  /** Задача могла побывать в нескольких спринтах: группируем по актуальному (активному, иначе последнему). */
  private groupBySprint(issues: IJiraIssue[]): StatusGroupNode[] {
    const SPRINT_ORDER = { active: 0, future: 1, closed: 2 } as const
    const sprints = new Map<number, IJiraSprint>()
    const groups = new Map<number | 'none', IJiraIssue[]>()

    for (const issue of issues) {
      const current = [...issue.sprints].sort(
        (a, b) => SPRINT_ORDER[a.state] - SPRINT_ORDER[b.state] || b.id - a.id,
      )[0]
      const id = current?.id ?? 'none'
      if (current) {
        sprints.set(current.id, current)
      }
      groups.set(id, [...(groups.get(id) ?? []), issue])
    }

    return [...groups.entries()]
      .sort(([a], [b]) => {
        if (a === 'none' || b === 'none') {
          return a === 'none' ? 1 : -1
        }
        const [first, second] = [sprints.get(a), sprints.get(b)]
        return (
          SPRINT_ORDER[first?.state ?? 'closed'] - SPRINT_ORDER[second?.state ?? 'closed'] || b - a
        )
      })
      .map(([id, items]) => {
        const sprint = id === 'none' ? undefined : sprints.get(id)
        const label = sprint ? `${sprint.name}${sprint.state === 'active' ? ' · активный' : ''}` : 'Без спринта'
        return new StatusGroupNode(`sprint:${id}`, label, items)
      })
  }

  private buildDescription(projectKey: string): string {
    const scope = this.state.onlyMine ? 'мои' : 'все'
    const statuses = this.state.statuses.length > 0 ? ` · ${this.state.statuses.join(', ')}` : ''
    const sprint = describeSprintFilter(this.state.sprint)
    return `${projectKey} · ${scope}${statuses}${sprint ? ` · ${sprint}` : ''}`
  }

  private setHeader(description: string | undefined, message: string | undefined): void {
    if (!this.treeView) {
      return
    }
    this.treeView.description = description
    this.treeView.message = message
  }

  private createGroupItem(node: StatusGroupNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.title,
      this.expansion.isExpandedByDefault
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
    )
    item.id = this.expansion.itemId(node.id)
    item.description = String(node.issues.length)
    item.contextValue = 'statusGroup'
    return item
  }

  private createIssueItem(node: IssueNode): vscode.TreeItem {
    const { key, fields } = node.issue

    const item = new vscode.TreeItem(`${key}  ${fields.summary}`, vscode.TreeItemCollapsibleState.None)
    item.id = key
    item.contextValue = 'issue'
    // при группировке по спринту статус уже не виден из заголовка группы — показываем в описании
    const status = this.state.groupBy === 'sprint' ? fields.status.name : undefined
    item.description = [status, fields.issuetype.name, fields.priority?.name].filter(Boolean).join(' · ')
    item.iconPath = new vscode.ThemeIcon(fields.issuetype.subtask ? 'git-commit' : 'issues')
    item.tooltip = this.createTooltip(node.issue)
    item.command = { command: 'jira.openIssue', title: 'Открыть задачу', arguments: [node] }
    return item
  }

  private createTooltip(issue: IJiraIssue): vscode.MarkdownString {
    const { fields } = issue
    const assignee = fields.assignee?.displayName ?? 'не назначен'

    const tooltip = new vscode.MarkdownString()
    tooltip.appendMarkdown(`**${issue.key}** — ${escapeMarkdown(fields.summary)}\n\n`)
    tooltip.appendMarkdown(`Статус: ${fields.status.name}  \nТип: ${fields.issuetype.name}  \n`)
    tooltip.appendMarkdown(`Исполнитель: ${escapeMarkdown(assignee)}`)
    return tooltip
  }
}

export function describeSprintFilter(filter: TSprintFilter): string | undefined {
  switch (filter.kind) {
    case 'open':
      return 'активные спринты'
    case 'none':
      return 'без спринта'
    case 'sprint':
      return filter.name
    default:
      return undefined
  }
}

const escapeMarkdown = (text: string): string => text.replace(/([\\`*_{}[\]()#+\-.!|<>])/g, '\\$1')

export const getIssueUrl = (key: string): string => `${getBaseUrl()}/browse/${encodeURIComponent(key)}`
