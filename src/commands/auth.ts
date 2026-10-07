import * as vscode from 'vscode'

import { safeCommand, type ICommandContext } from './context'

export function registerAuthCommands(ctx: ICommandContext): vscode.Disposable[] {
  const setToken = safeCommand(async () => {
    const token = await vscode.window.showInputBox({
      title: 'Токен Jira',
      prompt: 'Персональный токен доступа (Profile → Personal Access Tokens)',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : 'Токен не может быть пустым'),
    })
    if (!token) {
      return
    }

    // токен проверяем до сохранения, чтобы не хранить неработающий
    await ctx.tokens.set(token.trim())
    try {
      const me = await ctx.api.getMyself()
      void vscode.window.showInformationMessage(`Jira: вы вошли как ${me.displayName}`)
    } catch (err) {
      await ctx.tokens.clear()
      await ctx.updateContextKeys()
      throw err
    }

    await ctx.updateContextKeys()
    ctx.tree.refresh()

    if (!ctx.state.projectKey) {
      await vscode.commands.executeCommand('jira.selectProject')
    }
  })

  const clearToken = safeCommand(async () => {
    await ctx.tokens.clear()
    await ctx.updateContextKeys()
    ctx.tree.refresh()
    void vscode.window.showInformationMessage('Jira: токен удалён')
  })

  return [
    vscode.commands.registerCommand('jira.setToken', setToken),
    vscode.commands.registerCommand('jira.clearToken', clearToken),
  ]
}
