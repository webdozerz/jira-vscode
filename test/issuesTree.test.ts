import { beforeEach, describe, expect, it, vi } from 'vitest'

const contextCalls: Array<[string, boolean]> = []

vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners: Array<(value: T) => void> = []
    event = (listener: (value: T) => void) => {
      this.listeners.push(listener)
      return { dispose: () => undefined }
    }
    fire(value: T) {
      this.listeners.forEach((listener) => listener(value))
    }
  }
  class TreeItem {
    id?: string
    description?: string
    contextValue?: string
    iconPath?: unknown
    tooltip?: unknown
    command?: unknown
    constructor(
      public label: string,
      public collapsibleState: number,
    ) {}
  }
  class MarkdownString {
    appendMarkdown() {
      return this
    }
  }
  class ThemeIcon {
    constructor(public id: string) {}
  }
  return {
    EventEmitter,
    TreeItem,
    MarkdownString,
    ThemeIcon,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    Disposable: { from: (...items: unknown[]) => ({ dispose: () => items }) },
    workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
    commands: {
      executeCommand: (command: string, key: string, value: boolean) => {
        if (command === 'setContext') {
          contextCalls.push([key, value])
        }
        return Promise.resolve()
      },
    },
  }
})

import { IssuesTreeProvider, StatusGroupNode } from '../src/views/issuesTree'

const status = (name: string) => ({ id: name, name, statusCategory: { key: 'indeterminate' } })
const issue = (key: string, statusName: string) => ({
  key,
  sprints: [],
  fields: { summary: key, status: status(statusName), issuetype: { name: 'Task', subtask: false } },
})

function createProvider() {
  const searchIssues = vi.fn(async () => [issue('SE-1', 'To do'), issue('SE-2', 'In progress'), issue('SE-3', 'In progress')])
  const api = { searchIssues } as never
  const state = { projectKey: 'SE', onlyMine: true, statuses: [], sprint: { kind: 'any' }, groupBy: 'status' } as never
  const provider = new IssuesTreeProvider(api, state, async () => true)
  const listeners: Record<string, (event: { element: unknown }) => void> = {}
  provider.attach({
    onDidExpandElement: (listener: (event: { element: unknown }) => void) => ((listeners.expand = listener), { dispose: () => undefined }),
    onDidCollapseElement: (listener: (event: { element: unknown }) => void) => ((listeners.collapse = listener), { dispose: () => undefined }),
  } as never)
  return { provider, searchIssues, listeners }
}

const lastAnyExpanded = () => [...contextCalls].reverse().find(([key]) => key === 'jira.anyExpanded')?.[1]

describe('IssuesTreeProvider expand / collapse', () => {
  beforeEach(() => {
    contextCalls.length = 0
  })

  it('starts expanded and exposes it through the context key', async () => {
    const { provider } = createProvider()
    const groups = (await provider.getChildren()) as StatusGroupNode[]

    expect(groups.map((group) => group.title)).toEqual(['To do', 'In progress'])
    expect(provider.getTreeItem(groups[0]).collapsibleState).toBe(2)
    expect(lastAnyExpanded()).toBe(true)
  })

  it('collapses all groups without asking Jira again, then expands them back', async () => {
    const { provider, searchIssues } = createProvider()
    const first = (await provider.getChildren()) as StatusGroupNode[]
    const firstId = provider.getTreeItem(first[0]).id

    provider.setAllExpanded(false)
    const collapsed = (await provider.getChildren()) as StatusGroupNode[]
    expect(searchIssues).toHaveBeenCalledTimes(1)
    expect(provider.getTreeItem(collapsed[0]).collapsibleState).toBe(1)
    expect(provider.getTreeItem(collapsed[0]).id).not.toBe(firstId)
    expect(lastAnyExpanded()).toBe(false)

    provider.setAllExpanded(true)
    const expanded = (await provider.getChildren()) as StatusGroupNode[]
    expect(searchIssues).toHaveBeenCalledTimes(1)
    expect(provider.getTreeItem(expanded[0]).collapsibleState).toBe(2)
    expect(lastAnyExpanded()).toBe(true)
  })

  it('a regular refresh reloads issues but keeps the collapsed state', async () => {
    const { provider, searchIssues } = createProvider()
    await provider.getChildren()
    provider.setAllExpanded(false)
    await provider.getChildren()

    provider.refresh()
    const reloaded = (await provider.getChildren()) as StatusGroupNode[]
    expect(searchIssues).toHaveBeenCalledTimes(2)
    expect(provider.getTreeItem(reloaded[0]).collapsibleState).toBe(1)
    expect(lastAnyExpanded()).toBe(false)
  })

  it('flips the icon state when the user collapses every group by hand', async () => {
    const { provider, listeners } = createProvider()
    const groups = (await provider.getChildren()) as StatusGroupNode[]

    listeners.collapse({ element: groups[0] })
    expect(lastAnyExpanded()).toBe(true)
    listeners.collapse({ element: groups[1] })
    expect(lastAnyExpanded()).toBe(false)
    listeners.expand({ element: groups[1] })
    expect(lastAnyExpanded()).toBe(true)
  })
})
