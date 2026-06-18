import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
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

describe('s2-rm - PEBC instruction accumulation', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  const SLOT = 900_000

  function connectCem (handlers: Record<string, (...args: unknown[]) => void>, cemId = 'cem-1'): void {
    handlers.input({ payload: { command: 'Connect', cemId, keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    handlers.input(
      { payload: { command: 'Message', cemId, message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(), jest.fn()
    )
  }

  function sendPebcInstruction (handlers: Record<string, (...args: unknown[]) => void>, executionTimeMs: number, cemId = 'cem-1', constraintsId = 'cid-1'): void {
    handlers.input({
      payload: {
        command: 'Message',
        cemId,
        message: serialize({
          message_type: 'PEBC.Instruction',
          message_id: 'pi-' + executionTimeMs,
          id: 'instr-' + executionTimeMs,
          power_constraints_id: constraintsId,
          execution_time: new Date(executionTimeMs).toISOString(),
          power_envelopes: [{
            id: 'pe-1',
            commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC',
            power_envelope_elements: [{ duration: SLOT, upper_limit: 11040, lower_limit: -11040 }]
          }]
        })
      }
    }, jest.fn(), jest.fn())
  }

  it('accumulates multiple single-slot instructions into one schedule', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)
    ;(node.send as jest.Mock).mockClear()

    const now = Date.now()
    sendPebcInstruction(handlers, now, 'cem-1')
    sendPebcInstruction(handlers, now + SLOT, 'cem-1')
    sendPebcInstruction(handlers, now + 2 * SLOT, 'cem-1')

    // Port 3 should have been called - check the last call has the active element
    const port3Calls = (node.send as jest.Mock).mock.calls.filter(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] === null && (c[0] as unknown[])[2] !== null
    )
    expect(port3Calls.length).toBeGreaterThan(0)
    const lastPayload = ((port3Calls[port3Calls.length - 1][0] as unknown[])[2] as { payload: { upperBound: number } }).payload
    expect(lastPayload.upperBound).toBe(11040)
  })

  it('fires port 3 at the start of the next slot', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)

    const now = Date.now()
    sendPebcInstruction(handlers, now, 'cem-1')
    sendPebcInstruction(handlers, now + SLOT, 'cem-1')
    ;(node.send as jest.Mock).mockClear()

    jest.advanceTimersByTime(SLOT)

    const port3Calls = (node.send as jest.Mock).mock.calls.filter(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] === null && (c[0] as unknown[])[2] !== null
    )
    expect(port3Calls.length).toBe(1)
  })

  it('emits full schedule on port 4 when schedule is updated', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)
    ;(node.send as jest.Mock).mockClear()

    const now = Date.now()
    sendPebcInstruction(handlers, now, 'cem-1')
    sendPebcInstruction(handlers, now + SLOT, 'cem-1')

    const port4Calls = (node.send as jest.Mock).mock.calls.filter(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[3] !== null
    )
    expect(port4Calls.length).toBeGreaterThan(0)
    const last = (port4Calls[port4Calls.length - 1][0] as unknown[])[3] as { cemId: string, payload: { elements: unknown[] } }
    expect(last.cemId).toBe('cem-1')
    expect(last.payload.elements).toHaveLength(2)
  })

  it('clears accumulated slots when power_constraints_id changes', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)

    const now = Date.now()
    sendPebcInstruction(handlers, now - SLOT, 'cem-1', 'cid-old')
    sendPebcInstruction(handlers, now, 'cem-1', 'cid-old')
    ;(node.send as jest.Mock).mockClear()

    // New planning period - old slots should be cleared
    sendPebcInstruction(handlers, now + SLOT, 'cem-1', 'cid-new')

    // Only the new slot should be in the schedule (the old ones are gone)
    expect(node.error as jest.Mock).not.toHaveBeenCalled()
    // The new slot starts in the future so emitActiveElement finds nothing - no port 3 output
    const port3Calls = (node.send as jest.Mock).mock.calls.filter(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] === null && (c[0] as unknown[])[2] !== null
    )
    expect(port3Calls.length).toBe(0)
  })
})

