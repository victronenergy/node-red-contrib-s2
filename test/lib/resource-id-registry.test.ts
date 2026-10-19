import { claimResourceId, releaseResourceId, releaseAllResourceIds, resourceIdProblem, unresolvedEnvVar } from '../../src/lib/s2/resource-id-registry'

// The registry is process-wide, so every test uses its own resource IDs.

describe('resource ID registry', () => {
  it('claims a free resource ID', () => {
    expect(claimResourceId('rid-free', 'node-a')).toEqual({ claimed: true })
  })

  it('refuses a resource ID held by another node and names the holder', () => {
    claimResourceId('rid-held', 'node-a')
    expect(claimResourceId('rid-held', 'node-b')).toEqual({ claimed: false, holder: 'node-a' })
  })

  it('lets the holder claim its own resource ID again', () => {
    claimResourceId('rid-reclaim', 'node-a')
    expect(claimResourceId('rid-reclaim', 'node-a')).toEqual({ claimed: true })
  })

  it('frees a resource ID once its holder releases it', () => {
    claimResourceId('rid-release', 'node-a')
    releaseResourceId('rid-release', 'node-a')
    expect(claimResourceId('rid-release', 'node-b')).toEqual({ claimed: true })
  })

  it('keeps the claim when a node that does not hold it releases it', () => {
    claimResourceId('rid-foreign-release', 'node-a')
    releaseResourceId('rid-foreign-release', 'node-b')
    expect(claimResourceId('rid-foreign-release', 'node-b')).toEqual({ claimed: false, holder: 'node-a' })
  })
})

describe('resource ID registry - claim kinds', () => {
  it('lets an RM and a transport claim the same resource ID', () => {
    claimResourceId('rid-kinds-pair', 'rm-node', 'rm')
    expect(claimResourceId('rid-kinds-pair', 'ws-node', 'transport')).toEqual({ claimed: true })
  })

  it('refuses a second transport for the same resource ID', () => {
    claimResourceId('rid-kinds-transport', 'ws-1', 'transport')
    expect(claimResourceId('rid-kinds-transport', 'ws-2', 'transport')).toEqual({ claimed: false, holder: 'ws-1' })
  })

  it('treats a claim without a kind as an RM claim', () => {
    claimResourceId('rid-kinds-default', 'rm-1')
    expect(claimResourceId('rid-kinds-default', 'rm-2', 'rm')).toEqual({ claimed: false, holder: 'rm-1' })
  })

  it('releases only the claim of the given kind', () => {
    claimResourceId('rid-kinds-release', 'node-a', 'rm')
    claimResourceId('rid-kinds-release', 'node-a', 'transport')
    releaseResourceId('rid-kinds-release', 'node-a', 'transport')
    expect(claimResourceId('rid-kinds-release', 'node-b', 'transport')).toEqual({ claimed: true })
    expect(claimResourceId('rid-kinds-release', 'node-b', 'rm')).toEqual({ claimed: false, holder: 'node-a' })
  })
})

describe('unresolvedEnvVar', () => {
  it('returns the variable name of a ${NAME} reference Node-RED left in place', () => {
    expect(unresolvedEnvVar('${S2_RESOURCE_ID}')).toBe('S2_RESOURCE_ID')
  })

  it('returns the variable name of the older $(NAME) form', () => {
    expect(unresolvedEnvVar('$(S2_RESOURCE_ID)')).toBe('S2_RESOURCE_ID')
  })

  it('returns null for an ordinary resource ID', () => {
    expect(unresolvedEnvVar('3e9f140d-e08f-4ece-87fc-8929b5811858')).toBeNull()
    expect(unresolvedEnvVar('my-heatpump-01')).toBeNull()
    expect(unresolvedEnvVar('prefix-${S2_RESOURCE_ID}')).toBeNull()
  })
})

describe('releaseAllResourceIds', () => {
  it('frees every claim kind held by one node, and only that node', () => {
    claimResourceId('rid-all-a', 'node-a', 'rm')
    claimResourceId('rid-all-a', 'node-a', 'transport')
    claimResourceId('rid-all-b', 'node-b', 'rm')

    releaseAllResourceIds('node-a')

    expect(claimResourceId('rid-all-a', 'node-c', 'rm')).toEqual({ claimed: true })
    expect(claimResourceId('rid-all-a', 'node-c', 'transport')).toEqual({ claimed: true })
    expect(claimResourceId('rid-all-b', 'node-c', 'rm')).toEqual({ claimed: false, holder: 'node-b' })
  })
})

describe('resourceIdProblem', () => {
  it('accepts a UUID, a non-UUID in the S2 ID format, and a number', () => {
    expect(resourceIdProblem('3e9f140d-e08f-4ece-87fc-8929b5811858')).toBeNull()
    expect(resourceIdProblem('my-heatpump_01:a')).toBeNull()
    expect(resourceIdProblem(42)).toBeNull()
  })

  it('reports an empty resource ID as missing', () => {
    expect(resourceIdProblem('')).toEqual({ status: 'resource ID missing', message: expect.any(String) })
    expect(resourceIdProblem(undefined)).toEqual({ status: 'resource ID missing', message: expect.any(String) })
  })

  it('reports an unresolved environment variable, in either form, naming it', () => {
    expect(resourceIdProblem('${S2_ID}')).toEqual({ status: 'resource ID variable not set', message: expect.stringContaining('S2_ID') })
    expect(resourceIdProblem('$(S2_ID)')).toEqual({ status: 'resource ID variable not set', message: expect.stringContaining('S2_ID') })
  })

  it('reports a value outside the S2 ID format, naming it', () => {
    expect(resourceIdProblem('boiler 1')).toEqual({ status: 'invalid resource ID', message: expect.stringContaining('boiler 1') })
    expect(resourceIdProblem('a'.repeat(65))).toEqual({ status: 'invalid resource ID', message: expect.any(String) })
    expect(resourceIdProblem('a')).toEqual({ status: 'invalid resource ID', message: expect.any(String) })
  })
})
