import * as vscode from 'vscode'

import { pickRepository } from '../git'
import { buildBranchName, validateBranchName } from '../utils/branch'
import { IssueNode } from '../views/issuesTree'
import { askIssueKey } from './askIssueKey'
import { safeCommand, type ICommandContext } from './context'
import { moveToStatus } from './transitionFlow'

type TMoveMode = 'ask' | 'always' | 'never'

function resolveKey(target: unknown): string | undefined {
  if (typeof target === 'string') {
    return target
  }
  return target instanceof IssueNode ? target.key : undefined
}

export function registerBranchCommands(ctx: ICommandContext): vscode.Disposable[] {
  const createBranch = safeCommand(async (target?: unknown) => {
    const key = resolveKey(target) ?? (await askIssueKey('Создать ветку для задачи'))
    if (!key) {
      return
    }

    const config = vscode.workspace.getConfiguration('jira.branch')
    const details = await ctx.api.getIssueDetails(key)

    const proposed = buildBranchName({
      template: config.get<string>('template', 'feat/{key}'),
      key,
      summary: details.fields.summary,
      maxSlugLength: config.get<number>('maxSlugLength', 40),
    })

    const repository = await pickRepository()
    if (!repository) {
      return
    }

    const input = await vscode.window.showInputBox({
      title: `Ветка для ${key}`,
      prompt: `Репозиторий: ${repository.name}. Enter — создать ветку и переключиться на неё`,
      value: proposed,
      ignoreFocusOut: true,
      validateInput: validateBranchName,
    })
    if (!input) {
      return
    }

    const branch = input.trim()
    if (await repository.hasBranch(branch)) {
      const action = await vscode.window.showWarningMessage(`Ветка «${branch}» уже существует.`, 'Переключиться')
      if (!action) {
        return
      }
      await repository.checkout(branch)
    } else {
      const base = config.get<string>('baseBranch', '').trim()
      await repository.createBranch(branch, base || undefined)
      void vscode.window.setStatusBarMessage(`Ветка «${branch}» создана`, 4000)
    }

    await offerMoveToInProgress(ctx, key, details.fields.status.name, branch)
  })

  const openByKey = safeCommand(async () => {
    const key = await askIssueKey('Открыть задачу Jira')
    if (key) {
      await ctx.panels.open(key)
    }
  })

  return [
    vscode.commands.registerCommand('jira.createBranch', createBranch),
    vscode.commands.registerCommand('jira.openByKey', openByKey),
  ]
}

async function offerMoveToInProgress(
  ctx: ICommandContext,
  key: string,
  currentStatus: string,
  branch: string,
): Promise<void> {
  const config = vscode.workspace.getConfiguration('jira.branch')
  const mode = config.get<TMoveMode>('moveToInProgress', 'ask')
  const target = config.get<string>('inProgressStatus', 'In progress')

  if (mode === 'never' || currentStatus.trim().toLowerCase() === target.trim().toLowerCase()) {
    void vscode.window.showInformationMessage(`Ветка «${branch}» готова`)
    return
  }

  if (mode === 'ask') {
    const answer = await vscode.window.showInformationMessage(
      `Ветка «${branch}» готова. Перевести ${key} в «${target}»?`,
      'Перевести',
      'Не нужно',
    )
    if (answer !== 'Перевести') {
      return
    }
  }

  const result = await moveToStatus(ctx, key, target, currentStatus)
  if (result === 'moved') {
    void vscode.window.showInformationMessage(`${key}: статус «${target}»`)
  } else if (result === 'unavailable') {
    void vscode.window.showWarningMessage(
      `${key}: из статуса «${currentStatus}» нет прямого перехода в «${target}». Смените статус вручную.`,
    )
  }
}
