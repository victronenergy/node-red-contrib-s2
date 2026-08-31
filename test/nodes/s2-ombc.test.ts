import registerNode from '../../src/nodes/s2-ombc/index'

const DEFAULT_OMBC_CONFIG = {
  systemDescription: JSON.stringify({
    operationModes: [
      { id: 'mode-standby', diagnostic_label: 'Standby', power_ranges: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', start_of_range: 0, end_of_range: 0 }], abnormal_condition_only: false },
      { id: 'mode-on', diagnostic_label: 'Normal operation', power_ranges: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', start_of_range: 0, end_of_range: 2500 }], abnormal_condition_only: false }
    ],
    transitions: [],
    timers: []
  })
}

function setupNode (config: Record<string, unknown> = {}, ombcConfigNode: unknown = DEFAULT_OMBC_CONFIG) {
  const handlers: Record<string, (...args: unknown[]) => void> = {}
  const nodeContext: Record<string, unknown> = {}
  const node: Record<string, unknown> = {
    id: 'ombc-node-id',
    name: '',
    send: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
    status: jest.fn(),
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => { handlers[event] = handler }),
    context: jest.fn(() => ({
      get: jest.fn((key: string) => nodeContext[key]),
      set: jest.fn((key: string, value: unknown) => { nodeContext[key] = value }),
      flow: { get: jest.fn(), set: jest.fn() },
      global: { get: jest.fn(), set: jest.fn() }
    }))
  }

  const RED = {
    nodes: {
      createNode: jest.fn((n: Record<string, unknown>) => { Object.assign(n, node) }),
      registerType: jest.fn(),
      getNode: jest.fn(() => ombcConfigNode)
    },
    settings: {}
  }

  let Constructor: ((this: Record<string, unknown>, config: Record<string, unknown>) => void) | null = null
  RED.nodes.registerType.mockImplementation((_type: string, ctor: (this: Record<string, unknown>, config: Record<string, unknown>) => void) => {
    Constructor = ctor
  })

  registerNode(RED as never)
  Constructor!.call(node, { ombcConfig: 'ombc-cfg-id', ...config, id: 'ombc-node-id' } as never)

  return { node, RED, handlers, nodeContext }
}

function selectControlType (handlers: Record<string, (...args: unknown[]) => void>, cemId: string, controlType: string): void {
  handlers.input({
    cemId,
    payload: { message_type: 'SelectControlType', message_id: 'sct-1', control_type: controlType }
  }, jest.fn(), jest.fn())
}

function instructionMsg (cemId: string, instr: Record<string, unknown>) {
  return {
    cemId,
    payload: instr,
    topic: instr.message_type
  }
}

// Commands s2-ombc sends to s2-rm (output 2 - `[null, { payload: { command, ... } }]`).
function getCommandCalls (node: Record<string, unknown>): Array<Record<string, unknown>> {
  return (node.send as jest.Mock).mock.calls
    .filter((c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[1] !== null)
    .map((c) => (((c[0] as unknown[])[1]) as { payload: Record<string, unknown> }).payload)
}

describe('s2-ombc - config node reference', () => {
  it('sets error status and does not register input handler when s2-ombc-config is missing', () => {
    const { node, handlers } = setupNode({}, null)

    expect(node.status as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({ fill: 'red' }))
    expect(node.error as jest.Mock).toHaveBeenCalled()
    expect(handlers.input).toBeUndefined()
  })
})

describe('s2-ombc - system description push on control-type selection', () => {
  it('sends a SystemDescription command when OMBC is selected', () => {
    const { node, handlers } = setupNode()

    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')

    const call = (node.send as jest.Mock).mock.calls.find(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[1] !== null
    )
    expect(call).toBeDefined()
    const cmd = ((call as unknown[][])[0][1] as { payload: Record<string, unknown> }).payload
    expect(cmd.command).toBe('SystemDescription')
    expect(cmd.cemId).toBe('cem-1')
    expect(cmd.controlType).toBe('OPERATION_MODE_BASED_CONTROL')
    expect((cmd.ombc as { operationModes: unknown[] }).operationModes).toHaveLength(2)
  })

  it('does not send a SystemDescription command for a non-OMBC control type', () => {
    const { node, handlers } = setupNode()

    selectControlType(handlers, 'cem-1', 'POWER_ENVELOPE_BASED_CONTROL')

    const call = (node.send as jest.Mock).mock.calls.find(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[1] !== null
    )
    expect(call).toBeUndefined()
  })
})

describe('s2-ombc - instruction resolution', () => {
  it('resolves an OMBC instruction to a ModeInstruction on output 1', () => {
    const { node, handlers } = setupNode()

    handlers.input(instructionMsg('cem-1', {
      message_type: 'OMBC.Instruction',
      id: 'instr-1',
      operation_mode_id: 'mode-on',
      operation_mode_factor: 0.8
    }), jest.fn(), jest.fn())

    const call = (node.send as jest.Mock).mock.calls.find(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] !== null
    )
    expect(call).toBeDefined()
    const out = (call as unknown[][])[0][0] as { topic: string, payload: { id: string, index: number, label: string, factor: number, power: [number, number, number] }, cemId: string, rawMessage: unknown }
    expect(out.topic).toBe('ModeInstruction')
    expect(out.payload.id).toBe('mode-on')
    expect(out.payload.index).toBe(1)
    expect(out.payload.label).toBe('Normal operation')
    expect(out.payload.factor).toBe(0.8)
    expect(out.payload.power).toEqual([667, 667, 667])
    expect(out.cemId).toBe('cem-1')
    expect(out.rawMessage).toBeDefined()
  })

  it('calculates per-phase power from L1/L2/L3 power ranges', () => {
    const perPhaseConfig = {
      systemDescription: JSON.stringify({
        operationModes: [
          {
            id: 'mode-asym', diagnostic_label: 'Asymmetric', abnormal_condition_only: false,
            power_ranges: [
              { commodity_quantity: 'ELECTRIC.POWER.L1', start_of_range: 0, end_of_range: 3000 },
              { commodity_quantity: 'ELECTRIC.POWER.L2', start_of_range: 100, end_of_range: 2000 },
              { commodity_quantity: 'ELECTRIC.POWER.L3', start_of_range: 0, end_of_range: 1000 }
            ]
          }
        ],
        transitions: [], timers: []
      })
    }
    const { node, handlers } = setupNode({}, perPhaseConfig)

    handlers.input(instructionMsg('cem-1', {
      message_type: 'OMBC.Instruction',
      id: 'instr-3',
      operation_mode_id: 'mode-asym',
      operation_mode_factor: 0.5
    }), jest.fn(), jest.fn())

    const call = (node.send as jest.Mock).mock.calls.find(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] !== null
    )
    const out = (call as unknown[][])[0][0] as { payload: { power: [number, number, number] } }
    expect(out.payload.power).toEqual([1500, 1050, 500])
  })

  it('returns [0,0,0] when power_ranges is empty', () => {
    const cfg = {
      systemDescription: JSON.stringify({
        operationModes: [{ id: 'mode-empty', diagnostic_label: 'Empty', power_ranges: [], abnormal_condition_only: false }],
        transitions: [], timers: []
      })
    }
    const { node, handlers } = setupNode({}, cfg)
    handlers.input(instructionMsg('cem-1', {
      message_type: 'OMBC.Instruction', id: 'i1', operation_mode_id: 'mode-empty', operation_mode_factor: 1
    }), jest.fn(), jest.fn())
    const call = (node.send as jest.Mock).mock.calls.find((c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] !== null)
    const out = (call as unknown[][])[0][0] as { payload: { power: [number, number, number] } }
    expect(out.payload.power).toEqual([0, 0, 0])
  })

  it('treats missing per-phase commodity as 0', () => {
    const cfg = {
      systemDescription: JSON.stringify({
        operationModes: [{
          id: 'mode-l1-only', diagnostic_label: 'L1 only', abnormal_condition_only: false,
          power_ranges: [{ commodity_quantity: 'ELECTRIC.POWER.L1', start_of_range: 0, end_of_range: 1000 }]
        }],
        transitions: [], timers: []
      })
    }
    const { node, handlers } = setupNode({}, cfg)
    handlers.input(instructionMsg('cem-1', {
      message_type: 'OMBC.Instruction', id: 'i2', operation_mode_id: 'mode-l1-only', operation_mode_factor: 0.7
    }), jest.fn(), jest.fn())
    const call = (node.send as jest.Mock).mock.calls.find((c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] !== null)
    const out = (call as unknown[][])[0][0] as { payload: { power: [number, number, number] } }
    expect(out.payload.power).toEqual([700, 0, 0])
  })

  it('returns fixed power when start_of_range equals end_of_range', () => {
    const cfg = {
      systemDescription: JSON.stringify({
        operationModes: [{
          id: 'mode-fixed', diagnostic_label: 'Fixed', abnormal_condition_only: false,
          power_ranges: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', start_of_range: 1500, end_of_range: 1500 }]
        }],
        transitions: [], timers: []
      })
    }
    const { node, handlers } = setupNode({}, cfg)
    handlers.input(instructionMsg('cem-1', {
      message_type: 'OMBC.Instruction', id: 'i-fixed', operation_mode_id: 'mode-fixed', operation_mode_factor: 0.5
    }), jest.fn(), jest.fn())
    const call = (node.send as jest.Mock).mock.calls.find((c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] !== null)
    const out = (call as unknown[][])[0][0] as { payload: { power: [number, number, number] } }
    expect(out.payload.power).toEqual([500, 500, 500])
  })

  it('calculates symmetric power at factor 0 (start_of_range)', () => {
    const { node, handlers } = setupNode()
    handlers.input(instructionMsg('cem-1', {
      message_type: 'OMBC.Instruction', id: 'i3', operation_mode_id: 'mode-on', operation_mode_factor: 0
    }), jest.fn(), jest.fn())
    const call = (node.send as jest.Mock).mock.calls.find((c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] !== null)
    const out = (call as unknown[][])[0][0] as { payload: { power: [number, number, number] } }
    expect(out.payload.power).toEqual([0, 0, 0])
  })

  it('calculates symmetric power at factor 1 (end_of_range)', () => {
    const { node, handlers } = setupNode()
    handlers.input(instructionMsg('cem-1', {
      message_type: 'OMBC.Instruction', id: 'i4', operation_mode_id: 'mode-on', operation_mode_factor: 1
    }), jest.fn(), jest.fn())
    const call = (node.send as jest.Mock).mock.calls.find((c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] !== null)
    const out = (call as unknown[][])[0][0] as { payload: { power: [number, number, number] } }
    expect(out.payload.power).toEqual([833, 833, 833])
  })

  it('defaults factor to 1 when operation_mode_factor is absent', () => {
    const { node, handlers } = setupNode()
    handlers.input(instructionMsg('cem-1', {
      message_type: 'OMBC.Instruction', id: 'i5', operation_mode_id: 'mode-on'
    }), jest.fn(), jest.fn())
    const call = (node.send as jest.Mock).mock.calls.find((c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] !== null)
    const out = (call as unknown[][])[0][0] as { payload: { power: [number, number, number] } }
    expect(out.payload.power).toEqual([833, 833, 833])
  })

  it('ignores a non-OMBC instruction silently', () => {
    const { node, handlers } = setupNode()
    const done = jest.fn()
    handlers.input({ cemId: 'cem-1', payload: { message_type: 'PEBC.Instruction', id: 'instr-2' }, topic: 'PEBC.Instruction' }, jest.fn(), done)

    expect(node.send as jest.Mock).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalled()
  })
})

