/**
 * Учёт того, какие группы дерева развёрнуты.
 *
 * VS Code запоминает состояние узла по его `id`, а программно свернуть или развернуть всё API не даёт.
 * Поэтому при «свернуть/развернуть всё» меняем поколение в `id`: узлы выглядят новыми и принимают
 * состояние по умолчанию. Остальное время состояние отслеживается по событиям expand/collapse.
 */
export class GroupExpansion {
  private generation = 0
  private expandedByDefault = true
  private readonly known = new Set<string>()
  private readonly expanded = new Set<string>()

  /** Есть ли хоть одна развёрнутая группа — по этому выбирается иконка кнопки (свернуть / развернуть). */
  get anyExpanded(): boolean {
    return this.expanded.size > 0
  }

  get isExpandedByDefault(): boolean {
    return this.expandedByDefault
  }

  itemId(groupId: string): string {
    return `group:${this.generation}:${groupId}`
  }

  markExpanded(groupId: string): void {
    this.expanded.add(groupId)
  }

  markCollapsed(groupId: string): void {
    this.expanded.delete(groupId)
  }

  /** После загрузки: забываем исчезнувшие группы, новые считаем находящимися в состоянии по умолчанию. */
  reconcile(groupIds: string[]): void {
    const current = new Set(groupIds)
    for (const id of [...this.known]) {
      if (!current.has(id)) {
        this.known.delete(id)
        this.expanded.delete(id)
      }
    }
    for (const id of groupIds) {
      if (!this.known.has(id)) {
        this.known.add(id)
        if (this.expandedByDefault) {
          this.expanded.add(id)
        }
      }
    }
  }

  setAll(expanded: boolean, groupIds: string[]): void {
    this.generation += 1
    this.expandedByDefault = expanded
    this.expanded.clear()
    if (expanded) {
      groupIds.forEach((id) => this.expanded.add(id))
    }
  }
}
