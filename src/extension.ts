import * as vscode from 'vscode'

import { TokenStore } from './auth/secrets'
import { registerAuthCommands } from './commands/auth'
import { registerBranchCommands } from './commands/branch'
import { registerBrowseCommands } from './commands/browse'
import type { ICommandContext } from './commands/context'
import { registerIssueCommands } from './commands/issue'
import { JiraApi } from './jira/api'
import { JiraClient } from './jira/client'
import { JiraState } from './state'
import { IssuePanelManager } from './views/issuePanel'
import { IssuesTreeProvider } from './views/issuesTree'

export function activate(context: vscode.ExtensionContext): void {
  const tokens = new TokenStore(context.secrets)
  const state = new JiraState(context.globalState)
  const api = new JiraApi(new JiraClient(tokens))

  const tree = new IssuesTreeProvider(api, state, async () => Boolean(await tokens.get()))
  const treeView = vscode.window.createTreeView('jira.issues', { treeDataProvider: tree })
  const treeListeners = tree.attach(treeView)

  const updateContextKeys = async (): Promise<void> => {
    await vscode.commands.executeCommand('setContext', 'jira.hasToken', Boolean(await tokens.get()))
    await vscode.commands.executeCommand('setContext', 'jira.hasProject', Boolean(state.projectKey))
  }

  const panels = new IssuePanelManager(api, context.extensionUri, context.globalStorageUri, () => tree.refresh())
  const commandContext: ICommandContext = { api, tokens, state, tree, panels, updateContextKeys }

  context.subscriptions.push(
    treeView,
    treeListeners,
    state.onDidChange(() => void updateContextKeys()),
    context.secrets.onDidChange(() => {
      api.resetCache()
      void updateContextKeys().then(() => tree.refresh())
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('jira')) {
        tree.refresh()
      }
    }),
    ...registerAuthCommands(commandContext),
    ...registerBrowseCommands(commandContext),
    ...registerIssueCommands(commandContext),
    ...registerBranchCommands(commandContext),
  )

  void updateContextKeys()
}

export function deactivate(): void {}
