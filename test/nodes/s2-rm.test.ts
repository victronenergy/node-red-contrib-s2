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

function setupNode (config: Record<string, unknown>, rmConfigNode: unknown = DEFAULT_RM_CONFIG, settings: Record<string, unknown> = {}, cemConfigNode: unknown = null) {
  const handlers: Record<string, (...args: unknown[]) => void> = {}
  const flowContext: Record<string, unknown> = {}
  const node: Record<string, unknown> = {
    id: 'node-test-id',
    name: '',
    send: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
    status: jest.fn(),
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => { handlers[event] = handler }),
    context: jest.fn(() => ({
      flow: {
        get: jest.fn((key: string) => flowContext[key]),
        set: jest.fn((key: string, value: unknown) => { flowContext[key] = value })
      },
      global: { get: jest.fn(), set: jest.fn() },
      get: jest.fn(),
      set: jest.fn()
    }))
  }

  const RED = {
    nodes: {
      createNode: jest.fn((n: Record<string, unknown>) => { Object.assign(n, node) }),
      registerType: jest.fn(),
      getNode: jest.fn((id: string) => id === 'cem-cfg-id' ? cemConfigNode : rmConfigNode)
    },
    settings
  }

  let Constructor: ((this: Record<string, unknown>, config: Record<string, unknown>) => void) | null = null
  RED.nodes.registerType.mockImplementation((_type: string, ctor: (this: Record<string, unknown>, config: Record<string, unknown>) => void) => {
    Constructor = ctor
  })

  registerNode(RED as never)
  Constructor!.call(node, { rmConfig: 'rm-cfg-id', ...config, id: 'node-test-id' } as never)

  return { node, RED, handlers, flowContext }
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

  it('accepts PowerConstraints without a cemId, unlike every other command', () => {
    const { handlers } = setupNode({})

    const done = jest.fn()
    handlers.input({
      payload: {
        command: 'PowerConstraints',
        constraints: { commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', minPower: -3000, maxPower: 3000 }
      }
    }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith()
  })

  it('errors when constraints object is missing, even without a cemId', () => {
    const { handlers } = setupNode({})

    const done = jest.fn()
    handlers.input({ payload: { command: 'PowerConstraints' } }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith(expect.any(Error))
  })
})

describe('s2-rm - TEMPORARY_ERROR handling', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  function connectCem (handlers: Record<string, (...args: unknown[]) => void>, cemId = 'cem-1'): void {
    handlers.input({ payload: { command: 'Connect', cemId, keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    handlers.input(
      { payload: { command: 'Message', cemId, message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(), jest.fn()
    )
  }

  it('shows yellow status when CEM sends TEMPORARY_ERROR', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)
    ;(node.status as jest.Mock).mockClear()

    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.RECEPTION_STATUS, message_id: 'rs1', subject_message_id: 'orig1', status: 'TEMPORARY_ERROR' }) } },
      jest.fn(), jest.fn()
    )

    expect(node.status as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({ fill: 'yellow', shape: 'dot' }))
    expect(node.warn as jest.Mock).toHaveBeenCalledWith(expect.stringContaining('TEMPORARY_ERROR'))
  })

  it('reverts to connected status after 5 seconds', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)

    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.RECEPTION_STATUS, message_id: 'rs1', subject_message_id: 'orig1', status: 'TEMPORARY_ERROR' }) } },
      jest.fn(), jest.fn()
    )

    ;(node.status as jest.Mock).mockClear()
    jest.advanceTimersByTime(5000)

    expect(node.status as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({ fill: 'green', text: '1 CEM connected' }))
  })

  it('does not set yellow status for OK ReceptionStatus', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)
    ;(node.status as jest.Mock).mockClear()

    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.RECEPTION_STATUS, message_id: 'rs1', subject_message_id: 'orig1', status: 'OK' }) } },
      jest.fn(), jest.fn()
    )

    expect(node.status as jest.Mock).not.toHaveBeenCalledWith(expect.objectContaining({ fill: 'yellow' }))
  })
})

