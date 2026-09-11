import { describe, expect, it } from 'vitest'
import { draftKey, timeAgo } from '../src/state/drafts'

describe('how long ago a draft was taken', () => {
  const now = Date.UTC(2026, 8, 11, 12, 0, 0)
  const ago = (seconds: number) => timeAgo(now - seconds * 1000, now)

  it('says "przed chwilą" while it is still fresh', () => {
    expect(ago(0)).toBe('przed chwilą')
    expect(ago(44)).toBe('przed chwilą')
  })

  it('counts in Polish, which needs three forms rather than two', () => {
    expect(ago(60)).toBe('sprzed minuty')
    expect(ago(60 * 3)).toBe('sprzed 3 minuty')
    expect(ago(60 * 7)).toBe('sprzed 7 minut')
    // The teens take the many-form even though they end in 2, 3 and 4.
    expect(ago(60 * 13)).toBe('sprzed 13 minut')
    expect(ago(60 * 22)).toBe('sprzed 22 minuty')
  })

  it('moves up to hours and days', () => {
    expect(ago(3600)).toBe('sprzed godziny')
    expect(ago(3600 * 3)).toBe('sprzed 3 godziny')
    expect(ago(3600 * 8)).toBe('sprzed 8 godzin')
    expect(ago(3600 * 24)).toBe('sprzed dnia')
    expect(ago(3600 * 24 * 4)).toBe('sprzed 4 dni')
  })

  it('never counts backwards when the clock disagrees with itself', () => {
    expect(timeAgo(now + 5000, now)).toBe('przed chwilą')
  })
})

describe('draft keys', () => {
  it('keep two projects with the same map name apart', () => {
    expect(draftKey('/a', 'levels/01.tmj')).not.toBe(draftKey('/b', 'levels/01.tmj'))
  })
})
