import * as vscode from 'vscode'

import type { TokenStore } from '../auth/secrets'
import type { JiraApi } from '../jira/api'
import type { JiraState } from '../state'
import type { IssuePanelManager } from '../views/issuePanel'
import type { IssuesTreeProvider } from '../views/issuesTree'

export interface ICommandContext {
  api: JiraApi
  tokens: TokenStore
  state: JiraState
  tree: IssuesTreeProvider
  panels: IssuePanelManager
  updateContextKeys: () => Promise<void>
}

/** Оборачивает команду: любая ошибка показывается пользователю, а не теряется в консоли. */
export function safeCommand<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<void>,
): (...args: TArgs) => Promise<void> {
  return async (...args: TArgs) => {
    try {
      await handler(...args)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      void vscode.window.showErrorMessage(message)
    }
  }
}