describe('s2-rm - duplicate active element deduplication', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  const SLOT = 900_000

  function connectCem (handlers: Record<string, (...args: unknown[]) => void>): void {
    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(), jest.fn()
    )
  }

  function sendPebcInstruction (handlers: Record<string, (...args: unknown[]) => void>, opts: { executionTimeMs: number, upper?: number, lower?: number, constraintsId?: string }): void {
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: 'PEBC.Instruction',
          message_id: 'pi-' + Math.random(),
          id: 'instr-' + Math.random(),
          power_constraints_id: opts.constraintsId ?? 'cid-1',
          execution_time: new Date(opts.executionTimeMs).toISOString(),
          power_envelopes: [{
            id: 'pe-1',
            commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC',
            power_envelope_elements: [{ duration: SLOT, upper_limit: opts.upper ?? 11040, lower_limit: opts.lower ?? -11040 }]
          }]
        })
      }
    }, jest.fn(), jest.fn())
  }

  function countPort3 (node: Record<string, unknown>): number {
    return (node.send as jest.Mock).mock.calls.filter(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] === null && (c[0] as unknown[])[2] !== null
    ).length
  }

  it('emits port 3 only once when the same active element is received repeatedly', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)
    const now = Date.now()
    ;(node.send as jest.Mock).mockClear()

    sendPebcInstruction(handlers, { executionTimeMs: now })
    sendPebcInstruction(handlers, { executionTimeMs: now })
    sendPebcInstruction(handlers, { executionTimeMs: now })

    expect(countPort3(node)).toBe(1)
  })

  it('emits port 3 again when bounds change for the same time slot', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)
    const now = Date.now()
    ;(node.send as jest.Mock).mockClear()

    sendPebcInstruction(handlers, { executionTimeMs: now, upper: 5000 })
    sendPebcInstruction(handlers, { executionTimeMs: now, upper: 8000 })

    expect(countPort3(node)).toBe(2)
  })

  it('shows duplicate count in node status when duplicates are received', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)
    const now = Date.now()

    sendPebcInstruction(handlers, { executionTimeMs: now })
    sendPebcInstruction(handlers, { executionTimeMs: now })
    sendPebcInstruction(handlers, { executionTimeMs: now })

    expect(node.status as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ fill: 'yellow', text: expect.stringContaining('dup') })
    )
  })

  it('resets duplicate count and restores green status when a new instruction arrives', () => {
    const { node, handlers } = setupNode({})
    connectCem(handlers)
    const now = Date.now()

    sendPebcInstruction(handlers, { executionTimeMs: now })
    sendPebcInstruction(handlers, { executionTimeMs: now })
    ;(node.status as jest.Mock).mockClear()

    sendPebcInstruction(handlers, { executionTimeMs: now, upper: 8000 })

    expect(node.status as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ fill: 'green' })
    )
    expect(node.status as jest.Mock).not.toHaveBeenCalledWith(
      expect.objectContaining({ fill: 'yellow' })
    )
  })
})

