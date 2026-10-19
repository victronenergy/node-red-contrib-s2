/**
 * A node's `version` is the release whose behaviour it has: newly added nodes get the current one
 * as a default, while nodes Node-RED loads from deployed flows keep what they were saved with (or
 * none, for nodes from before behaviour versions). A behaviour change then applies only to nodes
 * at or above the release that introduced it.
 *
 * Compared as numbers per dotted part ('0.10.0' is newer than '0.9.7', which a string compare gets
 * wrong); missing parts count as 0. A missing or unreadable version is older than any release.
 * The editor has the same function in resources/s2-common.js.
 */
export function versionAtLeast (version: unknown, minimum: string): boolean {
  if (typeof version !== 'string' || !/^\d+(\.\d+)*$/.test(version)) return false
  const have = version.split('.').map(Number)
  const want = minimum.split('.').map(Number)
  for (let i = 0; i < Math.max(have.length, want.length); i++) {
    const diff = (have[i] ?? 0) - (want[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return true
}
