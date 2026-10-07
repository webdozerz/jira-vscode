import { describe, expect, it } from 'vitest'

import { GroupExpansion } from '../src/views/groupExpansion'

describe('GroupExpansion', () => {
  it('treats freshly loaded groups as expanded by default', () => {
    const expansion = new GroupExpansion()
    expect(expansion.anyExpanded).toBe(false)

    expansion.reconcile(['a', 'b'])
    expect(expansion.anyExpanded).toBe(true)
  })

  it('follows manual collapse and expand events', () => {
    const expansion = new GroupExpansion()
    expansion.reconcile(['a', 'b'])

    expansion.markCollapsed('a')
    expect(expansion.anyExpanded).toBe(true)
    expansion.markCollapsed('b')
    expect(expansion.anyExpanded).toBe(false)
    expansion.markExpanded('b')
    expect(expansion.anyExpanded).toBe(true)
  })

  it('collapses everything with new item ids so VS Code forgets the old state', () => {
    const expansion = new GroupExpansion()
    expansion.reconcile(['a', 'b'])
    const before = expansion.itemId('a')

    expansion.setAll(false, ['a', 'b'])
    expect(expansion.anyExpanded).toBe(false)
    expect(expansion.isExpandedByDefault).toBe(false)
    expect(expansion.itemId('a')).not.toBe(before)

    expansion.setAll(true, ['a', 'b'])
    expect(expansion.anyExpanded).toBe(true)
    expect(expansion.isExpandedByDefault).toBe(true)
  })

  it('keeps collapsed groups collapsed across reloads and drops vanished ones', () => {
    const expansion = new GroupExpansion()
    expansion.reconcile(['a', 'b'])
    expansion.markCollapsed('a')

    expansion.reconcile(['a', 'b', 'c'])
    expansion.markCollapsed('b')
    expansion.markCollapsed('c')
    expect(expansion.anyExpanded).toBe(false)

    expansion.reconcile(['a'])
    expect(expansion.anyExpanded).toBe(false)
  })

  it('new groups after "collapse all" start collapsed', () => {
    const expansion = new GroupExpansion()
    expansion.reconcile(['a'])
    expansion.setAll(false, ['a'])

    expansion.reconcile(['a', 'new'])
    expect(expansion.anyExpanded).toBe(false)
  })
})
