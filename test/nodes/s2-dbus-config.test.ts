import registerNode from '../../src/nodes/s2-dbus-config/index'

function setupNode (config: Record<string, unknown>) {
  const node: Record<string, unknown> = { id: 'node-test-id' }

  const RED = {
    nodes: {
      createNode: jest.fn((n: Record<string, unknown>) => { Object.assign(n, node) }),
      registerType: jest.fn()
    }
  }

  let Constructor: ((this: Record<string, unknown>, config: Record<string, unknown>) => void) | null = null
  RED.nodes.registerType.mockImplementation((_type: string, ctor: (this: Record<string, unknown>, config: Record<string, unknown>) => void) => {
    Constructor = ctor
  })

  registerNode(RED as never)
  Constructor!.call(node, { id: 'node-test-id', ...config } as never)

  return node
}

describe('s2-dbus-config', () => {
  it('defaults connectionMode to "auto"', () => {
    const node = setupNode({})
    expect(node.connectionMode).toBe('auto')
  })

  it('reads a configured connectionMode', () => {
    const node = setupNode({ connectionMode: 'tcp', tcpAddress: 'tcp:host=venus.local,port=78' })
    expect(node.connectionMode).toBe('tcp')
    expect(node.tcpAddress).toBe('tcp:host=venus.local,port=78')
  })

  it('defaults deviceType to "acload"', () => {
    const node = setupNode({})
    expect(node.deviceType).toBe('acload')
  })

  it('reads a configured deviceType', () => {
    const node = setupNode({ deviceType: 'heatpump' })
    expect(node.deviceType).toBe('heatpump')
  })

  it('defaults measurementType to L1_L2_L3', () => {
    const node = setupNode({})
    expect(node.measurementType).toBe('L1_L2_L3')
  })

  it('defaults nrOfPhases to 1, position to 0, and phaseSetting to 1', () => {
    const node = setupNode({})
    expect(node.nrOfPhases).toBe(1)
    expect(node.position).toBe(0)
    expect(node.phaseSetting).toBe(1)
  })

  it('reads configured nrOfPhases, position, and phaseSetting', () => {
    const node = setupNode({ nrOfPhases: 3, position: 1, phaseSetting: 2 })
    expect(node.nrOfPhases).toBe(3)
    expect(node.position).toBe(1)
    expect(node.phaseSetting).toBe(2)
  })

  it('defaults autoCalculateEnergy to true', () => {
    const node = setupNode({})
    expect(node.autoCalculateEnergy).toBe(true)
  })

  it('reads autoCalculateEnergy: false', () => {
    const node = setupNode({ autoCalculateEnergy: false })
    expect(node.autoCalculateEnergy).toBe(false)
  })
})