describe('s2-rm - flow context tracking', () => {
  const PEBC_CONTROL_TYPE = 'POWER_ENVELOPE_BASED_CONTROL'

  function setConstraints (handlers: Record<string, (...args: unknown[]) => void>, minPower: number, maxPower: number): void {
    handlers.input({
      payload: {
        command: 'PowerConstraints',
        constraints: { commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', minPower, maxPower }
      }
    }, jest.fn(), jest.fn())
  }

  function connectAndSelectPebc (handlers: Record<string, (...args: unknown[]) => void>): void {
    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(), jest.fn()
    )
    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.SELECT_CONTROL_TYPE, message_id: 'sct1', control_type: PEBC_CONTROL_TYPE }) } },
      jest.fn(), jest.fn()
    )
  }

  it('sets pebcConstraintsId in flow context when PEBC.PowerConstraints is sent', () => {
    const rmConfig = { ...DEFAULT_RM_CONFIG, controlTypes: PEBC_CONTROL_TYPE }
    const { handlers, flowContext } = setupNode({}, rmConfig)

    setConstraints(handlers, -11040, 11040)
    connectAndSelectPebc(handlers)

    expect(typeof flowContext.pebcConstraintsId).toBe('string')
    expect((flowContext.pebcConstraintsId as string).length).toBeGreaterThan(0)
  })

  it('updates pebcConstraintsId when new constraints are sent via PowerConstraints command', () => {
    const rmConfig = { ...DEFAULT_RM_CONFIG, controlTypes: PEBC_CONTROL_TYPE }
    const { handlers, flowContext } = setupNode({}, rmConfig)

    setConstraints(handlers, -11040, 11040)
    connectAndSelectPebc(handlers)
    const firstId = flowContext.pebcConstraintsId as string

    setConstraints(handlers, -5000, 5000)

    expect(typeof flowContext.pebcConstraintsId).toBe('string')
    expect(flowContext.pebcConstraintsId).not.toBe(firstId)
  })

  it('sets cemFlexInstructionUrl from s2-cem-config when cem reference is configured', () => {
    const cemConfig = { url: 'wss://cem-host:8080/s2/ws/', credentials: { username: 'user', password: 'pass' } }
    const { flowContext } = setupNode({ cem: 'cem-cfg-id' }, DEFAULT_RM_CONFIG, {}, cemConfig)

    expect(flowContext.cemFlexInstructionUrl).toBe(
      `https://cem-host:8080/resource_managers/${DEFAULT_RM_CONFIG.resourceId}/flex_instructions`
    )
  })

  it('includes apiPrefix in cemFlexInstructionUrl when configured', () => {
    const cemConfig = { url: 'wss://cem-host:8080/s2/ws/', apiPrefix: '/s2-message-handler', credentials: { username: 'user', password: 'pass' } }
    const { flowContext } = setupNode({ cem: 'cem-cfg-id' }, DEFAULT_RM_CONFIG, {}, cemConfig)

    expect(flowContext.cemFlexInstructionUrl).toBe(
      `https://cem-host:8080/s2-message-handler/resource_managers/${DEFAULT_RM_CONFIG.resourceId}/flex_instructions`
    )
  })

  it('converts ws:// to http:// for non-TLS CEM connections', () => {
    const cemConfig = { url: 'ws://cem-host:8080/s2/ws/', credentials: {} }
    const { flowContext } = setupNode({ cem: 'cem-cfg-id' }, DEFAULT_RM_CONFIG, {}, cemConfig)

    expect(flowContext.cemFlexInstructionUrl).toBe(
      `http://cem-host:8080/resource_managers/${DEFAULT_RM_CONFIG.resourceId}/flex_instructions`
    )
  })

  it('does not set cemFlexInstructionUrl when cem reference is not configured', () => {
    const { flowContext } = setupNode({}, DEFAULT_RM_CONFIG)

    expect(flowContext.cemFlexInstructionUrl).toBeUndefined()
  })

  it('sets cemApiAuth as a Basic auth header from s2-cem-config credentials', () => {
    const cemConfig = { url: 'wss://cem-host:8080/s2/ws/', credentials: { username: 'user', password: 'secret' } }
    const { flowContext } = setupNode({ cem: 'cem-cfg-id' }, DEFAULT_RM_CONFIG, {}, cemConfig)

    const expected = 'Basic ' + Buffer.from('user:secret').toString('base64')
    expect(flowContext.cemApiAuth).toBe(expected)
  })

  it('does not set cemApiAuth when username is not configured', () => {
    const cemConfig = { url: 'wss://cem-host:8080/s2/ws/', credentials: { username: '', password: '' } }
    const { flowContext } = setupNode({ cem: 'cem-cfg-id' }, DEFAULT_RM_CONFIG, {}, cemConfig)

    expect(flowContext.cemFlexInstructionUrl).toBeDefined()
    expect(flowContext.cemApiAuth).toBeUndefined()
  })
})

