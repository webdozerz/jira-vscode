import * as vscode from 'vscode'

import { formatJiraDate, parseLocalDateTime, validateTimeSpent } from '../utils/time'
import { IssueNode } from '../views/issuesTree'
import { safeCommand, type ICommandContext } from './context'
import { runTransitionFlow } from './transitionFlow'

type TWorklogStart = 'now' | 'yesterday' | 'custom'

interface IWorklogStartPickItem extends vscode.QuickPickItem {
  start: TWorklogStart
}

const WORKLOG_START_ITEMS: IWorklogStartPickItem[] = [
  { label: 'Сейчас', start: 'now' },
  { label: 'Вчера', description: 'в то же время', start: 'yesterday' },
  { label: 'Указать дату…', start: 'custom' },
]

export function registerIssueCommands(ctx: ICommandContext): vscode.Disposable[] {
  const addComment = safeCommand(async (node?: IssueNode) => {
    if (!(node instanceof IssueNode)) {
      return
    }

    const body = await vscode.window.showInputBox({
      title: `Комментарий к ${node.key}`,
      prompt: node.issue.fields.summary,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : 'Комментарий не может быть пустым'),
    })
    if (!body) {
      return
    }

    await ctx.api.addComment(node.key, body.trim())
    void vscode.window.showInformationMessage(`${node.key}: комментарий добавлен`)
  })

  const addWorklog = safeCommand(async (node?: IssueNode) => {
    if (!(node instanceof IssueNode)) {
      return
    }

    const timeSpent = await vscode.window.showInputBox({
      title: `Ворклог для ${node.key}`,
      prompt: 'Затраченное время, например 1h 30m, 45m, 2d',
      ignoreFocusOut: true,
      validateInput: validateTimeSpent,
    })
    if (!timeSpent) {
      return
    }

    const started = await pickWorklogStart()
    if (!started) {
      return
    }

    const comment = await vscode.window.showInputBox({
      title: `Ворклог для ${node.key}`,
      prompt: 'Комментарий (необязательно, Enter — без комментария)',
      ignoreFocusOut: true,
    })
    if (comment === undefined) {
      return
    }

    await ctx.api.addWorklog(node.key, {
      timeSpent: timeSpent.trim(),
      started: formatJiraDate(started),
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    })
    void vscode.window.showInformationMessage(`${node.key}: записано ${timeSpent.trim()}`)
  })

  const transition = safeCommand(async (node?: IssueNode) => {
    if (node instanceof IssueNode) {
      await runTransitionFlow(ctx, node.key, node.issue.fields.status.name)
    }
  })

  return [
    vscode.commands.registerCommand('jira.addComment', addComment),
    vscode.commands.registerCommand('jira.addWorklog', addWorklog),
    vscode.commands.registerCommand('jira.transition', transition),
  ]
}

async function pickWorklogStart(): Promise<Date | undefined> {
  const picked = await vscode.window.showQuickPick(WORKLOG_START_ITEMS, {
    title: 'Когда выполнялась работа',
  })
  if (!picked) {
    return undefined
  }

  const now = new Date()
  if (picked.start === 'now') {
    return now
  }
  if (picked.start === 'yesterday') {
    now.setDate(now.getDate() - 1)
    return now
  }

  const value = await vscode.window.showInputBox({
    title: 'Дата и время начала',
    prompt: 'Формат: YYYY-MM-DD или YYYY-MM-DD HH:mm (без времени — 09:00)',
    ignoreFocusOut: true,
    validateInput: (input) => (parseLocalDateTime(input) ? undefined : 'Например: 2026-10-06 14:30'),
  })

  return value ? parseLocalDateTime(value) : undefined
}
