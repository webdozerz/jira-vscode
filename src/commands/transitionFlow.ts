import * as vscode from 'vscode'

import type { IJiraTransition } from '../jira/types'
import { getIssueUrl } from '../views/issuesTree'
import type { ICommandContext } from './context'

interface ITransitionPickItem extends vscode.QuickPickItem {
  transition: IJiraTransition
}

/**
 * Собирает обязательные поля перехода (например, resolution).
 * Возвращает undefined, если пользователь отменил или поле не поддерживается.
 */
export async function collectRequiredFields(
  issueKey: string,
  transition: IJiraTransition,
): Promise<Record<string, unknown> | undefined> {
  const result: Record<string, unknown> = {}

  for (const [fieldId, field] of Object.entries(transition.fields ?? {})) {
    if (!field.required || field.hasDefaultValue) {
      continue
    }

    if (!field.allowedValues || field.allowedValues.length === 0) {
      const action = await vscode.window.showWarningMessage(
        `Для перехода в «${transition.to.name}» нужно заполнить поле «${field.name}», это пока не поддерживается.`,
        'Открыть в браузере',
      )
      if (action) {
        await vscode.env.openExternal(vscode.Uri.parse(getIssueUrl(issueKey)))
      }
      return undefined
    }

    const picked = await vscode.window.showQuickPick(
      field.allowedValues.map((value) => ({ label: value.name ?? value.value ?? value.id, id: value.id })),
      { title: field.name, placeHolder: `Обязательное поле «${field.name}»` },
    )
    if (!picked) {
      return undefined
    }

    result[fieldId] = { id: picked.id }
  }

  return result
}

const isChainEnabled = (): boolean => vscode.workspace.getConfiguration('jira').get<boolean>('chainTransitions', true)

/**
 * Смена статуса через выбор из списка. Если включена настройка `jira.chainTransitions`,
 * после перехода сразу предлагаются следующие — Esc заканчивает цепочку.
 */
export async function runTransitionFlow(
  ctx: ICommandContext,
  issueKey: string,
  currentStatus: string,
): Promise<void> {
  let status = currentStatus

  for (let step = 0; ; step++) {
    const transitions = await ctx.api.getTransitions(issueKey)
    if (transitions.length === 0) {
      if (step === 0) {
        void vscode.window.showWarningMessage(`${issueKey}: нет доступных переходов`)
      }
      return
    }

    const items: ITransitionPickItem[] = transitions.map((transition) => ({
      label: transition.to.name,
      description: transition.name === transition.to.name ? undefined : transition.name,
      transition,
    }))

    const picked = await vscode.window.showQuickPick(items, {
      title: `${issueKey}: сейчас «${status}»`,
      placeHolder: step === 0 ? 'Новый статус' : 'Следующий статус (Esc — закончить)',
    })
    if (!picked) {
      return
    }

    const fields = await collectRequiredFields(issueKey, picked.transition)
    if (!fields) {
      return
    }

    await ctx.api.doTransition(issueKey, picked.transition.id, fields)
    status = picked.transition.to.name
    void vscode.window.setStatusBarMessage(`${issueKey}: статус «${status}»`, 4000)
    ctx.tree.refresh()
    await ctx.panels.refreshIfOpen(issueKey, `Статус изменён: ${status}`)

    if (!isChainEnabled()) {
      return
    }
  }
}

export type TMoveResult = 'moved' | 'already' | 'unavailable' | 'cancelled'

/** Переводит задачу в статус по имени, если для этого есть прямой переход. */
export async function moveToStatus(
  ctx: ICommandContext,
  issueKey: string,
  targetStatus: string,
  currentStatus: string,
): Promise<TMoveResult> {
  const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()
  if (same(currentStatus, targetStatus)) {
    return 'already'
  }

  const transitions = await ctx.api.getTransitions(issueKey)
  const transition = transitions.find((item) => same(item.to.name, targetStatus))
  if (!transition) {
    return 'unavailable'
  }

  const fields = await collectRequiredFields(issueKey, transition)
  if (!fields) {
    return 'cancelled'
  }

  await ctx.api.doTransition(issueKey, transition.id, fields)
  ctx.tree.refresh()
  await ctx.panels.refreshIfOpen(issueKey, `Статус изменён: ${transition.to.name}`)
  return 'moved'
}
