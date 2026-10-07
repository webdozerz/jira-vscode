import * as vscode from 'vscode'

const TOKEN_KEY = 'jira.token'

export class TokenStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  get(): Thenable<string | undefined> {
    return this.secrets.get(TOKEN_KEY)
  }

  set(token: string): Thenable<void> {
    return this.secrets.store(TOKEN_KEY, token)
  }

  clear(): Thenable<void> {
    return this.secrets.delete(TOKEN_KEY)
  }
}
