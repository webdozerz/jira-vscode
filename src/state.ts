import * as vscode from 'vscode'

import type { TSprintFilter } from './jira/api'

export type TGroupBy = 'status' | 'sprint'

const KEYS = {
  projectKey: 'jira.projectKey',
  projectName: 'jira.projectName',
  onlyMine: 'jira.onlyMine',
  statuses: 'jira.statuses',
  sprint: 'jira.sprint',
  groupBy: 'jira.groupBy',
} as const

/** Выбранный проект и фильтры; хранится в globalState и переживает перезапуск. */
export class JiraState {
  private readonly emitter = new vscode.EventEmitter<void>()
  readonly onDidChange = this.emitter.event

  constructor(private readonly memento: vscode.Memento) {}

  get projectKey(): string | undefined {
    return this.memento.get<string>(KEYS.projectKey)
  }

  get projectName(): string | undefined {
    return this.memento.get<string>(KEYS.projectName)
  }

  get onlyMine(): boolean {
    return this.memento.get<boolean>(KEYS.onlyMine, true)
  }

  get statuses(): string[] {
    return this.memento.get<string[]>(KEYS.statuses, [])
  }

  get sprint(): TSprintFilter {
    return this.memento.get<TSprintFilter>(KEYS.sprint, { kind: 'any' })
  }

  get groupBy(): TGroupBy {
    return this.memento.get<TGroupBy>(KEYS.groupBy, 'status')
  }

  async setSprint(sprint: TSprintFilter): Promise<void> {
    await this.memento.update(KEYS.sprint, sprint)
    this.emitter.fire()
  }

  async setGroupBy(groupBy: TGroupBy): Promise<void> {
    await this.memento.update(KEYS.groupBy, groupBy)
    this.emitter.fire()
  }

  async setProject(key: string, name: string): Promise<void> {
    await this.memento.update(KEYS.projectKey, key)
    await this.memento.update(KEYS.projectName, name)
    // статусы и спринты привязаны к проекту — старые фильтры теряют смысл
    await this.memento.update(KEYS.statuses, [])
    await this.memento.update(KEYS.sprint, { kind: 'any' })
    this.emitter.fire()
  }

  async setOnlyMine(value: boolean): Promise<void> {
    await this.memento.update(KEYS.onlyMine, value)
    this.emitter.fire()
  }

  async setStatuses(statuses: string[]): Promise<void> {
    await this.memento.update(KEYS.statuses, statuses)
    this.emitter.fire()
  }
}
