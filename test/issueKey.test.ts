import { describe, expect, it } from 'vitest'

import { parseIssueKey } from '../src/utils/issueKey'

describe('parseIssueKey', () => {
  it('accepts plain keys in any case', () => {
    expect(parseIssueKey('SE-123')).toBe('SE-123')
    expect(parseIssueKey('  se-7 ')).toBe('SE-7')
  })

  it('extracts the key from browse links', () => {
    expect(parseIssueKey('https://jira.crypton.studio/browse/SE-1387')).toBe('SE-1387')
    expect(parseIssueKey('https://jira.crypton.studio/browse/SE-1387?focusedCommentId=5')).toBe('SE-1387')
    expect(parseIssueKey('https://jira.crypton.studio/secure/RapidBoard.jspa?rapidView=52&selectedIssue=se-9')).toBe('SE-9')
  })

  it('rejects random text so clipboard is not hijacked', () => {
    expect(parseIssueKey('utf-8 encoding is fine')).toBeUndefined()
    expect(parseIssueKey('hello')).toBeUndefined()
    expect(parseIssueKey('')).toBeUndefined()
    expect(parseIssueKey('https://example.com/page')).toBeUndefined()
  })
})