describe('s2-rm - pending instructions context', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  const PENDING_KEY = 's2PendingInstructions'

  function connectCem (handlers: Record<string, (...args: unknown[]) => void>, cemId = 'cem-1'): void {
    handlers.input({ payload: { command: 'Connect', cemId, keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    handlers.input(
      { payload: { command: 'Message', cemId, message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(), jest.fn()
    )
  }

  it('stores a future OMBC instruction in s2PendingInstructions', () => {
    const { handlers, flowContext } = setupNode({})
    connectCem(handlers)

    const futureTime = new Date(Date.now() + 60000).toISOString()
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-1',
          id: 'instr-1',
          execution_time: futureTime,
          operation_mode_id: 'mode-1',
          operation_mode_factor: 1,
          abnormal_condition: false
        })
      }
    }, jest.fn(), jest.fn())

    const pending = flowContext[PENDING_KEY] as unknown[]
    expect(Array.isArray(pending)).toBe(true)
    expect(pending.length).toBeGreaterThan(0)
    expect((pending[0] as Record<string, unknown>).cemId).toBe('cem-1')
    expect((pending[0] as Record<string, unknown>).executionTimeMs).toBeGreaterThan(Date.now())
  })

  it('does not emit a future OMBC instruction on port 3 immediately', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)
    ;(node.send as jest.Mock).mockClear()

    const futureTime = new Date(Date.now() + 60000).toISOString()
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-1',
          id: 'instr-1',
          execution_time: futureTime,
          operation_mode_id: 'mode-1',
          operation_mode_factor: 1,
          abnormal_condition: false
        })
      }
    }, jest.fn(), jest.fn())

    const port3Calls = (node.send as jest.Mock).mock.calls.filter(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[2] !== null
    )
    expect(port3Calls.length).toBe(0)
  })

  it('dispatches a future OMBC instruction on port 3 when its execution_time arrives', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)

    const futureTime = new Date(Date.now() + 5000).toISOString()
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-1',
          id: 'instr-1',
          execution_time: futureTime,
          operation_mode_id: 'mode-1',
          operation_mode_factor: 1,
          abnormal_condition: false
        })
      }
    }, jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    jest.advanceTimersByTime(7000)

    const port3Calls = (node.send as jest.Mock).mock.calls.filter(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] === null && (c[0] as unknown[])[2] !== null
    )
    expect(port3Calls.length).toBe(1)
    const dispatched = (port3Calls[0][0] as unknown[])[2] as { cemId: string, payload: Record<string, unknown> }
    expect(dispatched.cemId).toBe('cem-1')
    expect(dispatched.payload.message_type).toBe(MessageType.OMBC_INSTRUCTION)
  })

  it('removes a dispatched instruction from the pending context', () => {
    const { handlers, flowContext } = setupNode({})
    connectCem(handlers)

    const futureTime = new Date(Date.now() + 5000).toISOString()
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-1',
          id: 'instr-1',
          execution_time: futureTime,
          operation_mode_id: 'mode-1',
          operation_mode_factor: 1,
          abnormal_condition: false
        })
      }
    }, jest.fn(), jest.fn())

    jest.advanceTimersByTime(7000)

    const pending = (flowContext[PENDING_KEY] as unknown[]) || []
    expect(pending.length).toBe(0)
  })

  it('sends InstructionStatusUpdate(STARTED) when a pending instruction is dispatched', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)

    const futureTime = new Date(Date.now() + 5000).toISOString()
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-1',
          id: 'instr-42',
          execution_time: futureTime,
          operation_mode_id: 'mode-1',
          operation_mode_factor: 1,
          abnormal_condition: false
        })
      }
    }, jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    jest.advanceTimersByTime(7000)

    const port1Calls = (node.send as jest.Mock).mock.calls.filter(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] !== null
    )
    const startedCall = port1Calls.find(
      (c: unknown[]) => {
        const msg = ((c[0] as unknown[])[0] as { payload?: { message?: Record<string, unknown> } })?.payload?.message
        return msg?.message_type === MessageType.INSTRUCTION_STATUS_UPDATE && msg?.status_type === 'STARTED'
      }
    )
    expect(startedCall).toBeDefined()
  })

  it('dispatches an immediate OMBC instruction on port 3 right away', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)
    ;(node.send as jest.Mock).mockClear()

    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-2',
          id: 'instr-2',
          execution_time: new Date(Date.now() - 1000).toISOString(),
          operation_mode_id: 'mode-1',
          operation_mode_factor: 1,
          abnormal_condition: false
        })
      }
    }, jest.fn(), jest.fn())

    const port3Calls = (node.send as jest.Mock).mock.calls.filter(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] === null && (c[0] as unknown[])[2] !== null
    )
    expect(port3Calls.length).toBe(1)
  })

  it('enriches an immediate OMBC instruction on port 3 with msg.controlType and namespaced msg.ombc', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)
    ;(node.send as jest.Mock).mockClear()

    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-enrich',
          id: 'instr-enrich',
          execution_time: new Date(Date.now() - 1000).toISOString(),
          operation_mode_id: 'mode-on',
          operation_mode_factor: 0.8,
          abnormal_condition: false
        })
      }
    }, jest.fn(), jest.fn())

    const port3Call = (node.send as jest.Mock).mock.calls.find(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] === null && (c[0] as unknown[])[2] !== null
    )
    expect(port3Call).toBeDefined()
    const out = (port3Call as unknown[][])[0][2] as { controlType: string, ombc: { operation_mode_id: string } }
    expect(out.controlType).toBe('OPERATION_MODE_BASED_CONTROL')
    expect(out.ombc.operation_mode_id).toBe('mode-on')
  })

  it('enriches a future OMBC instruction on port 3 with msg.controlType and namespaced msg.ombc when dispatched', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)

    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-fut-enrich',
          id: 'instr-fut-enrich',
          execution_time: new Date(Date.now() + 5000).toISOString(),
          operation_mode_id: 'mode-on',
          operation_mode_factor: 1,
          abnormal_condition: false
        })
      }
    }, jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    jest.advanceTimersByTime(7000)

    const port3Call = (node.send as jest.Mock).mock.calls.find(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] === null && (c[0] as unknown[])[2] !== null
    )
    expect(port3Call).toBeDefined()
    const out = (port3Call as unknown[][])[0][2] as { controlType: string, ombc: { operation_mode_id: string } }
    expect(out.controlType).toBe('OPERATION_MODE_BASED_CONTROL')
    expect(out.ombc.operation_mode_id).toBe('mode-on')
  })

  it('delivers a PEBC instruction on port 3 immediately, bypassing the execution_time queue', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)
    ;(node.send as jest.Mock).mockClear()

    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: 'PEBC.Instruction',
          message_id: 'msg-pebc',
          id: 'instr-pebc',
          execution_time: new Date(Date.now() + 60000).toISOString(),
          power_constraints_id: 'cid-1',
          power_envelopes: []
        })
      }
    }, jest.fn(), jest.fn())

    const port3Call = (node.send as jest.Mock).mock.calls.find(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] === null && (c[0] as unknown[])[2] !== null
    )
    expect(port3Call).toBeDefined()
    const out = (port3Call as unknown[][])[0][2] as { controlType: string, pebc: Record<string, unknown> }
    expect(out.controlType).toBe('POWER_ENVELOPE_BASED_CONTROL')
    expect(out.pebc.message_type).toBe('PEBC.Instruction')

    // No pending-instruction bookkeeping for PEBC - it's not queued generically
    expect(node.error as jest.Mock).not.toHaveBeenCalled()
  })
})

