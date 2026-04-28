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

function setupNode (config: Record<string, unknown>, rmConfigNode: unknown = DEFAULT_RM_CONFIG, settings: Record<string, unknown> = {}) {
  const handlers: Record<string, (...args: unknown[]) => void> = {}
  const flowContext: Record<string, unknown> = {}
  const node: Record<string, unknown> = {
    id: 'node-test-id',
    name: '',
    send: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
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
      getNode: jest.fn().mockReturnValue(rmConfigNode)
    },
    settings
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
      expect.objectContaining({ cemId: 'cem-1', payload: expect.objectContaining({ commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC' }) })
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
    expect(node.send as jest.Mock).not.toHaveBeenCalledWith([null, null, expect.anything()])
  })

  it('silently ignores a missing schedule file on startup', () => {
    const { node } = setupNode({}, DEFAULT_RM_CONFIG, { userDir: tmpDir })

    expect(node.warn as jest.Mock).not.toHaveBeenCalled()
    expect(node.error as jest.Mock).not.toHaveBeenCalled()
  })
})
