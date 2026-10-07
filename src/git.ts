import * as vscode from 'vscode'

/** Минимум публичного API расширения `vscode.git` (его типы не входят в @types/vscode). */
interface IGitRepository {
  readonly rootUri: vscode.Uri
  readonly state: { readonly HEAD?: { readonly name?: string } }
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>
  checkout(treeish: string): Promise<void>
  getBranch(name: string): Promise<unknown>
}

interface IGitApi {
  readonly repositories: IGitRepository[]
}

interface IGitExtension {
  getAPI(version: 1): IGitApi
}

export interface IGitRepositoryHandle {
  readonly name: string
  readonly currentBranch: string | undefined
  hasBranch(name: string): Promise<boolean>
  createBranch(name: string, ref?: string): Promise<void>
  checkout(name: string): Promise<void>
}

const REPOSITORY_WAIT_MS = 3_000

async function getGitApi(): Promise<IGitApi> {
  const extension = vscode.extensions.getExtension<IGitExtension>('vscode.git')
  if (!extension) {
    throw new Error('Встроенное git-расширение VS Code недоступно.')
  }

  const exports = extension.isActive ? extension.exports : await extension.activate()
  return exports.getAPI(1)
}

/** Сразу после старта VS Code репозитории могут быть ещё не найдены — ждём немного. */
async function waitForRepositories(api: IGitApi): Promise<IGitRepository[]> {
  const deadline = Date.now() + REPOSITORY_WAIT_MS
  while (api.repositories.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return api.repositories
}

function wrap(repository: IGitRepository): IGitRepositoryHandle {
  return {
    name: repository.rootUri.path.split('/').filter(Boolean).pop() ?? repository.rootUri.fsPath,
    get currentBranch() {
      return repository.state.HEAD?.name
    },
    async hasBranch(name) {
      try {
        await repository.getBranch(name)
        return true
      } catch {
        return false
      }
    },
    createBranch: (name, ref) => repository.createBranch(name, true, ref),
    checkout: (name) => repository.checkout(name),
  }
}

/**
 * Находит git-репозиторий для работы. Один репозиторий — берём его; несколько — репозиторий
 * активного файла, иначе спрашиваем.
 */
export async function pickRepository(): Promise<IGitRepositoryHandle | undefined> {
  const repositories = await waitForRepositories(await getGitApi())
  if (repositories.length === 0) {
    throw new Error('Не найден git-репозиторий. Откройте в VS Code папку проекта, в которой есть git.')
  }
  if (repositories.length === 1) {
    return wrap(repositories[0])
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri
  const owner = activeUri
    ? repositories
        .filter((repository) => activeUri.fsPath.startsWith(repository.rootUri.fsPath))
        .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0]
    : undefined
  if (owner) {
    return wrap(owner)
  }

  const picked = await vscode.window.showQuickPick(
    repositories.map((repository) => ({
      label: wrap(repository).name,
      description: repository.rootUri.fsPath,
      repository,
    })),
    { title: 'В каком репозитории создать ветку?' },
  )
  return picked ? wrap(picked.repository) : undefined
}