describe('s2-rm - UpdateStatus / SystemDescription commands', () => {
  function connectCem (handlers: Record<string, (...args: unknown[]) => void>): void {
    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(), jest.fn()
    )
  }

  function findMessageOfType (node: Record<string, unknown>, messageType: string): Record<string, unknown> | undefined {
    const call = (node.send as jest.Mock).mock.calls.find((c: unknown[]) => {
      const p1 = Array.isArray(c[0]) && (c[0] as unknown[])[0] as { payload?: { s2Signal?: string, message?: { message_type?: string } } }
      return p1 && p1.payload?.s2Signal === 'Message' && p1.payload?.message?.message_type === messageType
    })
    if (!call) return undefined
    return (((call as unknown[][])[0][0]) as { payload: { message: Record<string, unknown> } }).payload.message
  }

  it('sends OMBC.Status to the CEM for an UpdateStatus command', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)
    ;(node.send as jest.Mock).mockClear()

    handlers.input({
      payload: {
        command: 'UpdateStatus',
        cemId: 'cem-1',
        controlType: 'OPERATION_MODE_BASED_CONTROL',
        ombc: { activeOperationModeId: 'mode-on', operationModeFactor: 1 }
      }
    }, jest.fn(), jest.fn())

    const status = findMessageOfType(node, MessageType.OMBC_STATUS)
    expect(status).toBeDefined()
    expect(status!.active_operation_mode_id).toBe('mode-on')
  })

  it('sends OMBC.SystemDescription to the CEM for a SystemDescription command', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)
    ;(node.send as jest.Mock).mockClear()

    handlers.input({
      payload: {
        command: 'SystemDescription',
        cemId: 'cem-1',
        controlType: 'OPERATION_MODE_BASED_CONTROL',
        ombc: { operationModes: [{ id: 'mode-on', diagnostic_label: 'On', power_ranges: [], abnormal_condition_only: false }], transitions: [], timers: [] }
      }
    }, jest.fn(), jest.fn())

    const sysDesc = findMessageOfType(node, MessageType.OMBC_SYSTEM_DESCRIPTION)
    expect(sysDesc).toBeDefined()
    expect((sysDesc!.operation_modes as unknown[])[0]).toMatchObject({ id: 'mode-on' })
  })

  it('errors when UpdateStatus is missing a controlType', () => {
    const { handlers } = setupNode({})
    connectCem(handlers)

    const done = jest.fn()
    handlers.input({ payload: { command: 'UpdateStatus', cemId: 'cem-1', ombc: {} } }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith(expect.any(Error))
  })

  it('warns and succeeds when UpdateStatus targets an unknown CEM', () => {
    const { node, handlers } = setupNode({})

    const done = jest.fn()
    handlers.input({
      payload: { command: 'UpdateStatus', cemId: 'cem-unknown', controlType: 'OPERATION_MODE_BASED_CONTROL', ombc: {} }
    }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith()
    expect(node.warn as jest.Mock).toHaveBeenCalled()
  })

  it('errors when SystemDescription is missing a controlType', () => {
    const { handlers } = setupNode({})
    connectCem(handlers)

    const done = jest.fn()
    handlers.input({ payload: { command: 'SystemDescription', cemId: 'cem-1', ombc: {} } }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith(expect.any(Error))
  })

  it('warns and succeeds when SystemDescription targets an unknown CEM', () => {
    const { node, handlers } = setupNode({})

    const done = jest.fn()
    handlers.input({
      payload: { command: 'SystemDescription', cemId: 'cem-unknown', controlType: 'OPERATION_MODE_BASED_CONTROL', ombc: {} }
    }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith()
    expect(node.warn as jest.Mock).toHaveBeenCalled()
  })
})

describe('s2-rm - RevokeObject handling', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  const PENDING_KEY = 's2PendingInstructions'

  function connectCem (handlers: Record<string, (...args: unknown[]) => void>, cemId = 'cem-1'): void {
    handlers.input({ payload: { command: 'Connect', cemId, keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    handlers.input(
      { payload: { command: 'Message', cemId, message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(), jest.fn()
    )
  }

  function sendRevokeObject (handlers: Record<string, (...args: unknown[]) => void>, objectId: string, objectType: string): void {
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.REVOKE_OBJECT,
          message_id: 'rv-' + objectId,
          object_id: objectId,
          object_type: objectType
        })
      }
    }, jest.fn(), jest.fn())
  }

  it('removes a pending OMBC instruction when it is revoked', () => {
    const { handlers, flowContext } = setupNode({})
    connectCem(handlers)

    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-1',
          id: 'instr-ombc-1',
          execution_time: new Date(Date.now() + 60000).toISOString(),
          operation_mode_id: 'mode-1',
          operation_mode_factor: 1,
          abnormal_condition: false
        })
      }
    }, jest.fn(), jest.fn())

    expect((flowContext[PENDING_KEY] as unknown[]).length).toBe(1)

    sendRevokeObject(handlers, 'instr-ombc-1', 'OMBC.Instruction')

    expect(((flowContext[PENDING_KEY] as unknown[]) || []).length).toBe(0)
  })

  it('ignores a RevokeObject whose object_type is not an instruction, even if object_id collides with a pending instruction', () => {
    const { node, handlers, flowContext } = setupNode({})
    connectCem(handlers)

    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-1',
          id: 'instr-ombc-1',
          execution_time: new Date(Date.now() + 60000).toISOString(),
          operation_mode_id: 'mode-1',
          operation_mode_factor: 1,
          abnormal_condition: false
        })
      }
    }, jest.fn(), jest.fn())

    expect((flowContext[PENDING_KEY] as unknown[]).length).toBe(1)
    ;(node.send as jest.Mock).mockClear()

    // object_id collides with the pending instruction's id, but object_type is not an instruction type
    sendRevokeObject(handlers, 'instr-ombc-1', 'PEBC.PowerConstraints')

    expect((flowContext[PENDING_KEY] as unknown[]).length).toBe(1)

    const port1Calls = (node.send as jest.Mock).mock.calls.filter(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] !== null
    )
    const revoked = port1Calls.find(
      (c: unknown[]) => {
        const msg = ((c[0] as unknown[])[0] as { payload?: { message?: Record<string, unknown> } })?.payload?.message
        return msg?.message_type === MessageType.INSTRUCTION_STATUS_UPDATE && msg?.status_type === 'REVOKED'
      }
    )
    expect(revoked).toBeUndefined()
  })

  it('sends InstructionStatusUpdate(REVOKED) to the CEM when a pending instruction is revoked', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)

    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-1',
          id: 'instr-ombc-1',
          execution_time: new Date(Date.now() + 60000).toISOString(),
          operation_mode_id: 'mode-1',
          operation_mode_factor: 1,
          abnormal_condition: false
        })
      }
    }, jest.fn(), jest.fn())

    ;(node.send as jest.Mock).mockClear()

    sendRevokeObject(handlers, 'instr-ombc-1', 'OMBC.Instruction')

    const port1Calls = (node.send as jest.Mock).mock.calls.filter(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] !== null
    )
    const revoked = port1Calls.find(
      (c: unknown[]) => {
        const msg = ((c[0] as unknown[])[0] as { payload?: { message?: Record<string, unknown> } })?.payload?.message
        return msg?.message_type === MessageType.INSTRUCTION_STATUS_UPDATE &&
          msg?.instruction_id === 'instr-ombc-1' &&
          msg?.status_type === 'REVOKED'
      }
    )
    expect(revoked).toBeDefined()
  })

  it('does not send InstructionStatusUpdate(REVOKED) for an unknown/already-cleared instruction', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)
    ;(node.send as jest.Mock).mockClear()

    sendRevokeObject(handlers, 'instr-unknown', 'OMBC.Instruction')

    const port1Calls = (node.send as jest.Mock).mock.calls.filter(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] !== null
    )
    const revoked = port1Calls.find(
      (c: unknown[]) => {
        const msg = ((c[0] as unknown[])[0] as { payload?: { message?: Record<string, unknown> } })?.payload?.message
        return msg?.message_type === MessageType.INSTRUCTION_STATUS_UPDATE && msg?.status_type === 'REVOKED'
      }
    )
    expect(revoked).toBeUndefined()
  })

  it('forwards RevokeObject on port 2', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)
    ;(node.send as jest.Mock).mockClear()

    sendRevokeObject(handlers, 'instr-unknown', 'OMBC.Instruction')

    const port2Calls = (node.send as jest.Mock).mock.calls.filter(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[1] !== null
    )
    expect(port2Calls.length).toBeGreaterThan(0)
    const payload = ((port2Calls[0][0] as unknown[])[1] as { payload: Record<string, unknown> }).payload
    expect(payload.message_type).toBe(MessageType.REVOKE_OBJECT)
    expect(payload.object_id).toBe('instr-unknown')
  })

  it('is harmless when revoked object_id does not match any pending instruction', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)

    const done = jest.fn()
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.REVOKE_OBJECT,
          message_id: 'rv-noop',
          object_id: 'no-such-id',
          object_type: 'OMBC.Instruction'
        })
      }
    }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith()
    expect(node.error as jest.Mock).not.toHaveBeenCalled()
  })
})

