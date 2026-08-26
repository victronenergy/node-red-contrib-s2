import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import registerNode from '../../src/nodes/s2-pebc/index'

const DEFAULT_PEBC_CONFIG = { gridConnection: '' }

// Isolate each test's schedule persistence from the real ~/.node-red directory
// (and from other tests) - s2-pebc writes to <userDir>/.s2/<node.id>-schedule.json.
const createdTmpDirs: string[] = []
let nodeIdCounter = 0

afterEach(() => {
  for (const dir of createdTmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function setupNode (config: Record<string, unknown> = {}, pebcConfigNode: unknown = DEFAULT_PEBC_CONFIG, settings: Record<string, unknown> = {}) {
  if (!settings.userDir) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's2-pebc-test-'))
    createdTmpDirs.push(tmpDir)
    settings = { ...settings, userDir: tmpDir }
  }
  nodeIdCounter += 1
  const nodeId = (config.id as string | undefined) || `pebc-node-id-${nodeIdCounter}`
  const handlers: Record<string, (...args: unknown[]) => void> = {}
  const nodeContext: Record<string, unknown> = {}
  const flowContext: Record<string, unknown> = {}
  // A single stable context object, matching real Node-RED (node.context() always
  // returns the same instance) - required for flow.set/flow.get to share state.
  const contextObj = {
    get: jest.fn((key: string) => nodeContext[key]),
    set: jest.fn((key: string, value: unknown) => { nodeContext[key] = value }),
    flow: {
      get: jest.fn((key: string) => flowContext[key]),
      set: jest.fn((key: string, value: unknown) => { flowContext[key] = value })
    },
    global: { get: jest.fn(), set: jest.fn() }
  }
  const node: Record<string, unknown> = {
    id: nodeId,
    name: '',
    send: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
    status: jest.fn(),
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => { handlers[event] = handler }),
    context: jest.fn(() => contextObj)
  }

  const RED = {
    nodes: {
      createNode: jest.fn((n: Record<string, unknown>) => { Object.assign(n, node) }),
      registerType: jest.fn(),
      getNode: jest.fn(() => pebcConfigNode)
    },
    settings
  }

  let Constructor: ((this: Record<string, unknown>, config: Record<string, unknown>) => void) | null = null
  RED.nodes.registerType.mockImplementation((_type: string, ctor: (this: Record<string, unknown>, config: Record<string, unknown>) => void) => {
    Constructor = ctor
  })

  registerNode(RED as never)
  Constructor!.call(node, { pebcConfig: 'pebc-cfg-id', id: nodeId, ...config } as never)

  return { node, RED, handlers, nodeContext, flowContext }
}

const SLOT = 900_000

function pebcInstructionMsg (cemId: string, executionTimeMs: number, opts: { upper?: number, lower?: number, constraintsId?: string, instructionId?: string } = {}) {
  return {
    cemId,
    controlType: 'POWER_ENVELOPE_BASED_CONTROL',
    pebc: {
      message_type: 'PEBC.Instruction',
      message_id: 'pi-' + Math.random(),
      id: opts.instructionId ?? 'instr-' + executionTimeMs,
      power_constraints_id: opts.constraintsId ?? 'cid-1',
      execution_time: new Date(executionTimeMs).toISOString(),
      power_envelopes: [{
        id: 'pe-1',
        commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC',
        power_envelope_elements: [{ duration: SLOT, upper_limit: opts.upper ?? 11040, lower_limit: opts.lower ?? -11040 }]
      }]
    }
  }
}

function revokeMsg (cemId: string, objectId: string, objectType: string) {
  return { cemId, payload: { message_type: 'RevokeObject', message_id: 'rv-' + objectId, object_id: objectId, object_type: objectType } }
}

function activeCalls (node: Record<string, unknown>) {
  return (node.send as jest.Mock).mock.calls.filter(
    (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] !== null
  )
}

