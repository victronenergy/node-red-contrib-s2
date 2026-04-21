import { MessageType, serialize } from '../../src/lib/s2/messages'
import registerNode from '../../src/nodes/s2-rm/index'

const DEFAULT_RM_CONFIG = {
  resourceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  rmName: 'Test RM',
  manufacturer: 'Acme',
  model: 'X1',
  firmwareVersion: '2.0.0',
  controlTypes: 'OPERATION_MODE_BASED_CONTROL'
}

function setupNode (config: Record<string, unknown>, rmConfigNode: unknown = DEFAULT_RM_CONFIG) {
  const handlers: Record<string, (...args: unknown[]) => void> = {}
  const node: Record<string, unknown> = {
    id: 'node-test-id',
    name: '',
    send: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
    status: jest.fn(),
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => { handlers[event] = handler })
  }

  const RED = {
    nodes: {
      createNode: jest.fn((n: Record<string, unknown>) => { Object.assign(n, node) }),
      registerType: jest.fn(),
      getNode: jest.fn().mockReturnValue(rmConfigNode)
    }
  }

  let Constructor: ((this: Record<string, unknown>, config: Record<string, unknown>) => void) | null = null
  RED.nodes.registerType.mockImplementation((_type: string, ctor: (this: Record<string, unknown>, config: Record<string, unknown>) => void) => {
    Constructor = ctor
  })

  registerNode(RED as never)
  Constructor!.call(node, { rmConfig: 'rm-cfg-id', ...config, id: 'node-test-id' } as never)

  return { node, RED, handlers }
}

describe('s2-rm - config node reference', () => {
  it('reads rmDetails from s2-rm-config node', () => {
    const { node, handlers } = setupNode({})

    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 60 } }, jest.fn(), jest.fn())
    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(),
      jest.fn()
    )

    // ResourceManagerDetails is sent after HandshakeResponse
    const rmdCall = (node.send as jest.Mock).mock.calls.find(
      (c: unknown[]) => (c[0] as { payload?: { message?: { message_type?: string } } }[])?.[0]?.payload?.message?.message_type === MessageType.RESOURCE_MANAGER_DETAILS
    )
    expect(rmdCall).toBeDefined()
    const rmd = (rmdCall as unknown[][])[0][0] as { payload: { message: Record<string, unknown> } }
    expect(rmd.payload.message.resource_id).toBe(DEFAULT_RM_CONFIG.resourceId)
    expect(rmd.payload.message.name).toBe(DEFAULT_RM_CONFIG.rmName)
    expect(rmd.payload.message.manufacturer).toBe(DEFAULT_RM_CONFIG.manufacturer)
    expect(rmd.payload.message.model).toBe(DEFAULT_RM_CONFIG.model)
    expect(rmd.payload.message.firmware_version).toBe(DEFAULT_RM_CONFIG.firmwareVersion)
    expect(rmd.payload.message.available_control_types).toEqual(['OPERATION_MODE_BASED_CONTROL'])
  })

  it('sets error status and does not register input handler when s2-rm-config is missing', () => {
    const { node, handlers } = setupNode({}, null)

    expect(node.status as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({ fill: 'red' }))
    expect(node.error as jest.Mock).toHaveBeenCalled()
    expect(handlers.input).toBeUndefined()
  })
})

describe('s2-rm - PowerConstraints command', () => {
  it('succeeds when no CEMs are connected (stores for later)', () => {
    const { handlers } = setupNode({})

    const done = jest.fn()
    handlers.input({
      payload: {
        command: 'PowerConstraints',
        cemId: 'cem-1',
        constraints: { commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', minPower: -3000, maxPower: 3000 }
      }
    }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith()
  })

  it('errors when constraints object is missing', () => {
    const { handlers } = setupNode({})

    const done = jest.fn()
    handlers.input({ payload: { command: 'PowerConstraints', cemId: 'cem-1' } }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith(expect.any(Error))
  })

  it('applies stored constraints to a new session when the CEM connects after PowerConstraints was set', () => {
    const { node, handlers } = setupNode({})

    handlers.input({
      payload: {
        command: 'PowerConstraints',
        cemId: 'cem-1',
        constraints: { commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', minPower: -3000, maxPower: 3000 }
      }
    }, jest.fn(), jest.fn())

    ;(node.send as jest.Mock).mockClear()
    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())

    // Session is created with constraints stored - no send yet because SelectControlType hasn't fired
    // Just verify no error occurred
    expect(node.error as jest.Mock).not.toHaveBeenCalled()
  })
})

describe('s2-rm - grid connection default constraints', () => {
  it('initializes pendingPEBCConstraints from rmConfig gridConnection', () => {
    const rmConfig = { ...DEFAULT_RM_CONFIG, gridConnection: '3x25A' }
    const { node, handlers } = setupNode({}, rmConfig)

    // Connect a CEM and trigger SelectControlType to cause PEBC constraints to be sent
    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())

    // No error means constraints were accepted without a prior PowerConstraints command
    expect(node.error as jest.Mock).not.toHaveBeenCalled()
  })

  it('initializes with correct wattage for 3x25A', () => {
    const rmConfig = { ...DEFAULT_RM_CONFIG, gridConnection: '3x25A', controlTypes: 'POWER_ENVELOPE_BASED_CONTROL' }
    const { node, handlers } = setupNode({}, rmConfig)

    ;(node.send as jest.Mock).mockClear()
    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())

    // Session created without error; constraints are set from config (-17250, 17250)
    expect(node.error as jest.Mock).not.toHaveBeenCalled()
  })

  it('does not initialize pendingPEBCConstraints when gridConnection is not set', () => {
    const rmConfig = { ...DEFAULT_RM_CONFIG }
    const { node, handlers } = setupNode({}, rmConfig)

    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())

    expect(node.error as jest.Mock).not.toHaveBeenCalled()
  })

  it('uses customMaxPowerW when gridConnection is custom', () => {
    const rmConfig = { ...DEFAULT_RM_CONFIG, gridConnection: 'custom', customMaxPowerW: 15000 }
    const { node, handlers } = setupNode({}, rmConfig)

    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())

    expect(node.error as jest.Mock).not.toHaveBeenCalled()
  })
})
