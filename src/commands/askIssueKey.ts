import * as vscode from 'vscode'

import { parseIssueKey } from '../utils/issueKey'

/** Спрашивает ключ или ссылку на задачу; подставляет из буфера обмена только то, что на них похоже. */
export async function askIssueKey(title: string): Promise<string | undefined> {
  const clipboard = await vscode.env.clipboard.readText()
  const input = await vscode.window.showInputBox({
    title,
    prompt: 'Ключ задачи (SE-123) или ссылка на неё',
    value: parseIssueKey(clipboard) ?? '',
    valueSelection: [0, 1000],
    ignoreFocusOut: true,
    validateInput: (value) => (parseIssueKey(value) ? undefined : 'Например: SE-123 или https://jira…/browse/SE-123'),
  })

  return input ? parseIssueKey(input) : undefined
}