describe('s2-rm - InstructionStatus command', () => {
  function connectCem (handlers: Record<string, (...args: unknown[]) => void>): void {
    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(), jest.fn()
    )
  }

  it('sends InstructionStatusUpdate for a connected CEM', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)
    ;(node.send as jest.Mock).mockClear()

    handlers.input({
      payload: { command: 'InstructionStatus', cemId: 'cem-1', instructionId: 'instr-99', status: 'SUCCEEDED' }
    }, jest.fn(), jest.fn())

    const port1Calls = (node.send as jest.Mock).mock.calls.filter(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] !== null
    )
    const succeeded = port1Calls.find(
      (c: unknown[]) => {
        const msg = ((c[0] as unknown[])[0] as { payload?: { message?: Record<string, unknown> } })?.payload?.message
        return msg?.message_type === MessageType.INSTRUCTION_STATUS_UPDATE && msg?.status_type === 'SUCCEEDED'
      }
    )
    expect(succeeded).toBeDefined()
  })

  it('errors when instructionId is missing', () => {
    const { handlers } = setupNode({})
    connectCem(handlers)

    const done = jest.fn()
    handlers.input({
      payload: { command: 'InstructionStatus', cemId: 'cem-1', status: 'SUCCEEDED' }
    }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith(expect.any(Error))
  })

  it('errors when status is invalid', () => {
    const { handlers } = setupNode({})
    connectCem(handlers)

    const done = jest.fn()
    handlers.input({
      payload: { command: 'InstructionStatus', cemId: 'cem-1', instructionId: 'instr-1', status: 'UNKNOWN_STATUS' }
    }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith(expect.any(Error))
  })

  it('warns and succeeds when CEM is not connected', () => {
    const { node, handlers } = setupNode({})

    const done = jest.fn()
    handlers.input({
      payload: { command: 'InstructionStatus', cemId: 'cem-unknown', instructionId: 'instr-1', status: 'ABORTED' }
    }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith()
    expect(node.warn as jest.Mock).toHaveBeenCalled()
  })
})

describe('s2-rm - lifecycle events and msg.topic', () => {
  type Port2Msg = { payload: Record<string, unknown>, cemId: string, topic: string }

  function getPort2Calls (node: Record<string, unknown>): Port2Msg[] {
    return (node.send as jest.Mock).mock.calls
      .map((c: unknown[]) => c[0] as unknown[])
      .filter((args) => Array.isArray(args) && args[0] === null && args[1] !== null)
      .map((args) => args[1] as Port2Msg)
  }

  it('emits a Connected lifecycle event on port 2 when a CEM connects', () => {
    const { node, handlers } = setupNode({})
    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 30 } }, jest.fn(), jest.fn())

    const port2 = getPort2Calls(node)
    const connectEvent = port2.find((m) => m.topic === 'Connected')
    expect(connectEvent).toBeDefined()
    expect(connectEvent!.cemId).toBe('cem-1')
  })

  it('emits a Disconnected lifecycle event with reason on port 2 when a CEM disconnects', () => {
    const { node, handlers } = setupNode({})
    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    handlers.input({ payload: { command: 'Disconnect', cemId: 'cem-1' } }, jest.fn(), jest.fn())

    const port2 = getPort2Calls(node)
    const disconnectEvent = port2.find((m) => m.topic === 'Disconnected')
    expect(disconnectEvent).toBeDefined()
    expect(disconnectEvent!.cemId).toBe('cem-1')
    expect((disconnectEvent as unknown as Record<string, unknown>).reason).toBe('cem_initiated')
  })

  it('sets msg.topic to message_type on port 2 S2 messages', () => {
    const { node, handlers } = setupNode({})
    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(), jest.fn()
    )

    const port2 = getPort2Calls(node)
    const handshakeMsg = port2.find((m) => m.payload.message_type === MessageType.HANDSHAKE_RESPONSE)
    expect(handshakeMsg).toBeDefined()
    expect(handshakeMsg!.topic).toBe(MessageType.HANDSHAKE_RESPONSE)
  })
})
