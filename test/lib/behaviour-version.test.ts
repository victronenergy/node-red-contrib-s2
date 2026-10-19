import { versionAtLeast } from '../../src/lib/s2/behaviour-version'

describe('versionAtLeast', () => {
  it('compares release versions part by part, as numbers', () => {
    expect(versionAtLeast('0.9.7', '0.9.7')).toBe(true)
    expect(versionAtLeast('0.9.8', '0.9.7')).toBe(true)
    expect(versionAtLeast('0.10.0', '0.9.7')).toBe(true)
    expect(versionAtLeast('1.0.0', '0.9.7')).toBe(true)
    expect(versionAtLeast('0.9.6', '0.9.7')).toBe(false)
  })

  it('treats missing parts as 0', () => {
    expect(versionAtLeast('1.0', '1.0.0')).toBe(true)
    expect(versionAtLeast('1', '1.0.1')).toBe(false)
  })

  it('treats a node without a version, or with an unreadable one, as older than any release', () => {
    expect(versionAtLeast(undefined, '0.9.7')).toBe(false)
    expect(versionAtLeast('', '0.9.7')).toBe(false)
    expect(versionAtLeast(2, '0.9.7')).toBe(false)
    expect(versionAtLeast('next', '0.9.7')).toBe(false)
  })
})