function scheduleCalls (node: Record<string, unknown>) {
  return (node.send as jest.Mock).mock.calls.filter(
    (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[1] !== null
  )
}

function commandCalls (node: Record<string, unknown>) {
  return (node.send as jest.Mock).mock.calls.filter(
    (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[2] !== null
  )
}

describe('s2-pebc - config node reference', () => {
  it('sets error status and does not register input handler when s2-pebc-config is missing', () => {
    const { node, handlers } = setupNode({}, null)

    expect(node.status as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({ fill: 'red' }))
    expect(node.error as jest.Mock).toHaveBeenCalled()
    expect(handlers.input).toBeUndefined()
  })
})

describe('s2-pebc - default power constraints push on deploy', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  it('pushes a PowerConstraints command derived from gridConnection', () => {
    const { node } = setupNode({}, { gridConnection: '3x25A' })

    jest.advanceTimersByTime(200)

    const call = commandCalls(node)[0]
    const cmd = ((call[0] as unknown[])[2] as { payload: Record<string, unknown> }).payload
    expect(cmd.command).toBe('PowerConstraints')
    expect((cmd.constraints as { minPower: number, maxPower: number }).minPower).toBe(-17250)
    expect((cmd.constraints as { minPower: number, maxPower: number }).maxPower).toBe(17250)
  })

  it('uses customMaxPowerW when gridConnection is custom', () => {
    const { node } = setupNode({}, { gridConnection: 'custom', customMaxPowerW: 15000 })

    jest.advanceTimersByTime(200)

    const call = commandCalls(node)[0]
    const cmd = ((call[0] as unknown[])[2] as { payload: Record<string, unknown> }).payload
    expect((cmd.constraints as { maxPower: number }).maxPower).toBe(15000)
  })

  it('does not push a command when gridConnection is not set', () => {
    const { node } = setupNode({}, { gridConnection: '' })

    jest.advanceTimersByTime(200)

    expect(commandCalls(node).length).toBe(0)
  })

  it('publishes the default max power to flow context as pebcDefaultMaxPowerW', () => {
    const { flowContext } = setupNode({}, { gridConnection: '3x25A' })

    expect(flowContext.pebcDefaultMaxPowerW).toBe(17250)
  })

  it('publishes null to pebcDefaultMaxPowerW when gridConnection is not set', () => {
    const { flowContext } = setupNode({}, { gridConnection: '' })

    expect(flowContext.pebcDefaultMaxPowerW).toBeNull()
  })

  it('publishes the fixed per-phase amp rating to flow context as pebcDefaultMaxAmpsPerPhase', () => {
    const { flowContext } = setupNode({}, { gridConnection: '3x25A' })

    expect(flowContext.pebcDefaultMaxAmpsPerPhase).toBe(25)
  })

  it('publishes null to pebcDefaultMaxAmpsPerPhase for a custom connection', () => {
    const { flowContext } = setupNode({}, { gridConnection: 'custom', customMaxPowerW: 15000 })

    expect(flowContext.pebcDefaultMaxAmpsPerPhase).toBeNull()
  })

  it('publishes null to pebcDefaultMaxAmpsPerPhase when gridConnection is not set', () => {
    const { flowContext } = setupNode({}, { gridConnection: '' })

    expect(flowContext.pebcDefaultMaxAmpsPerPhase).toBeNull()
  })
})

describe('s2-pebc - instruction accumulation', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  it('accumulates multiple single-slot instructions into one schedule', () => {
    const { node, handlers } = setupNode()
    const now = Date.now()

    handlers.input(pebcInstructionMsg('cem-1', now), jest.fn(), jest.fn())
    handlers.input(pebcInstructionMsg('cem-1', now + SLOT), jest.fn(), jest.fn())
    handlers.input(pebcInstructionMsg('cem-1', now + 2 * SLOT), jest.fn(), jest.fn())

    const calls = activeCalls(node)
    expect(calls.length).toBeGreaterThan(0)
    const lastPayload = ((calls[calls.length - 1][0] as unknown[])[0] as { payload: { upperBound: number } }).payload
    expect(lastPayload.upperBound).toBe(11040)
  })

  it('fires the active output at the start of the next slot', () => {
    const { node, handlers } = setupNode()
    const now = Date.now()

    handlers.input(pebcInstructionMsg('cem-1', now), jest.fn(), jest.fn())
    handlers.input(pebcInstructionMsg('cem-1', now + SLOT), jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    jest.advanceTimersByTime(SLOT)

    expect(activeCalls(node).length).toBe(1)
  })

  it('fires the active output when the only slot has a future execution_time', () => {
    const { node, handlers } = setupNode()
    const now = Date.now()

    handlers.input(pebcInstructionMsg('cem-1', now + SLOT), jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    // Nothing is active yet - this must still arm a timer for the slot's start.
    jest.advanceTimersByTime(SLOT)

    expect(activeCalls(node).length).toBe(1)
  })

  it('emits a released element when the only slot ends with nothing queued after it', () => {
    const { node, handlers } = setupNode()
    const now = Date.now()

    handlers.input(pebcInstructionMsg('cem-1', now), jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    jest.advanceTimersByTime(SLOT)

    const call = activeCalls(node)[0]
    const outMsg = (call[0] as unknown[])[0] as { cemId: string, payload: { lowerBound: number | null, upperBound: number | null, commodityQuantity: string } }
    expect(outMsg.cemId).toBe('cem-1')
    expect(outMsg.payload.lowerBound).toBeNull()
    expect(outMsg.payload.upperBound).toBeNull()
    expect(outMsg.payload.commodityQuantity).toBe('ELECTRIC.POWER.3_PHASE_SYMMETRIC')
  })

  it('emits the full schedule on output 2 when updated', () => {
    const { node, handlers } = setupNode()
    const now = Date.now()

    handlers.input(pebcInstructionMsg('cem-1', now), jest.fn(), jest.fn())
    handlers.input(pebcInstructionMsg('cem-1', now + SLOT), jest.fn(), jest.fn())

    const calls = scheduleCalls(node)
    expect(calls.length).toBeGreaterThan(0)
    const last = (calls[calls.length - 1][0] as unknown[])[1] as { cemId: string, payload: { elements: unknown[] } }
    expect(last.cemId).toBe('cem-1')
    expect(last.payload.elements).toHaveLength(2)
  })

  it('clears accumulated slots when power_constraints_id changes', () => {
    const { node, handlers } = setupNode()
    const now = Date.now()

    handlers.input(pebcInstructionMsg('cem-1', now - SLOT, { constraintsId: 'cid-old' }), jest.fn(), jest.fn())
    handlers.input(pebcInstructionMsg('cem-1', now, { constraintsId: 'cid-old' }), jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    handlers.input(pebcInstructionMsg('cem-1', now + SLOT, { constraintsId: 'cid-new' }), jest.fn(), jest.fn())

    // The new slot starts in the future - no active element to emit
    expect(activeCalls(node).length).toBe(0)
  })

  it('passes through a non-PEBC instruction unchanged and warns', () => {
    const { node, handlers } = setupNode()
    const original = { cemId: 'cem-1', controlType: 'OPERATION_MODE_BASED_CONTROL', ombc: { message_type: 'OMBC.Instruction', id: 'instr-1' }, payload: { message_type: 'OMBC.Instruction', id: 'instr-1' } }

    handlers.input(original, jest.fn(), jest.fn())

    expect(node.send as jest.Mock).toHaveBeenCalledWith([original, null, null])
    expect(node.status as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({ fill: 'yellow' }))
  })
})

describe('s2-pebc - duplicate active element deduplication', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  it('emits the active output only once when the same active element is received repeatedly', () => {
    const { node, handlers } = setupNode()
    const now = Date.now()

    handlers.input(pebcInstructionMsg('cem-1', now), jest.fn(), jest.fn())
    handlers.input(pebcInstructionMsg('cem-1', now), jest.fn(), jest.fn())
    handlers.input(pebcInstructionMsg('cem-1', now), jest.fn(), jest.fn())

    expect(activeCalls(node).length).toBe(1)
  })

  it('emits again when bounds change for the same time slot', () => {
    const { node, handlers } = setupNode()
    const now = Date.now()

    handlers.input(pebcInstructionMsg('cem-1', now, { upper: 5000 }), jest.fn(), jest.fn())
    handlers.input(pebcInstructionMsg('cem-1', now, { upper: 8000 }), jest.fn(), jest.fn())

    expect(activeCalls(node).length).toBe(2)
  })

  it('shows duplicate count in node status when duplicates are received', () => {
    const { node, handlers } = setupNode()
    const now = Date.now()

    handlers.input(pebcInstructionMsg('cem-1', now), jest.fn(), jest.fn())
    handlers.input(pebcInstructionMsg('cem-1', now), jest.fn(), jest.fn())
    handlers.input(pebcInstructionMsg('cem-1', now), jest.fn(), jest.fn())

    expect(node.status as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ fill: 'yellow', text: expect.stringContaining('dup') })
    )
  })
})

describe('s2-pebc - schedule persistence', () => {
  let tmpDir: string

  beforeEach(() => {
    jest.useFakeTimers()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's2-pebc-persist-'))
  })

  afterEach(() => {
    jest.useRealTimers()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('saves schedule to file when a PEBC instruction is received', () => {
    const { handlers } = setupNode({ id: 'persist-node' }, DEFAULT_PEBC_CONFIG, { userDir: tmpDir })
    handlers.input(pebcInstructionMsg('cem-1', Date.now()), jest.fn(), jest.fn())

    const scheduleFile = path.join(tmpDir, '.s2', 'persist-node-schedule.json')
    expect(fs.existsSync(scheduleFile)).toBe(true)
    const saved = JSON.parse(fs.readFileSync(scheduleFile, 'utf8'))
    expect(saved.cemId).toBe('cem-1')
    expect(saved.elements.length).toBe(1)
  })

  it('restores a saved schedule on startup and emits the current element', () => {
    const { handlers } = setupNode({ id: 'persist-node' }, DEFAULT_PEBC_CONFIG, { userDir: tmpDir })
    handlers.input(pebcInstructionMsg('cem-1', Date.now(), { instructionId: 'instr-restore' }), jest.fn(), jest.fn())

    const { node: node2 } = setupNode({ id: 'persist-node' }, DEFAULT_PEBC_CONFIG, { userDir: tmpDir })

    expect(node2.log as jest.Mock).toHaveBeenCalledWith(expect.stringContaining('Restored S2 schedule'))
    expect(activeCalls(node2).length).toBeGreaterThan(0)
  })

  it('reflects a restored schedule in node.status instead of "no schedule"', () => {
    const { handlers } = setupNode({ id: 'persist-node' }, DEFAULT_PEBC_CONFIG, { userDir: tmpDir })
    handlers.input(pebcInstructionMsg('cem-1', Date.now(), { instructionId: 'instr-restore-status' }), jest.fn(), jest.fn())

    const { node: node2 } = setupNode({ id: 'persist-node' }, DEFAULT_PEBC_CONFIG, { userDir: tmpDir })

    const statusCalls = (node2.status as jest.Mock).mock.calls.map(c => c[0] as { text: string })
    const lastStatus = statusCalls[statusCalls.length - 1]
    expect(lastStatus.text).not.toBe('no schedule')
    expect(lastStatus.text).toEqual(expect.stringContaining('active'))
  })

  it('filters out past elements and does not restore when all elements are expired', () => {
    const now = Date.now()
    const pastSchedule = {
      receivedAt: now - 7200000,
      cemId: 'cem-past',
      instructionId: 'instr-past',
      commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC',
      elements: [{ startMs: now - 7200000, endMs: now - 3600000, duration: 3600000, upperBound: 11040, lowerBound: -11040 }]
    }
    const scheduleDir = path.join(tmpDir, '.s2')
    fs.mkdirSync(scheduleDir, { recursive: true })
    fs.writeFileSync(path.join(scheduleDir, 'persist-node-schedule.json'), JSON.stringify(pastSchedule))

    const { node } = setupNode({ id: 'persist-node' }, DEFAULT_PEBC_CONFIG, { userDir: tmpDir })

    expect(node.log as jest.Mock).not.toHaveBeenCalledWith(expect.stringContaining('Restored'))
    expect(activeCalls(node).length).toBe(0)
  })

  it('silently ignores a missing schedule file on startup', () => {
    const { node } = setupNode({ id: 'persist-node' }, DEFAULT_PEBC_CONFIG, { userDir: tmpDir })

    expect(node.warn as jest.Mock).not.toHaveBeenCalled()
    expect(node.error as jest.Mock).not.toHaveBeenCalled()
  })
})

describe('s2-pebc - RevokeObject handling', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  it('clears the schedule and sends InstructionStatus(REVOKED) when the only instruction is revoked', () => {
    const { node, handlers } = setupNode()
    handlers.input(pebcInstructionMsg('cem-1', Date.now(), { instructionId: 'pebc-instr-1' }), jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    handlers.input(revokeMsg('cem-1', 'pebc-instr-1', 'PEBC.Instruction'), jest.fn(), jest.fn())

    const cmdCall = commandCalls(node)[0]
    const cmd = ((cmdCall[0] as unknown[])[2] as { payload: Record<string, unknown> }).payload
    expect(cmd.command).toBe('InstructionStatus')
    expect(cmd.instructionId).toBe('pebc-instr-1')
    expect(cmd.status).toBe('REVOKED')

    ;(node.send as jest.Mock).mockClear()
    jest.advanceTimersByTime(SLOT * 2)
    expect(activeCalls(node).length).toBe(0)
  })

  it('emits a released element (null/null bounds) on output 1 when the last instruction is revoked', () => {
    const { node, handlers } = setupNode()
    handlers.input(pebcInstructionMsg('cem-1', Date.now(), { instructionId: 'pebc-instr-1' }), jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    handlers.input(revokeMsg('cem-1', 'pebc-instr-1', 'PEBC.Instruction'), jest.fn(), jest.fn())

    const call = activeCalls(node)[0]
    const outMsg = (call[0] as unknown[])[0] as { cemId: string, payload: { lowerBound: number | null, upperBound: number | null, commodityQuantity: string } }
    expect(outMsg.cemId).toBe('cem-1')
    expect(outMsg.payload.lowerBound).toBeNull()
    expect(outMsg.payload.upperBound).toBeNull()
    expect(outMsg.payload.commodityQuantity).toBe('ELECTRIC.POWER.3_PHASE_SYMMETRIC')
  })

  it('is harmless when the revoked object_id does not match any accumulated slot', () => {
    const { node, handlers } = setupNode()

    handlers.input(revokeMsg('cem-1', 'no-such-id', 'PEBC.Instruction'), jest.fn(), jest.fn())

    expect(commandCalls(node).length).toBe(0)
    expect(node.error as jest.Mock).not.toHaveBeenCalled()
  })

  it('ignores a RevokeObject whose object_type is not an instruction', () => {
    const { node, handlers } = setupNode()
    handlers.input(pebcInstructionMsg('cem-1', Date.now(), { instructionId: 'pebc-instr-1' }), jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    handlers.input(revokeMsg('cem-1', 'pebc-instr-1', 'PEBC.PowerConstraints'), jest.fn(), jest.fn())

    expect(commandCalls(node).length).toBe(0)
  })

  it('emits a released element when the active instruction is revoked but a future one remains queued', () => {
    const { node, handlers } = setupNode()
    const now = Date.now()
    handlers.input(pebcInstructionMsg('cem-1', now, { instructionId: 'pebc-instr-active' }), jest.fn(), jest.fn())
    handlers.input(pebcInstructionMsg('cem-1', now + SLOT, { instructionId: 'pebc-instr-future' }), jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    handlers.input(revokeMsg('cem-1', 'pebc-instr-active', 'PEBC.Instruction'), jest.fn(), jest.fn())

    const call = activeCalls(node)[0]
    const outMsg = (call[0] as unknown[])[0] as { payload: { lowerBound: number | null, upperBound: number | null } }
    expect(outMsg.payload.lowerBound).toBeNull()
    expect(outMsg.payload.upperBound).toBeNull()

    // The still-queued future instruction still dispatches normally once its own start arrives.
    ;(node.send as jest.Mock).mockClear()
    jest.advanceTimersByTime(SLOT)
    const laterCall = activeCalls(node)[0]
    const laterMsg = (laterCall[0] as unknown[])[0] as { payload: { upperBound: number } }
    expect(laterMsg.payload.upperBound).toBe(11040)
  })

  it('does not emit a released element when revoking a not-yet-active instruction while another is currently active', () => {
    const { node, handlers } = setupNode()
    const now = Date.now()
    handlers.input(pebcInstructionMsg('cem-1', now, { instructionId: 'pebc-instr-active' }), jest.fn(), jest.fn())
    handlers.input(pebcInstructionMsg('cem-1', now + SLOT, { instructionId: 'pebc-instr-future' }), jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    handlers.input(revokeMsg('cem-1', 'pebc-instr-future', 'PEBC.Instruction'), jest.fn(), jest.fn())

    expect(activeCalls(node).length).toBe(0)
  })
})

describe('s2-pebc - InstructionStatus(STARTED) on dispatch', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  it('sends InstructionStatus(STARTED) via output 3 when the active element is dispatched', () => {
    const { node, handlers } = setupNode()

    handlers.input(pebcInstructionMsg('cem-1', Date.now(), { instructionId: 'pebc-instr-started' }), jest.fn(), jest.fn())

    const cmdCall = commandCalls(node).find((c) => {
      const cmd = ((c[0] as unknown[])[2] as { payload: Record<string, unknown> }).payload
      return cmd.command === 'InstructionStatus' && cmd.status === 'STARTED'
    })
    expect(cmdCall).toBeDefined()
    const cmd = ((cmdCall as unknown[][])[0][2] as { payload: Record<string, unknown> }).payload
    expect(cmd.cemId).toBe('cem-1')
    expect(cmd.instructionId).toBe('pebc-instr-started')
  })
})

describe('s2-pebc - InstructionStatus(SUCCEEDED) on natural completion', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  function succeededCommand (node: Record<string, unknown>, instructionId: string) {
    return commandCalls(node).find((c) => {
      const cmd = ((c[0] as unknown[])[2] as { payload: Record<string, unknown> }).payload
      return cmd.command === 'InstructionStatus' && cmd.status === 'SUCCEEDED' && cmd.instructionId === instructionId
    })
  }

  it('sends InstructionStatus(SUCCEEDED) once a single-slot instruction elapses with nothing queued after it', () => {
    const { node, handlers } = setupNode()
    const now = Date.now()
    handlers.input(pebcInstructionMsg('cem-1', now, { instructionId: 'pebc-instr-done' }), jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    jest.advanceTimersByTime(SLOT + 1)

    const cmdCall = succeededCommand(node, 'pebc-instr-done')
    expect(cmdCall).toBeDefined()
    const cmd = ((cmdCall as unknown[][])[0][2] as { payload: Record<string, unknown> }).payload
    expect(cmd.cemId).toBe('cem-1')
  })

  it('sends InstructionStatus(SUCCEEDED) for the completed instruction when a later instruction takes over', () => {
    const { node, handlers } = setupNode()
    const now = Date.now()
    handlers.input(pebcInstructionMsg('cem-1', now, { instructionId: 'pebc-instr-first' }), jest.fn(), jest.fn())
    handlers.input(pebcInstructionMsg('cem-1', now + SLOT, { instructionId: 'pebc-instr-second' }), jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    jest.advanceTimersByTime(SLOT + 1)

    expect(succeededCommand(node, 'pebc-instr-first')).toBeDefined()
    expect(succeededCommand(node, 'pebc-instr-second')).toBeUndefined()
  })

  it('does not send SUCCEEDED until every slot of a multi-slot instruction has elapsed', () => {
    const { node, handlers } = setupNode()
    const now = Date.now()
    handlers.input(pebcInstructionMsg('cem-1', now, { instructionId: 'pebc-instr-multi' }), jest.fn(), jest.fn())
    handlers.input(pebcInstructionMsg('cem-1', now + SLOT, { instructionId: 'pebc-instr-multi' }), jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    jest.advanceTimersByTime(SLOT + 1)
    expect(succeededCommand(node, 'pebc-instr-multi')).toBeUndefined()

    jest.advanceTimersByTime(SLOT)
    const cmdCall = succeededCommand(node, 'pebc-instr-multi')
    expect(cmdCall).toBeDefined()
  })

  it('does not send SUCCEEDED for an instruction that was already revoked', () => {
    const { node, handlers } = setupNode()
    const now = Date.now()
    handlers.input(pebcInstructionMsg('cem-1', now, { instructionId: 'pebc-instr-revoked' }), jest.fn(), jest.fn())
    handlers.input(revokeMsg('cem-1', 'pebc-instr-revoked', 'PEBC.Instruction'), jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    jest.advanceTimersByTime(SLOT + 1)

    expect(succeededCommand(node, 'pebc-instr-revoked')).toBeUndefined()
  })
})

describe('s2-pebc - Forecast capping', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  function forecastMsg (cemId: string, startTimeMs: number, valueExpected: number) {
    return {
      cemId,
      payload: {
        command: 'Forecast',
        cemId,
        forecast: {
          startTime: new Date(startTimeMs).toISOString(),
          elements: [{
            duration: SLOT,
            power_values: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value_expected: valueExpected }]
          }]
        }
      }
    }
  }

  it('caps the forecast to the accumulated PEBC schedule and forwards it on output 3', () => {
    const { node, handlers } = setupNode()
    const now = Date.now()

    handlers.input(pebcInstructionMsg('cem-1', now, { upper: 8000, lower: -8000 }), jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    handlers.input(forecastMsg('cem-1', now, 10000), jest.fn(), jest.fn())

    const cmdCall = commandCalls(node)[0]
    const outMsg = (cmdCall[0] as unknown[])[2] as { payload: { command: string, forecast: { elements: Array<{ power_values: Array<{ value_expected: number }> }> } } }
    expect(outMsg.payload.command).toBe('Forecast')
    expect(outMsg.payload.forecast.elements[0].power_values[0].value_expected).toBe(8000)
  })

  it('passes the forecast through unchanged when there is no accumulated schedule', () => {
    const { node, handlers } = setupNode()

    handlers.input(forecastMsg('cem-1', Date.now(), 10000), jest.fn(), jest.fn())

    const cmdCall = commandCalls(node)[0]
    const outMsg = (cmdCall[0] as unknown[])[2] as { payload: { forecast: { elements: Array<{ power_values: Array<{ value_expected: number }> }> } } }
    expect(outMsg.payload.forecast.elements[0].power_values[0].value_expected).toBe(10000)
  })
})

describe('s2-pebc - direction-aware limiting', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  function powerMeasurementMsg (value: number, commodityQuantity = 'ELECTRIC.POWER.3_PHASE_SYMMETRIC') {
    return { payload: { command: 'PowerMeasurement', cemId: 'cem', values: [{ commodity_quantity: commodityQuantity, value }] } }
  }

  function activePayload (node: Record<string, unknown>, index = 0) {
    return ((activeCalls(node)[index][0] as unknown[])[0] as { payload: Record<string, unknown> }).payload
  }

  it('defaults to import direction with limitW = upperBound when no measurement has been observed', () => {
    const { node, handlers } = setupNode()

    handlers.input(pebcInstructionMsg('cem-1', Date.now(), { upper: 8000, lower: -2000 }), jest.fn(), jest.fn())

    const payload = activePayload(node)
    expect(payload.direction).toBe('import')
    expect(payload.limitW).toBe(8000)
  })

  it('resolves export direction with limitW = |lowerBound| when the last measurement is negative', () => {
    const { node, handlers } = setupNode()

    handlers.input(powerMeasurementMsg(-500), jest.fn(), jest.fn())
    handlers.input(pebcInstructionMsg('cem-1', Date.now(), { upper: 8000, lower: -2000 }), jest.fn(), jest.fn())

    const payload = activePayload(node)
    expect(payload.direction).toBe('export')
    expect(payload.limitW).toBe(2000)
  })

  it('has limitW null on the released element regardless of direction', () => {
    const { node, handlers } = setupNode()
    handlers.input(pebcInstructionMsg('cem-1', Date.now(), { instructionId: 'pebc-instr-1' }), jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    handlers.input(revokeMsg('cem-1', 'pebc-instr-1', 'PEBC.Instruction'), jest.fn(), jest.fn())

    const payload = activePayload(node)
    expect(payload.lowerBound).toBeNull()
    expect(payload.upperBound).toBeNull()
    expect(payload.limitW).toBeNull()
  })

  it('re-emits the active element on output 1 only when a measurement flips direction on an asymmetric bound', () => {
    const { node, handlers } = setupNode()
    handlers.input(pebcInstructionMsg('cem-1', Date.now(), { upper: 8000, lower: -2000 }), jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    handlers.input(powerMeasurementMsg(-500), jest.fn(), jest.fn())

    expect(activeCalls(node).length).toBe(1)
    const payload = activePayload(node)
    expect(payload.direction).toBe('export')
    expect(payload.limitW).toBe(2000)
    expect(commandCalls(node).length).toBe(0)
  })

  it('does not re-emit when import and export limits are equal (symmetric bounds)', () => {
    const { node, handlers } = setupNode()
    handlers.input(pebcInstructionMsg('cem-1', Date.now(), { upper: 8000, lower: -8000 }), jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    handlers.input(powerMeasurementMsg(-500), jest.fn(), jest.fn())

    expect(activeCalls(node).length).toBe(0)
  })
})