describe('s2-ombc - confirm mode', () => {
  function confirm (handlers: Record<string, (...args: unknown[]) => void>, cemId: string, modeId: string, factor?: number) {
    const done = jest.fn()
    handlers.input({
      cemId,
      payload: { confirmedOperationModeId: modeId, ...(factor !== undefined ? { operationModeFactor: factor } : {}) }
    }, jest.fn(), done)
    return done
  }

  it('sends an UpdateStatus command when OMBC is the selected control type', () => {
    const { node, handlers } = setupNode()
    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')
    ;(node.send as jest.Mock).mockClear()

    confirm(handlers, 'cem-1', 'mode-on', 1)

    const call = (node.send as jest.Mock).mock.calls.find(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[1] !== null
    )
    expect(call).toBeDefined()
    const cmd = ((call as unknown[][])[0][1] as { payload: Record<string, unknown> }).payload
    expect(cmd.command).toBe('UpdateStatus')
    expect(cmd.cemId).toBe('cem-1')
    expect((cmd.ombc as { activeOperationModeId: string }).activeOperationModeId).toBe('mode-on')
  })

  it('includes previousOperationModeId and transitionTimestamp when the mode changes', () => {
    const { node, handlers } = setupNode()
    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')
    confirm(handlers, 'cem-1', 'mode-standby')
    ;(node.send as jest.Mock).mockClear()

    confirm(handlers, 'cem-1', 'mode-on')

    const call = (node.send as jest.Mock).mock.calls.find(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[1] !== null
    )
    const cmd = ((call as unknown[][])[0][1] as { payload: { ombc: { previousOperationModeId?: string, transitionTimestamp?: string } } }).payload
    expect(cmd.ombc.previousOperationModeId).toBe('mode-standby')
    expect(cmd.ombc.transitionTimestamp).toBeDefined()
  })

  it('does not include previousOperationModeId when the mode stays the same', () => {
    const { node, handlers } = setupNode()
    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')
    confirm(handlers, 'cem-1', 'mode-on')
    ;(node.send as jest.Mock).mockClear()

    confirm(handlers, 'cem-1', 'mode-on')

    const call = (node.send as jest.Mock).mock.calls.find(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[1] !== null
    )
    const cmd = ((call as unknown[][])[0][1] as { payload: { ombc: { previousOperationModeId?: string } } }).payload
    expect(cmd.ombc.previousOperationModeId).toBeUndefined()
  })

  it('rejects a confirmation when OMBC is not the selected control type and warns', () => {
    const { node, handlers } = setupNode()
    selectControlType(handlers, 'cem-1', 'POWER_ENVELOPE_BASED_CONTROL')
    ;(node.send as jest.Mock).mockClear()

    confirm(handlers, 'cem-1', 'mode-on')

    const call = (node.send as jest.Mock).mock.calls.find(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[1] !== null
    )
    expect(call).toBeUndefined()
    expect(node.status as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({ fill: 'yellow' }))
  })

  it('rejects a confirmation when no control type has been selected yet', () => {
    const { node, handlers } = setupNode()

    confirm(handlers, 'cem-1', 'mode-on')

    const call = (node.send as jest.Mock).mock.calls.find(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[1] !== null
    )
    expect(call).toBeUndefined()
  })

  it('applies a confirm with no cemId to the one CEM currently on OMBC', () => {
    const { node, handlers } = setupNode()
    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')
    ;(node.send as jest.Mock).mockClear()

    const done = jest.fn()
    handlers.input({ payload: { confirmedOperationModeId: 'mode-on' } }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith()
    const cmd = getCommandCalls(node).find(c => c.command === 'UpdateStatus')
    expect(cmd).toBeDefined()
    expect(cmd!.cemId).toBe('cem-1')
  })

  it('stores a default when no cemId and no CEM has OMBC selected, then seeds a later CEM from it', () => {
    const { node, handlers } = setupNode()

    const done = jest.fn()
    handlers.input({ payload: { confirmedOperationModeIndex: 0 } }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith()
    expect(getCommandCalls(node).find(c => c.command === 'UpdateStatus')).toBeUndefined()

    selectControlType(handlers, 'cem-2', 'OPERATION_MODE_BASED_CONTROL')

    const cmd = getCommandCalls(node).find(c => c.command === 'UpdateStatus')
    expect(cmd).toBeDefined()
    expect(cmd!.cemId).toBe('cem-2')
    expect((cmd!.ombc as { activeOperationModeId: string }).activeOperationModeId).toBe('mode-standby')
  })

  it('rejects a confirm with no cemId when more than one CEM has OMBC selected', () => {
    const { handlers } = setupNode()
    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')
    selectControlType(handlers, 'cem-2', 'OPERATION_MODE_BASED_CONTROL')

    const done = jest.fn()
    handlers.input({ payload: { confirmedOperationModeId: 'mode-on' } }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith(expect.any(Error))
  })

  it('resolves confirmedOperationModeIndex and confirmedOperationModeLabel to the same status as confirmedOperationModeId', () => {
    const { node, handlers } = setupNode()
    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')

    ;(node.send as jest.Mock).mockClear()
    handlers.input({ cemId: 'cem-1', payload: { confirmedOperationModeIndex: 1 } }, jest.fn(), jest.fn())
    const byIndex = getCommandCalls(node).find(c => c.command === 'UpdateStatus')
    expect((byIndex!.ombc as { activeOperationModeId: string }).activeOperationModeId).toBe('mode-on')

    ;(node.send as jest.Mock).mockClear()
    handlers.input({ cemId: 'cem-1', payload: { confirmedOperationModeLabel: 'Normal operation' } }, jest.fn(), jest.fn())
    const byLabel = getCommandCalls(node).find(c => c.command === 'UpdateStatus')
    expect((byLabel!.ombc as { activeOperationModeId: string }).activeOperationModeId).toBe('mode-on')
  })

  it('accepts the new ModeConfirmation format with topic and payload.id/index/label', () => {
    const { node, handlers } = setupNode()
    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')

    ;(node.send as jest.Mock).mockClear()
    handlers.input({ topic: 'ModeConfirmation', payload: { index: 1 } }, jest.fn(), jest.fn())
    const byIndex = getCommandCalls(node).find(c => c.command === 'UpdateStatus')
    expect((byIndex!.ombc as { activeOperationModeId: string }).activeOperationModeId).toBe('mode-on')

    ;(node.send as jest.Mock).mockClear()
    handlers.input({ topic: 'ModeConfirmation', payload: { label: 'Standby' } }, jest.fn(), jest.fn())
    const byLabel = getCommandCalls(node).find(c => c.command === 'UpdateStatus')
    expect((byLabel!.ombc as { activeOperationModeId: string }).activeOperationModeId).toBe('mode-standby')

    ;(node.send as jest.Mock).mockClear()
    handlers.input({ topic: 'ModeConfirmation', payload: { id: 'mode-on', factor: 0.5 } }, jest.fn(), jest.fn())
    const byId = getCommandCalls(node).find(c => c.command === 'UpdateStatus')
    expect((byId!.ombc as { activeOperationModeId: string, operationModeFactor: number }).activeOperationModeId).toBe('mode-on')
    expect((byId!.ombc as { operationModeFactor: number }).operationModeFactor).toBe(0.5)
  })

  it('rejects a confirm with zero or multiple mode identifiers', () => {
    const { handlers } = setupNode()

    const doneZero = jest.fn()
    handlers.input({ cemId: 'cem-1', payload: { confirmedOperationModeId: undefined } }, jest.fn(), doneZero)
    expect(doneZero).toHaveBeenCalledWith(expect.any(Error))

    const doneMultiple = jest.fn()
    handlers.input({ cemId: 'cem-1', payload: { confirmedOperationModeId: 'mode-on', confirmedOperationModeIndex: 0 } }, jest.fn(), doneMultiple)
    expect(doneMultiple).toHaveBeenCalledWith(expect.any(Error))
  })

  it('rejects a confirm whose confirmedOperationModeId matches no configured mode', () => {
    const { handlers } = setupNode()
    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')

    const done = jest.fn()
    handlers.input({ cemId: 'cem-1', payload: { confirmedOperationModeId: 'mode-unknown' } }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith(expect.any(Error))
  })

  it('rejects a confirm whose confirmedOperationModeIndex is out of range', () => {
    const { handlers } = setupNode()
    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')

    const done = jest.fn()
    handlers.input({ cemId: 'cem-1', payload: { confirmedOperationModeIndex: 5 } }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith(expect.any(Error))
  })

  it('rejects a confirm whose confirmedOperationModeLabel matches no configured mode', () => {
    const { handlers } = setupNode()
    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')

    const done = jest.fn()
    handlers.input({ cemId: 'cem-1', payload: { confirmedOperationModeLabel: 'Nonexistent' } }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith(expect.any(Error))
  })

  it('rejects a confirm whose confirmedOperationModeLabel matches more than one configured mode', () => {
    const duplicateLabelConfig = {
      systemDescription: JSON.stringify({
        operationModes: [
          { id: 'mode-a', diagnostic_label: 'Duplicate', power_ranges: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', start_of_range: 0, end_of_range: 0 }], abnormal_condition_only: false },
          { id: 'mode-b', diagnostic_label: 'Duplicate', power_ranges: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', start_of_range: 0, end_of_range: 1000 }], abnormal_condition_only: false }
        ],
        transitions: [],
        timers: []
      })
    }
    const { handlers } = setupNode({}, duplicateLabelConfig)
    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')

    const done = jest.fn()
    handlers.input({ cemId: 'cem-1', payload: { confirmedOperationModeLabel: 'Duplicate' } }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith(expect.any(Error))
  })
})

describe('s2-ombc - status request notification', () => {
  function getInstructionOutputCalls (node: Record<string, unknown>): Array<Record<string, unknown>> {
    return (node.send as jest.Mock).mock.calls
      .filter((c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[0] !== null)
      .map((c) => (c[0] as unknown[])[0] as Record<string, unknown>)
  }

  it('emits ModeRequest when a CEM selects OMBC with neither persisted status nor default', () => {
    const { node, handlers } = setupNode()

    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')

    const modeRequest = getInstructionOutputCalls(node).find(m => m.topic === 'ModeRequest')
    expect(modeRequest).toBeDefined()
    expect(modeRequest!.cemId).toBe('cem-1')
    expect(modeRequest!.payload).toBeNull()
  })

  it('does not emit ModeRequest when a default status is available', () => {
    const { node, handlers } = setupNode()
    handlers.input({ payload: { confirmedOperationModeIndex: 0 } }, jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')

    expect(getInstructionOutputCalls(node).find(m => m.topic === 'ModeRequest')).toBeUndefined()
  })

  it('does not emit ModeRequest when the CEM already has a persisted status', () => {
    const { node, handlers } = setupNode()
    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')
    handlers.input({ cemId: 'cem-1', payload: { confirmedOperationModeId: 'mode-on' } }, jest.fn(), jest.fn())
    handlers.input({ cemId: 'cem-1', topic: 'Disconnected' }, jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')

    expect(getInstructionOutputCalls(node).find(m => m.topic === 'ModeRequest')).toBeUndefined()
  })
})

describe('s2-ombc - reconnect resend', () => {
  it('resends SystemDescription and the last confirmed UpdateStatus when SelectControlType(OMBC) is observed again', () => {
    const { node, handlers } = setupNode()
    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')
    handlers.input({ cemId: 'cem-1', payload: { confirmedOperationModeId: 'mode-on' } }, jest.fn(), jest.fn())

    // Simulate disconnect + reconnect: CEM re-selects control type
    handlers.input({ cemId: 'cem-1', topic: 'Disconnected' }, jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')

    const calls = (node.send as jest.Mock).mock.calls.filter(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[1] !== null
    )
    const commands = calls.map((c) => (((c[0] as unknown[])[1]) as { payload: { command: string } }).payload.command)
    expect(commands).toContain('SystemDescription')
    expect(commands).toContain('UpdateStatus')

    const updateStatusCall = calls.find((c) => (((c[0] as unknown[])[1]) as { payload: { command: string } }).payload.command === 'UpdateStatus')
    const cmd = ((updateStatusCall as unknown[][])[0][1] as { payload: { ombc: { activeOperationModeId: string } } }).payload
    expect(cmd.ombc.activeOperationModeId).toBe('mode-on')
  })

  it('does not resend UpdateStatus when nothing has been confirmed yet', () => {
    const { node, handlers } = setupNode()

    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')

    const calls = (node.send as jest.Mock).mock.calls.filter(
      (c: unknown[]) => Array.isArray(c[0]) && (c[0] as unknown[])[1] !== null
    )
    const commands = calls.map((c) => (((c[0] as unknown[])[1]) as { payload: { command: string } }).payload.command)
    expect(commands).toEqual(['SystemDescription'])
  })
})

describe('s2-ombc - PowerMeasurement passthrough', () => {
  it('forwards PowerMeasurement to s2-rm with auto-resolved cemId', () => {
    const { node, handlers } = setupNode()

    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')
    ;(node.send as jest.Mock).mockClear()

    const done = jest.fn()
    handlers.input({
      topic: 'PowerMeasurement',
      payload: { values: 3000 }
    }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith()
    const call = (node.send as jest.Mock).mock.calls[0][0]
    expect(call[0]).toBeNull()
    expect(call[1].payload).toEqual({
      command: 'PowerMeasurement',
      cemId: 'cem-1',
      values: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: 3000 }]
    })
  })

  it('uses explicit cemId from message when provided', () => {
    const { node, handlers } = setupNode()

    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')
    ;(node.send as jest.Mock).mockClear()

    const done = jest.fn()
    handlers.input({
      topic: 'PowerMeasurement',
      cemId: 'cem-explicit',
      payload: { values: [{ commodity_quantity: 'ELECTRIC.POWER.L1', value: 1000 }] }
    }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith()
    expect((node.send as jest.Mock).mock.calls[0][0][1].payload.cemId).toBe('cem-explicit')
  })

  it('silently drops PowerMeasurement when no OMBC CEM is connected', () => {
    const { node, handlers } = setupNode()

    const done = jest.fn()
    handlers.input({
      topic: 'PowerMeasurement',
      payload: { values: 3000 }
    }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith()
    expect(node.send as jest.Mock).not.toHaveBeenCalled()
  })

  it('silently drops PowerMeasurement when multiple OMBC CEMs are connected', () => {
    const { node, handlers } = setupNode()

    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')
    selectControlType(handlers, 'cem-2', 'OPERATION_MODE_BASED_CONTROL')
    ;(node.send as jest.Mock).mockClear()

    const done = jest.fn()
    handlers.input({
      topic: 'PowerMeasurement',
      payload: { values: 3000 }
    }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith()
    expect(node.send as jest.Mock).not.toHaveBeenCalled()
  })

  it('expands per-phase array [L1, L2, L3] to S2 values', () => {
    const { node, handlers } = setupNode()

    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')
    ;(node.send as jest.Mock).mockClear()

    const done = jest.fn()
    handlers.input({
      topic: 'PowerMeasurement',
      payload: { values: [1000, 1500, 500] }
    }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith()
    expect((node.send as jest.Mock).mock.calls[0][0][1].payload.values).toEqual([
      { commodity_quantity: 'ELECTRIC.POWER.L1', value: 1000 },
      { commodity_quantity: 'ELECTRIC.POWER.L2', value: 1500 },
      { commodity_quantity: 'ELECTRIC.POWER.L3', value: 500 }
    ])
  })

  it('passes through full S2 value objects unchanged', () => {
    const { node, handlers } = setupNode()

    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')
    ;(node.send as jest.Mock).mockClear()

    const done = jest.fn()
    const fullValues = [{ commodity_quantity: 'ELECTRIC.POWER.L1', value: 1000 }]
    handlers.input({
      topic: 'PowerMeasurement',
      payload: { values: fullValues }
    }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith()
    expect((node.send as jest.Mock).mock.calls[0][0][1].payload.values).toEqual(fullValues)
  })

  it('rejects number array with wrong length', () => {
    const { node, handlers } = setupNode()

    selectControlType(handlers, 'cem-1', 'OPERATION_MODE_BASED_CONTROL')
    ;(node.send as jest.Mock).mockClear()

    const done = jest.fn()
    handlers.input({
      topic: 'PowerMeasurement',
      payload: { values: [1000, 2000] }
    }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith(expect.any(Error))
    expect(node.send as jest.Mock).not.toHaveBeenCalled()
  })
})