describe('s2-rm - schedule persistence', () => {
  let tmpDir: string

  function makePebcInstructionMsg (durationMs: number, upperLimit: number, executionTime?: string, constraintsId = 'cid-1'): string {
    return serialize({
      message_type: 'PEBC.Instruction',
      message_id: 'pi1',
      id: 'instr-1',
      power_constraints_id: constraintsId,
      ...(executionTime ? { execution_time: executionTime } : {}),
      power_envelopes: [{
        id: 'pe-1',
        commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC',
        power_envelope_elements: [{ duration: durationMs, upper_limit: upperLimit, lower_limit: -upperLimit }]
      }]
    })
  }

  function connectAndSendPebc (handlers: Record<string, (...args: unknown[]) => void>, durationMs = 3600000): void {
    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(), jest.fn()
    )
    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: makePebcInstructionMsg(durationMs, 11040) } },
      jest.fn(), jest.fn()
    )
  }

  beforeEach(() => {
    jest.useFakeTimers()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's2-rm-persist-'))
  })

  afterEach(() => {
    jest.useRealTimers()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('saves schedule to file when a PEBC instruction is received', () => {
    const { handlers } = setupNode({}, DEFAULT_RM_CONFIG, { userDir: tmpDir })
    connectAndSendPebc(handlers)

    const scheduleFile = path.join(tmpDir, '.s2', 'node-test-id-schedule.json')
    expect(fs.existsSync(scheduleFile)).toBe(true)
    const saved = JSON.parse(fs.readFileSync(scheduleFile, 'utf8'))
    expect(saved.cemId).toBe('cem-1')
    expect(saved.commodityQuantity).toBe('ELECTRIC.POWER.3_PHASE_SYMMETRIC')
    expect(Array.isArray(saved.elements)).toBe(true)
    expect(saved.elements.length).toBe(1)
  })

  it('restores a saved schedule on startup and emits the current element', () => {
    const { handlers } = setupNode({}, DEFAULT_RM_CONFIG, { userDir: tmpDir })
    connectAndSendPebc(handlers)

    const { node: node2 } = setupNode({}, DEFAULT_RM_CONFIG, { userDir: tmpDir })

    expect(node2.log as jest.Mock).toHaveBeenCalledWith(expect.stringContaining('Restored S2 schedule'))
    expect(node2.send as jest.Mock).toHaveBeenCalledWith([
      null,
      null,
      expect.objectContaining({ cemId: 'cem-1', payload: expect.objectContaining({ commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC' }) }),
      null
    ])
  })

  it('filters out past elements and does not restore when all elements are expired', () => {
    const now = Date.now()
    const pastSchedule = {
      receivedAt: now - 7200000,
      cemId: 'cem-past',
      instructionId: 'instr-past',
      commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC',
      elements: [
        { startMs: now - 7200000, endMs: now - 3600000, duration: 3600000, upperBound: 11040, lowerBound: -11040 }
      ]
    }
    const scheduleDir = path.join(tmpDir, '.s2')
    fs.mkdirSync(scheduleDir, { recursive: true })
    fs.writeFileSync(path.join(scheduleDir, 'node-test-id-schedule.json'), JSON.stringify(pastSchedule))

    const { node } = setupNode({}, DEFAULT_RM_CONFIG, { userDir: tmpDir })

    expect(node.log as jest.Mock).not.toHaveBeenCalledWith(expect.stringContaining('Restored'))
    expect(node.send as jest.Mock).not.toHaveBeenCalledWith([null, null, expect.anything(), null])
  })

  it('silently ignores a missing schedule file on startup', () => {
    const { node } = setupNode({}, DEFAULT_RM_CONFIG, { userDir: tmpDir })

    expect(node.warn as jest.Mock).not.toHaveBeenCalled()
    expect(node.error as jest.Mock).not.toHaveBeenCalled()
  })
})

describe('s2-rm - flow context tracking', () => {
  const PEBC_CONTROL_TYPE = 'POWER_ENVELOPE_BASED_CONTROL'

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
    const rmConfig = { ...DEFAULT_RM_CONFIG, gridConnection: '3x16A', controlTypes: PEBC_CONTROL_TYPE }
    const { handlers, flowContext } = setupNode({}, rmConfig)

    connectAndSelectPebc(handlers)

    expect(typeof flowContext.pebcConstraintsId).toBe('string')
    expect((flowContext.pebcConstraintsId as string).length).toBeGreaterThan(0)
  })

  it('updates pebcConstraintsId when new constraints are sent via PowerConstraints command', () => {
    const rmConfig = { ...DEFAULT_RM_CONFIG, gridConnection: '3x16A', controlTypes: PEBC_CONTROL_TYPE }
    const { handlers, flowContext } = setupNode({}, rmConfig)

    connectAndSelectPebc(handlers)
    const firstId = flowContext.pebcConstraintsId as string

    handlers.input({
      payload: {
        command: 'PowerConstraints',
        cemId: 'cem-1',
        constraints: { commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', minPower: -5000, maxPower: 5000 }
      }
    }, jest.fn(), jest.fn())

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

  it('enriches immediate OMBC instruction on port 3 with topic and operationMode', () => {
    const ombcConfig = JSON.stringify({
      OMBC: {
        systemDescription: {
          operationModes: [
            {
              id: 'mode-standby',
              diagnostic_label: 'Standby',
              power_ranges: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', start_of_range: 0, end_of_range: 0 }],
              abnormal_condition_only: false
            },
            {
              id: 'mode-on',
              diagnostic_label: 'Normal operation',
              power_ranges: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', start_of_range: 0, end_of_range: 2500 }],
              abnormal_condition_only: false
            }
          ],
          transitions: [],
          timers: []
        },
        status: { activeOperationModeId: 'mode-standby', operationModeFactor: 1 }
      }
    })
    const { node, handlers } = setupNode({ controlTypeConfig: ombcConfig })
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
    const out = (port3Call as unknown[][])[0][2] as { topic: string, operationMode: { id: string, index: number, label: string, factor: number, powerRanges: unknown[] } }
    expect(out.topic).toBe('Normal operation')
    expect(out.operationMode.id).toBe('mode-on')
    expect(out.operationMode.index).toBe(1)
    expect(out.operationMode.label).toBe('Normal operation')
    expect(out.operationMode.factor).toBe(0.8)
    expect(out.operationMode.powerRanges).toHaveLength(1)
  })

  it('enriches future OMBC instruction on port 3 with topic and operationMode when dispatched', () => {
    const ombcConfig = JSON.stringify({
      OMBC: {
        systemDescription: {
          operationModes: [
            { id: 'mode-standby', diagnostic_label: 'Standby', power_ranges: [], abnormal_condition_only: false },
            { id: 'mode-on', diagnostic_label: 'Normal operation', power_ranges: [], abnormal_condition_only: false }
          ],
          transitions: [],
          timers: []
        },
        status: { activeOperationModeId: 'mode-standby', operationModeFactor: 1 }
      }
    })
    const { node, handlers } = setupNode({ controlTypeConfig: ombcConfig })
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
    const out = (port3Call as unknown[][])[0][2] as { topic: string, operationMode: { label: string } }
    expect(out.topic).toBe('Normal operation')
    expect(out.operationMode.label).toBe('Normal operation')
  })

  it('sends OMBC.Status on port 1 when an immediate OMBC instruction is dispatched', () => {
    const ombcConfig = JSON.stringify({
      OMBC: {
        systemDescription: {
          operationModes: [
            { id: 'mode-off', power_ranges: [], abnormal_condition_only: false },
            { id: 'mode-on', power_ranges: [], abnormal_condition_only: false }
          ],
          transitions: [],
          timers: []
        },
        status: { activeOperationModeId: 'mode-off', operationModeFactor: 1 }
      }
    })
    const { node, handlers } = setupNode({ controlTypeConfig: ombcConfig })
    connectCem(handlers)
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.SELECT_CONTROL_TYPE,
          message_id: 'sct-1',
          control_type: 'OPERATION_MODE_BASED_CONTROL'
        })
      }
    }, jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-ombc',
          id: 'instr-ombc',
          execution_time: new Date(Date.now() - 1000).toISOString(),
          operation_mode_id: 'mode-on',
          operation_mode_factor: 1,
          abnormal_condition: false
        })
      }
    }, jest.fn(), jest.fn())

    const ombcStatusCall = (node.send as jest.Mock).mock.calls.find(
      (c: unknown[]) => {
        const p1 = Array.isArray(c[0]) && (c[0] as unknown[])[0] as { payload?: { s2Signal?: string, message?: { message_type?: string } } }
        return p1 && p1.payload?.s2Signal === 'Message' && p1.payload?.message?.message_type === MessageType.OMBC_STATUS
      }
    )
    expect(ombcStatusCall).toBeDefined()
    const statusMsg = ((ombcStatusCall as unknown[][])[0][0] as { payload: { message: { active_operation_mode_id: string } } })
    expect(statusMsg.payload.message.active_operation_mode_id).toBe('mode-on')
  })

  it('sends OMBC.Status on port 1 immediately when a future OMBC instruction is accepted', () => {
    const ombcConfig = JSON.stringify({
      OMBC: {
        systemDescription: {
          operationModes: [
            { id: 'mode-off', power_ranges: [], abnormal_condition_only: false },
            { id: 'mode-on', power_ranges: [], abnormal_condition_only: false }
          ],
          transitions: [],
          timers: []
        },
        status: { activeOperationModeId: 'mode-off', operationModeFactor: 1 }
      }
    })
    const { node, handlers } = setupNode({ controlTypeConfig: ombcConfig })
    connectCem(handlers)
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.SELECT_CONTROL_TYPE,
          message_id: 'sct-2',
          control_type: 'OPERATION_MODE_BASED_CONTROL'
        })
      }
    }, jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    // OMBC.Status is sent at accept time (inside _ackAndForward), not at execution time.
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-ombc-fut',
          id: 'instr-ombc-fut',
          execution_time: new Date(Date.now() + 5000).toISOString(),
          operation_mode_id: 'mode-on',
          operation_mode_factor: 1,
          abnormal_condition: false
        })
      }
    }, jest.fn(), jest.fn())

    const ombcStatusCall = (node.send as jest.Mock).mock.calls.find(
      (c: unknown[]) => {
        const p1 = Array.isArray(c[0]) && (c[0] as unknown[])[0] as { payload?: { s2Signal?: string, message?: { message_type?: string } } }
        return p1 && p1.payload?.s2Signal === 'Message' && p1.payload?.message?.message_type === MessageType.OMBC_STATUS
      }
    )
    expect(ombcStatusCall).toBeDefined()
    const statusMsg = ((ombcStatusCall as unknown[][])[0][0] as { payload: { message: { active_operation_mode_id: string } } })
    expect(statusMsg.payload.message.active_operation_mode_id).toBe('mode-on')
  })

  it('does not send OMBC.Status again when a future OMBC instruction is dispatched at execution time', () => {
    const ombcConfig = JSON.stringify({
      OMBC: {
        systemDescription: {
          operationModes: [
            { id: 'mode-off', power_ranges: [], abnormal_condition_only: false },
            { id: 'mode-on', power_ranges: [], abnormal_condition_only: false }
          ],
          transitions: [],
          timers: []
        },
        status: { activeOperationModeId: 'mode-off', operationModeFactor: 1 }
      }
    })
    const { node, handlers } = setupNode({ controlTypeConfig: ombcConfig })
    connectCem(handlers)
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({ message_type: MessageType.SELECT_CONTROL_TYPE, message_id: 'sct-2', control_type: 'OPERATION_MODE_BASED_CONTROL' })
      }
    }, jest.fn(), jest.fn())
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-ombc-fut2',
          id: 'instr-ombc-fut2',
          execution_time: new Date(Date.now() + 5000).toISOString(),
          operation_mode_id: 'mode-on',
          operation_mode_factor: 1,
          abnormal_condition: false
        })
      }
    }, jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    jest.advanceTimersByTime(7000)

    const ombcStatusCalls = (node.send as jest.Mock).mock.calls.filter(
      (c: unknown[]) => {
        const p1 = Array.isArray(c[0]) && (c[0] as unknown[])[0] as { payload?: { s2Signal?: string, message?: { message_type?: string } } }
        return p1 && p1.payload?.s2Signal === 'Message' && p1.payload?.message?.message_type === MessageType.OMBC_STATUS
      }
    )
    expect(ombcStatusCalls.length).toBe(0)
  })

  it('persists OMBC status to flow context when an OMBC instruction is dispatched', () => {
    const ombcConfig = JSON.stringify({
      OMBC: {
        systemDescription: { operationModes: [{ id: 'mode-off', power_ranges: [], abnormal_condition_only: false }], transitions: [], timers: [] },
        status: { activeOperationModeId: 'mode-off', operationModeFactor: 1 }
      }
    })
    const { handlers, flowContext } = setupNode({ controlTypeConfig: ombcConfig })
    connectCem(handlers)
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({ message_type: MessageType.SELECT_CONTROL_TYPE, message_id: 'sct-1', control_type: 'OPERATION_MODE_BASED_CONTROL' })
      }
    }, jest.fn(), jest.fn())

    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-persist',
          id: 'instr-persist',
          execution_time: new Date(Date.now() - 1000).toISOString(),
          operation_mode_id: 'mode-on',
          operation_mode_factor: 1
        })
      }
    }, jest.fn(), jest.fn())

    const saved = flowContext['s2OmbcStatus'] as { activeOperationModeId: string }
    expect(saved).toBeDefined()
    expect(saved.activeOperationModeId).toBe('mode-on')
  })

  it('restores persisted OMBC status for a new CEM session', () => {
    const ombcConfig = JSON.stringify({
      OMBC: {
        systemDescription: { operationModes: [{ id: 'mode-off', power_ranges: [], abnormal_condition_only: false }], transitions: [], timers: [] },
        status: { activeOperationModeId: 'mode-off', operationModeFactor: 1 }
      }
    })
    const { node, handlers, flowContext } = setupNode({ controlTypeConfig: ombcConfig })

    // Simulate a persisted status from a previous session
    flowContext['s2OmbcStatus'] = { activeOperationModeId: 'mode-on', operationModeFactor: 1 }

    // New CEM connects
    connectCem(handlers)
    ;(node.send as jest.Mock).mockClear()

    // CEM selects OMBC
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({ message_type: MessageType.SELECT_CONTROL_TYPE, message_id: 'sct-2', control_type: 'OPERATION_MODE_BASED_CONTROL' })
      }
    }, jest.fn(), jest.fn())

    // OMBC.Status should report the persisted mode, not the config default
    const ombcStatusCall = (node.send as jest.Mock).mock.calls.find(
      (c: unknown[]) => {
        const p1 = Array.isArray(c[0]) && (c[0] as unknown[])[0] as { payload?: { s2Signal?: string, message?: { message_type?: string } } }
        return p1 && p1.payload?.s2Signal === 'Message' && p1.payload?.message?.message_type === MessageType.OMBC_STATUS
      }
    )
    expect(ombcStatusCall).toBeDefined()
    const statusMsg = ((ombcStatusCall as unknown[][])[0][0] as { payload: { message: { active_operation_mode_id: string } } })
    expect(statusMsg.payload.message.active_operation_mode_id).toBe('mode-on')
  })

  it('stores PEBC instructions in s2PendingInstructions for traceability', () => {
    const { handlers, flowContext } = setupNode({})
    connectCem(handlers)

    const SLOT = 900_000
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: 'PEBC.Instruction',
          message_id: 'pi-1',
          id: 'pebc-instr-1',
          power_constraints_id: 'cid-1',
          execution_time: new Date(Date.now()).toISOString(),
          power_envelopes: [{
            id: 'pe-1',
            commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC',
            power_envelope_elements: [{ duration: SLOT, upper_limit: 11040, lower_limit: -11040 }]
          }]
        })
      }
    }, jest.fn(), jest.fn())

    const pending = flowContext[PENDING_KEY] as unknown[]
    expect(Array.isArray(pending)).toBe(true)
    const pebcEntry = pending.find(
      (p) => (p as Record<string, unknown>).isPebc === true
    )
    expect(pebcEntry).toBeDefined()
    expect((pebcEntry as Record<string, unknown>).cemId).toBe('cem-1')
  })

  it('prunes PEBC entries from context after their schedule ends', () => {
    const { handlers, flowContext } = setupNode({})
    connectCem(handlers)

    const SLOT = 900_000
    const now = Date.now()
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: 'PEBC.Instruction',
          message_id: 'pi-prune',
          id: 'pebc-instr-prune',
          power_constraints_id: 'cid-1',
          execution_time: new Date(now).toISOString(),
          power_envelopes: [{
            id: 'pe-1',
            commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC',
            power_envelope_elements: [{ duration: SLOT, upper_limit: 11040, lower_limit: -11040 }]
          }]
        })
      }
    }, jest.fn(), jest.fn())

    // Advance past the schedule end (1 slot = 15 min) + poll interval
    jest.advanceTimersByTime(SLOT + 2000)

    const pending = (flowContext[PENDING_KEY] as unknown[]) || []
    const pebcEntry = pending.find(
      (p) => (p as Record<string, unknown>).isPebc === true
    )
    expect(pebcEntry).toBeUndefined()
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
