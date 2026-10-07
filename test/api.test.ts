import { describe, expect, it } from 'vitest'

import { buildJql, parseSprint, parseSprints } from '../src/jira/api'

const ACTIVE =
  "com.atlassian.greenhopper.service.sprint.Sprint@77ba0b50[activatedDate=2026-09-17T03:47:02.002Z,autoStartStop=false,completeDate=<null>,endDate=2026-10-01T05:45:00.000Z,goal=,id=177,incompleteIssuesDestinationId=<null>,name=SE Sprint 9'26,rapidViewId=52,sequence=177,startDate=2026-09-17T05:45:00.000Z,state=ACTIVE,synced=false]"

describe('parseSprint', () => {
  it('parses the legacy string from search results', () => {
    expect(parseSprint(ACTIVE)).toEqual({ id: 177, name: "SE Sprint 9'26", state: 'active' })
  })

  it('keeps commas in sprint names', () => {
    const raw = ACTIVE.replace("SE Sprint 9'26", 'Release, part 2')
    expect(parseSprint(raw)?.name).toBe('Release, part 2')
  })

  it('treats unknown state as closed and ignores garbage', () => {
    expect(parseSprint(ACTIVE.replace('ACTIVE', 'WEIRD'))?.state).toBe('closed')
    expect(parseSprint('nonsense')).toBeUndefined()
    expect(parseSprint(null)).toBeUndefined()
    expect(parseSprints(undefined)).toEqual([])
    expect(parseSprints([ACTIVE, 'bad'])).toHaveLength(1)
  })
})

describe('buildJql', () => {
  const base = { projectKey: 'SE', onlyMine: false, statuses: [] as string[] }

  it('builds filters for statuses and sprints', () => {
    expect(buildJql({ ...base, sprint: { kind: 'any' } })).toBe('project = "SE" ORDER BY updated DESC')
    expect(buildJql({ ...base, onlyMine: true, statuses: ['In progress'], sprint: { kind: 'open' } })).toBe(
      'project = "SE" AND assignee = currentUser() AND status in ("In progress") AND sprint in openSprints() ORDER BY updated DESC',
    )
    expect(buildJql({ ...base, sprint: { kind: 'none' } })).toContain('sprint is EMPTY')
    expect(buildJql({ ...base, sprint: { kind: 'sprint', id: 177, name: 'x' } })).toContain('sprint = 177')
  })

  it('escapes quotes in status names', () => {
    expect(buildJql({ ...base, statuses: ['Return "to do"'], sprint: { kind: 'any' } })).toContain('"Return \\"to do\\""')
  })
})
