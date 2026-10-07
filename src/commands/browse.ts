import * as vscode from 'vscode'

import type { TSprintFilter } from '../jira/api'
import { getIssueUrl, IssueNode } from '../views/issuesTree'
import { safeCommand, type ICommandContext } from './context'

interface ISprintPickItem extends vscode.QuickPickItem {
  filter: TSprintFilter
}

interface IProjectPickItem extends vscode.QuickPickItem {
  projectKey: string
  projectName: string
}

export function registerBrowseCommands(ctx: ICommandContext): vscode.Disposable[] {
  const selectProject = safeCommand(async () => {
    const projects = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Jira: загрузка проектов' },
      () => ctx.api.getProjects(),
    )

    const items: IProjectPickItem[] = projects.map((project) => ({
      label: project.name,
      description: project.key,
      picked: project.key === ctx.state.projectKey,
      projectKey: project.key,
      projectName: project.name,
    }))

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Проект Jira',
      placeHolder: 'Выберите проект',
      matchOnDescription: true,
    })
    if (!picked) {
      return
    }

    await ctx.state.setProject(picked.projectKey, picked.projectName)
    await ctx.updateContextKeys()
    ctx.tree.refresh()
  })

  const filterStatuses = safeCommand(async () => {
    const projectKey = ctx.state.projectKey
    if (!projectKey) {
      return
    }

    const statuses = await ctx.api.getProjectStatuses(projectKey)
    const selected = new Set(ctx.state.statuses)

    const picked = await vscode.window.showQuickPick(
      statuses.map((status) => ({ label: status.name, picked: selected.has(status.name) })),
      {
        title: 'Фильтр по статусам',
        placeHolder: 'Отметьте статусы (пусто — показывать все)',
        canPickMany: true,
      },
    )
    if (!picked) {
      return
    }

    await ctx.state.setStatuses(picked.map((item) => item.label))
    ctx.tree.refresh()
  })

  const filterSprint = safeCommand(async () => {
    const projectKey = ctx.state.projectKey
    if (!projectKey) {
      return
    }

    const sprints = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Jira: загрузка спринтов' },
      () => ctx.api.getProjectSprints(projectKey),
    )

    const current = ctx.state.sprint
    const isCurrent = (filter: TSprintFilter): boolean =>
      filter.kind === current.kind && (filter.kind !== 'sprint' || (current.kind === 'sprint' && current.id === filter.id))

    const items: Array<ISprintPickItem | vscode.QuickPickItem> = [
      { label: 'Любой спринт', description: 'без фильтра', filter: { kind: 'any' } },
      { label: 'Активные спринты', filter: { kind: 'open' } },
      { label: 'Без спринта', description: 'бэклог', filter: { kind: 'none' } },
      { label: 'Конкретный спринт', kind: vscode.QuickPickItemKind.Separator },
      ...sprints.map(
        (sprint): ISprintPickItem => ({
          label: sprint.name,
          description: `${sprint.state === 'active' ? 'активный' : 'запланирован'} · ${sprint.boardName}`,
          filter: { kind: 'sprint', id: sprint.id, name: sprint.name },
        }),
      ),
    ]
    for (const item of items) {
      if ('filter' in item && isCurrent(item.filter)) {
        item.label = `$(check) ${item.label}`
      }
    }

    const picked = await vscode.window.showQuickPick(items, { title: 'Фильтр по спринту', matchOnDescription: true })
    if (picked && 'filter' in picked) {
      await ctx.state.setSprint(picked.filter)
      ctx.tree.refresh()
    }
  })

  const toggleGroupBy = safeCommand(async () => {
    const next = ctx.state.groupBy === 'status' ? 'sprint' : 'status'
    await ctx.state.setGroupBy(next)
    ctx.tree.refresh()
    void vscode.window.setStatusBarMessage(`Jira: группировка по ${next === 'sprint' ? 'спринтам' : 'статусам'}`, 3000)
  })

  const toggleScope = safeCommand(async () => {
    await ctx.state.setOnlyMine(!ctx.state.onlyMine)
    ctx.tree.refresh()
  })

  const refresh = safeCommand(async () => ctx.tree.refresh())

  const expandAll = safeCommand(async () => ctx.tree.setAllExpanded(true))

  const collapseAll = safeCommand(async () => ctx.tree.setAllExpanded(false))

  const openIssue = safeCommand(async (node?: IssueNode) => {
    if (node instanceof IssueNode) {
      await ctx.panels.open(node.key)
    }
  })

  const openInBrowser = safeCommand(async (node?: IssueNode) => {
    if (node instanceof IssueNode) {
      await vscode.env.openExternal(vscode.Uri.parse(getIssueUrl(node.key)))
    }
  })

  const copyKey = safeCommand(async (node?: IssueNode) => {
    if (node instanceof IssueNode) {
      await vscode.env.clipboard.writeText(node.key)
      void vscode.window.setStatusBarMessage(`Скопировано: ${node.key}`, 2000)
    }
  })

  return [
    vscode.commands.registerCommand('jira.selectProject', selectProject),
    vscode.commands.registerCommand('jira.filterStatuses', filterStatuses),
    vscode.commands.registerCommand('jira.filterSprint', filterSprint),
    vscode.commands.registerCommand('jira.toggleGroupBy', toggleGroupBy),
    vscode.commands.registerCommand('jira.toggleScope', toggleScope),
    vscode.commands.registerCommand('jira.refresh', refresh),
    vscode.commands.registerCommand('jira.expandAll', expandAll),
    vscode.commands.registerCommand('jira.collapseAll', collapseAll),
    vscode.commands.registerCommand('jira.openIssue', openIssue),
    vscode.commands.registerCommand('jira.openInBrowser', openInBrowser),
    vscode.commands.registerCommand('jira.copyKey', copyKey),
  ]
}
