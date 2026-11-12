import { FRBCConfig, FRBCController, frbcConfigProblems, parseFRBCConfig, validateFRBCConfig } from '../../src/lib/s2/frbc-controller'
import { NodeMessage } from '../../src/types/node-red'

const SYM = 'ELECTRIC.POWER.3_PHASE_SYMMETRIC'

function element (fillFrom: number, fillTo: number, rateFrom: number, rateTo: number, powerFrom: number, powerTo: number, cq = SYM) {
  return {
    fill_level_range: { start_of_range: fillFrom, end_of_range: fillTo },
    fill_rate: { start_of_range: rateFrom, end_of_range: rateTo },
    power_ranges: [{ commodity_quantity: cq, start_of_range: powerFrom, end_of_range: powerTo }]
  }
}

function makeConfig (): FRBCConfig {
  return {
    systemDescription: {
      actuators: [{
        id: 'hp',
        diagnostic_label: 'Heat pump',
        supported_commodities: ['ELECTRICITY'],
        operation_modes: [
          { id: 'hp-off', diagnostic_label: 'Off', abnormal_condition_only: false, elements: [element(0, 100, 0, 0, 0, 0)] },
          {
            id: 'hp-on',
            diagnostic_label: 'Heating',
            abnormal_condition_only: false,
            // Weaker above 80 %: less heat, less power.
            elements: [element(0, 80, 0, 10, 0, 2000), element(80, 100, 0, 4, 0, 1000)]
          }
        ],
        transitions: [
          { id: 't-on', from: 'hp-off', to: 'hp-on', start_timers: ['min-on'], blocking_timers: [], abnormal_condition_only: false },
          { id: 't-off', from: 'hp-on', to: 'hp-off', start_timers: [], blocking_timers: ['min-on'], abnormal_condition_only: false }
        ],
        timers: [{ id: 'min-on', diagnostic_label: 'Minimum on', duration: 1800000 }]
      }, {
        id: 'heater',
        diagnostic_label: 'Immersion heater',
        supported_commodities: ['ELECTRICITY'],
        operation_modes: [
          { id: 'heater-off', diagnostic_label: 'Off', abnormal_condition_only: false, elements: [element(0, 100, 0, 0, 0, 0, 'ELECTRIC.POWER.L1')] },
          { id: 'heater-on', diagnostic_label: 'On', abnormal_condition_only: false, elements: [element(0, 100, 3, 3, 3000, 3000, 'ELECTRIC.POWER.L1')] }
        ],
        transitions: [],
        timers: []
      }],
      storage: {
        diagnostic_label: 'Tank',
        provides_leakage_behaviour: true,
        provides_fill_level_target_profile: true,
        provides_usage_forecast: false,
        fill_level_range: { start_of_range: 0, end_of_range: 100 }
      }
    },
    leakageBehaviour: { elements: [{ fill_level_range: { start_of_range: 0, end_of_range: 100 }, leakage_rate: 0.002 }] }
  }
}

function setup (config: FRBCConfig = makeConfig(), context: Record<string, unknown> = {}) {
  const instructions: NodeMessage[] = []
  const commands: Array<Record<string, unknown>> = []
  const statuses: Array<Record<string, unknown>> = []
  const warnings: string[] = []
  const controller = new FRBCController({
    config,
    onEmitInstruction: (msg) => instructions.push(msg),
    onSendCommand: (msg) => commands.push(msg.payload as Record<string, unknown>),
    onStatus: (s) => statuses.push(s as Record<string, unknown>),
    onWarn: (m) => warnings.push(m),
    getContextValue: (key) => context[key],
    setContextValue: (key, value) => { context[key] = value }
  })
  const input = (msg: NodeMessage): jest.Mock => {
    const done = jest.fn()
    controller.handleInput(msg, done)
    return done
  }
  const select = (cemId: string, controlType = 'FILL_RATE_BASED_CONTROL'): jest.Mock =>
    input({ cemId, topic: 'SelectControlType', payload: { message_type: 'SelectControlType', message_id: 'sct-1', control_type: controlType } })
  const instruct = (cemId: string, fields: Record<string, unknown>): jest.Mock =>
    input({
      cemId,
      topic: 'FRBC.Instruction',
      payload: { message_type: 'FRBC.Instruction', message_id: 'm-1', id: 'instr-1', execution_time: '2026-01-01T00:00:00Z', abnormal_condition: false, operation_mode_factor: 1, ...fields }
    })
  return { controller, instructions, commands, statuses, warnings, context, input, select, instruct }
}

describe('frbcConfigProblems', () => {
  it('accepts a consistent configuration', () => {
    expect(frbcConfigProblems(makeConfig())).toEqual([])
  })

  it('reports a transition to an unknown mode, naming both', () => {
    const config = makeConfig()
    const actuator = config.systemDescription.actuators[0] as { transitions: Array<Record<string, unknown>> }
    actuator.transitions[0].to = 'hp-turbo'
    expect(frbcConfigProblems(config)).toEqual(['actuator "hp", transition "t-on": "to" refers to unknown operation mode "hp-turbo"'])
  })

  it('reports a transition timer belonging to another actuator', () => {
    const config = makeConfig()
    const heater = config.systemDescription.actuators[1] as { transitions: unknown[] }
    heater.transitions.push({ id: 't-h', from: 'heater-off', to: 'heater-on', start_timers: ['min-on'], blocking_timers: [], abnormal_condition_only: false })
    expect(frbcConfigProblems(config)).toEqual(['actuator "heater", transition "t-h": start_timers refers to unknown timer "min-on"'])
  })

  it('reports duplicate actuator and mode ids', () => {
    const config = makeConfig()
    const actuators = config.systemDescription.actuators as Array<{ id: string, operation_modes: Array<{ id: string }> }>
    actuators[1].id = 'hp'
    actuators[0].operation_modes[1].id = 'hp-off'
    const problems = frbcConfigProblems(config)
    expect(problems).toContain('Duplicate actuator id "hp"')
    expect(problems).toContain('actuator "hp": duplicate operation mode id "hp-off"')
  })

  it('reports leakage configured without provides_leakage_behaviour, and the reverse', () => {
    const withoutFlag = makeConfig()
    withoutFlag.systemDescription.storage.provides_leakage_behaviour = false
    expect(frbcConfigProblems(withoutFlag)).toEqual(['A leakage behaviour is configured, but storage.provides_leakage_behaviour is not true'])

    const withoutLeakage = makeConfig()
    delete withoutLeakage.leakageBehaviour
    expect(frbcConfigProblems(withoutLeakage)).toEqual(['storage.provides_leakage_behaviour is true, but no leakage behaviour is configured'])
  })
})

describe('validateFRBCConfig', () => {
  it('accepts the fixture (schema and cross-references)', () => {
    expect(validateFRBCConfig(makeConfig())).toEqual([])
  })

  it('reports schema errors prefixed with the field, and skips cross-reference checks then', () => {
    const config = makeConfig()
    delete (config.systemDescription.storage as Record<string, unknown>).fill_level_range
    config.leakageBehaviour = undefined // would also be a cross-reference problem
    const errors = validateFRBCConfig(config)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.every(e => e.startsWith('System description: '))).toBe(true)
    expect(errors.join(' ')).toContain('fill_level_range')
  })
})

describe('parseFRBCConfig', () => {
  it('parses both fields; an empty leakage field means none', () => {
    expect(parseFRBCConfig('{"actuators":[],"storage":{}}', '')).toEqual({ systemDescription: { actuators: [], storage: {} } })
    expect(parseFRBCConfig('{"actuators":[],"storage":{}}', '{"elements":[]}').leakageBehaviour).toEqual({ elements: [] })
  })

  it('names the field on invalid JSON or a non-object', () => {
    expect(() => parseFRBCConfig('{', '')).toThrow(/^System description: invalid JSON/)
    expect(() => parseFRBCConfig('{}', '[1]')).toThrow('Leakage behaviour: must be a JSON object')
    expect(() => parseFRBCConfig('', '')).toThrow('System description: not configured')
  })
})

describe('FRBCController - selection', () => {
  it('pushes system description with leakage on FRBC selection and emits Selected', () => {
    const { select, commands, instructions } = setup()
    select('cem-1')
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ command: 'SystemDescription', cemId: 'cem-1', controlType: 'FILL_RATE_BASED_CONTROL' })
    const frbc = commands[0].frbc as Record<string, unknown>
    expect(frbc.systemDescription).toEqual(makeConfig().systemDescription)
    expect(frbc.leakageBehaviour).toEqual(makeConfig().leakageBehaviour)
    expect(instructions).toEqual([{ topic: 'Selected', payload: { controlType: 'FILL_RATE_BASED_CONTROL' }, cemId: 'cem-1' }])
  })

  it('omits leakage when none is configured', () => {
    const config = makeConfig()
    config.systemDescription.storage.provides_leakage_behaviour = false
    delete config.leakageBehaviour
    const { select, commands } = setup(config)
    select('cem-1')
    expect(commands[0].frbc).not.toHaveProperty('leakageBehaviour')
  })

  it('replays a fill level received before selection, without the flow resending', () => {
    const { input, select, commands, statuses } = setup()
    input({ topic: 'StorageStatus', payload: { fillLevel: 40 } })
    expect(commands).toHaveLength(0)
    expect(statuses[statuses.length - 1]).toMatchObject({ fill: 'grey', text: 'FRBC not selected - fill 40' })

    select('cem-1')
    expect(commands.map(c => c.command)).toEqual(['SystemDescription', 'UpdateStatus'])
    expect(commands[1].frbc).toEqual({ storageStatus: { presentFillLevel: 40 } })
    expect(statuses[statuses.length - 1]).toMatchObject({ fill: 'green', text: 'FRBC selected - fill 40' })
  })

  it('sends only the system description when nothing is known, and says the fill level is missing', () => {
    const { select, commands, statuses } = setup()
    select('cem-1')
    expect(commands.map(c => c.command)).toEqual(['SystemDescription'])
    expect(statuses[statuses.length - 1]).toMatchObject({ fill: 'yellow', text: 'FRBC selected - fill level unknown, send StorageStatus' })
  })

  it('replays actuator statuses, unexpired timers and a future target profile; drops expired ones', () => {
    const context: Record<string, unknown> = {
      s2FrbcState: {
        fillLevel: 10,
        actuators: { hp: { actuatorId: 'hp', activeOperationModeId: 'hp-on', operationModeFactor: 1 } },
        timers: [
          { actuatorId: 'hp', timerId: 'min-on', finishedAt: new Date(Date.now() + 60000).toISOString() },
          { actuatorId: 'hp', timerId: 'old', finishedAt: new Date(Date.now() - 60000).toISOString() }
        ],
        fillLevelTargetProfile: { startTime: new Date(Date.now() - 1000).toISOString(), elements: [{ duration: 3600000, fill_level_range: { start_of_range: 50, end_of_range: 60 } }] },
        usageForecast: { startTime: new Date(Date.now() - 7200000).toISOString(), elements: [{ duration: 3600000, usage_rate_expected: 1 }] }
      }
    }
    const { select, commands } = setup(makeConfig(), context)
    select('cem-1')
    const frbc = commands[1].frbc as Record<string, unknown>
    expect(frbc.actuatorStatuses).toEqual([{ actuatorId: 'hp', activeOperationModeId: 'hp-on', operationModeFactor: 1 }])
    expect(frbc.storageStatus).toEqual({ presentFillLevel: 10 })
    expect((frbc.timerStatuses as Array<{ timerId: string }>).map(t => t.timerId)).toEqual(['min-on'])
    expect(frbc.fillLevelTargetProfile).toBeDefined()
    expect(frbc).not.toHaveProperty('usageForecast') // ended an hour ago
  })

  it('emits Deselected when the CEM switches to another control type, or disconnects', () => {
    const { select, input, instructions } = setup()
    select('cem-1')
    select('cem-1', 'NO_SELECTION')
    expect(instructions[1]).toEqual({ topic: 'Deselected', payload: { controlType: 'NO_SELECTION' }, cemId: 'cem-1' })

    select('cem-1')
    input({ topic: 'Disconnected', cemId: 'cem-1', payload: undefined })
    expect(instructions[3]).toEqual({ topic: 'Deselected', payload: { reason: 'disconnected' }, cemId: 'cem-1' })
  })

  it('emits nothing when a CEM that never selected FRBC selects something else', () => {
    const { select, instructions, commands } = setup()
    select('cem-1', 'OPERATION_MODE_BASED_CONTROL')
    expect(instructions).toEqual([])
    expect(commands).toEqual([])
  })
})

describe('FRBCController - instructions', () => {
  it('resolves actuator and mode, picks the element for the current fill level and interpolates by factor', () => {
    const { input, select, instruct, instructions } = setup()
    input({ topic: 'StorageStatus', payload: { fillLevel: 50 } })
    select('cem-1')
    instruct('cem-1', { actuator_id: 'hp', operation_mode: 'hp-on', operation_mode_factor: 0.5 })

    const out = instructions[instructions.length - 1]
    expect(out.topic).toBe('ActuatorInstruction')
    expect(out.cemId).toBe('cem-1')
    expect(out.payload).toEqual({
      instructionId: 'instr-1',
      actuatorId: 'hp',
      actuatorLabel: 'Heat pump',
      actuatorIndex: 0,
      operationModeId: 'hp-on',
      operationModeLabel: 'Heating',
      operationModeIndex: 1,
      factor: 0.5,
      abnormalCondition: false,
      fillRate: 5,
      commodityPower: [{ commodity_quantity: SYM, value: 1000 }],
      values: 1000
    })
    expect((out.rawS2Message as Record<string, unknown>).id).toBe('instr-1')
  })

  it('uses the element matching a high fill level', () => {
    const { input, select, instruct, instructions } = setup()
    input({ topic: 'StorageStatus', payload: { fillLevel: 90 } })
    select('cem-1')
    instruct('cem-1', { actuator_id: 'hp', operation_mode: 'hp-on', operation_mode_factor: 1 })
    expect(instructions[instructions.length - 1].payload).toMatchObject({ fillRate: 4, values: 1000 })
  })

  it('falls back to the first element with a warning when the fill level is unknown', () => {
    const { select, instruct, instructions, warnings } = setup()
    select('cem-1')
    instruct('cem-1', { actuator_id: 'hp', operation_mode: 'hp-on', operation_mode_factor: 1 })
    expect(instructions[instructions.length - 1].payload).toMatchObject({ fillRate: 10, values: 2000 })
    expect(warnings).toEqual(['FRBC.Instruction instr-1: fill level unknown - using the first element of mode "Heating"'])
  })

  it('gives per-phase power as an [L1, L2, L3] values array', () => {
    const { select, instruct, instructions } = setup()
    select('cem-1')
    instruct('cem-1', { actuator_id: 'heater', operation_mode: 'heater-on' })
    expect(instructions[instructions.length - 1].payload).toMatchObject({ values: [3000, 0, 0], commodityPower: [{ commodity_quantity: 'ELECTRIC.POWER.L1', value: 3000 }] })
  })

  it('aborts an instruction for an unknown actuator or mode, without output', () => {
    const { select, instruct, instructions, commands, warnings } = setup()
    select('cem-1')
    const before = instructions.length
    instruct('cem-1', { actuator_id: 'hp', operation_mode: 'hp-turbo' })
    instruct('cem-1', { actuator_id: 'boiler', operation_mode: 'x', id: 'instr-2' })
    expect(instructions).toHaveLength(before)
    expect(commands.filter(c => c.command === 'InstructionStatus')).toEqual([
      { command: 'InstructionStatus', cemId: 'cem-1', instructionId: 'instr-1', status: 'ABORTED' },
      { command: 'InstructionStatus', cemId: 'cem-1', instructionId: 'instr-2', status: 'ABORTED' }
    ])
    expect(warnings[0]).toContain('unknown operation mode "hp-turbo" of actuator "hp"')
    expect(warnings[1]).toContain('unknown actuator "boiler"')
  })

  it('ignores other control types\' instructions silently', () => {
    const { input, instructions, commands } = setup()
    const done = input({ cemId: 'cem-1', topic: 'OMBC.Instruction', payload: { message_type: 'OMBC.Instruction', id: 'o1', operation_mode_id: 'x' } })
    expect(done).toHaveBeenCalledWith()
    expect(instructions).toEqual([])
    expect(commands).toEqual([])
  })
})

describe('FRBCController - StorageStatus', () => {
  it('sends a changed fill level once, and not an unchanged one', () => {
    const { input, select, commands } = setup()
    select('cem-1')
    input({ topic: 'StorageStatus', payload: { fillLevel: 55 } })
    input({ topic: 'StorageStatus', payload: { fillLevel: 55 } })
    input({ topic: 'StorageStatus', payload: { fillLevel: 56 } })
    expect(commands.filter(c => c.command === 'UpdateStatus').map(c => c.frbc)).toEqual([
      { storageStatus: { presentFillLevel: 55 } },
      { storageStatus: { presentFillLevel: 56 } }
    ])
  })

  it('rejects a fill level that is not a finite number', () => {
    const { input } = setup()
    const done = input({ topic: 'StorageStatus', payload: { fillLevel: '55' } })
    expect(done).toHaveBeenCalledWith(new Error('StorageStatus requires payload.fillLevel to be a finite number'))
  })

  it('requires cemId when two CEMs have FRBC selected', () => {
    const { input, select, commands, context } = setup()
    select('cem-1')
    select('cem-2')
    commands.length = 0
    const done = input({ topic: 'StorageStatus', payload: { fillLevel: 1 } })
    expect(done).toHaveBeenCalledWith(new Error('More than one CEM has FRBC selected - set msg.cemId to say which one this is for'))
    expect(commands).toEqual([])
    // The fill level describes the device, so it is kept even though it couldn't be sent.
    expect((context.s2FrbcState as { fillLevel: number }).fillLevel).toBe(1)

    input({ topic: 'StorageStatus', payload: { fillLevel: 1 }, cemId: 'cem-2' })
    expect(commands).toEqual([{ command: 'UpdateStatus', cemId: 'cem-2', controlType: 'FILL_RATE_BASED_CONTROL', frbc: { storageStatus: { presentFillLevel: 1 } } }])
  })
})

describe('FRBCController - ActuatorConfirmation', () => {
  it('sends ActuatorStatus; a later mode change adds previous mode, transition time and the transition\'s start timers', () => {
    const { input, select, commands } = setup()
    select('cem-1')
    input({ topic: 'ActuatorConfirmation', payload: { actuator: 'hp', operationMode: 'Off' } })
    expect(commands[1].frbc).toEqual({ actuatorStatuses: [{ actuatorId: 'hp', activeOperationModeId: 'hp-off', operationModeFactor: 1 }] })

    const before = Date.now()
    input({ topic: 'ActuatorConfirmation', payload: { actuator: 0, operationMode: 1, factor: 0.5 } })
    const frbc = commands[2].frbc as { actuatorStatuses: Array<Record<string, unknown>>, timerStatuses: Array<Record<string, unknown>> }
    expect(frbc.actuatorStatuses[0]).toMatchObject({ actuatorId: 'hp', activeOperationModeId: 'hp-on', operationModeFactor: 0.5, previousOperationModeId: 'hp-off' })
    expect(typeof frbc.actuatorStatuses[0].transitionTimestamp).toBe('string')
    expect(frbc.timerStatuses).toHaveLength(1)
    expect(frbc.timerStatuses[0]).toMatchObject({ actuatorId: 'hp', timerId: 'min-on' })
    const finished = new Date(frbc.timerStatuses[0].finishedAt as string).getTime()
    expect(finished).toBeGreaterThanOrEqual(before + 1800000)
    expect(finished).toBeLessThan(before + 1800000 + 5000)
  })

  it('reports the confirmed instruction as SUCCEEDED when an ActuatorInstruction payload is wired back', () => {
    const { select, instruct, input, instructions, commands } = setup()
    select('cem-1')
    instruct('cem-1', { actuator_id: 'hp', operation_mode: 'hp-on', operation_mode_factor: 0.5 })
    const emitted = instructions[instructions.length - 1]
    input({ topic: 'ActuatorConfirmation', payload: emitted.payload, cemId: 'cem-1' })
    expect(commands[commands.length - 1]).toEqual({ command: 'InstructionStatus', cemId: 'cem-1', instructionId: 'instr-1', status: 'SUCCEEDED' })

    // Only once: a second identical confirmation has no open instruction left.
    const count = commands.filter(c => c.command === 'InstructionStatus').length
    input({ topic: 'ActuatorConfirmation', payload: emitted.payload, cemId: 'cem-1' })
    expect(commands.filter(c => c.command === 'InstructionStatus')).toHaveLength(count)
  })

  it('does not report SUCCEEDED for a confirmation of a different factor', () => {
    const { select, instruct, input, commands } = setup()
    select('cem-1')
    instruct('cem-1', { actuator_id: 'hp', operation_mode: 'hp-on', operation_mode_factor: 0.5 })
    input({ topic: 'ActuatorConfirmation', payload: { actuator: 'hp', operationMode: 'hp-on', factor: 1 } })
    expect(commands.filter(c => c.command === 'InstructionStatus')).toEqual([])
  })

  it('stores a confirmation while FRBC is not selected and replays it on selection', () => {
    const { input, select, commands } = setup()
    input({ topic: 'ActuatorConfirmation', payload: { actuator: 'Immersion heater', operationMode: 'On' } })
    expect(commands).toEqual([])
    select('cem-1')
    expect((commands[1].frbc as Record<string, unknown>).actuatorStatuses).toEqual([{ actuatorId: 'heater', activeOperationModeId: 'heater-on', operationModeFactor: 1 }])
  })

  it('rejects unknown references with a message naming them', () => {
    const { input } = setup()
    expect(input({ topic: 'ActuatorConfirmation', payload: { actuator: 'boiler', operationMode: 0 } }))
      .toHaveBeenCalledWith(new Error('actuator "boiler" does not match any configured actuator'))
    expect(input({ topic: 'ActuatorConfirmation', payload: { actuator: 'hp', operationMode: 5 } }))
      .toHaveBeenCalledWith(new Error('operation mode index 5 is out of range (0-1)'))
    expect(input({ topic: 'ActuatorConfirmation', payload: { actuator: 'hp' } }))
      .toHaveBeenCalledWith(new Error('operation mode is required (an id, a 0-based index or a diagnostic label)'))
  })
})

describe('FRBCController - forecasts, target profiles and timers', () => {
  it('sends a fill level target profile when the storage declares one', () => {
    const { input, select, commands } = setup()
    select('cem-1')
    const elements = [{ duration: 3600000, fill_level_range: { start_of_range: 50, end_of_range: 60 } }]
    input({ topic: 'FillLevelTargetProfile', payload: { startTime: '2030-01-01T00:00:00.000Z', elements } })
    expect(commands[1].frbc).toEqual({ fillLevelTargetProfile: { startTime: '2030-01-01T00:00:00.000Z', elements } })
  })

  it('ignores a usage forecast with a warning when the storage does not declare one', () => {
    const { input, select, commands, warnings } = setup()
    select('cem-1')
    const done = input({ topic: 'UsageForecast', payload: { elements: [{ duration: 1000, usage_rate_expected: 1 }] } })
    expect(done).toHaveBeenCalledWith()
    expect(commands).toHaveLength(1)
    expect(warnings).toEqual(['UsageForecast ignored: the system description\'s storage.provides_usage_forecast is not true'])
  })

  it('rejects a profile without elements', () => {
    const { input } = setup()
    expect(input({ topic: 'FillLevelTargetProfile', payload: { elements: [] } }))
      .toHaveBeenCalledWith(new Error('FillLevelTargetProfile requires a non-empty payload.elements array'))
  })

  it('sends a flow-managed TimerStatus, accepting epoch milliseconds', () => {
    const { input, select, commands } = setup()
    select('cem-1')
    input({ topic: 'TimerStatus', payload: { actuator: 'hp', timerId: 'min-on', finishedAt: Date.UTC(2030, 0, 1) } })
    expect(commands[1].frbc).toEqual({ timerStatuses: [{ actuatorId: 'hp', timerId: 'min-on', finishedAt: '2030-01-01T00:00:00.000Z' }] })
    expect(input({ topic: 'TimerStatus', payload: { actuator: 'hp', timerId: 'min-on', finishedAt: 'soon' } }))
      .toHaveBeenCalledWith(new Error('TimerStatus requires payload.finishedAt as an ISO 8601 string or milliseconds since the epoch'))
  })
})

describe('FRBCController - session lifecycle', () => {
  it('treats Connected for a CEM with FRBC selected as the end of that selection (reconnect without Disconnect)', () => {
    const { input, select, instruct, instructions, commands, statuses } = setup()
    select('cem-1')
    instruct('cem-1', { actuator_id: 'hp', operation_mode: 'hp-on' })
    input({ topic: 'Connected', cemId: 'cem-1', payload: undefined })
    expect(instructions[instructions.length - 1]).toEqual({ topic: 'Deselected', payload: { reason: 'reconnected' }, cemId: 'cem-1' })
    expect(statuses[statuses.length - 1]).toMatchObject({ fill: 'grey' })

    commands.length = 0
    input({ topic: 'StorageStatus', payload: { fillLevel: 42 } })
    input({ topic: 'ActuatorConfirmation', payload: { actuator: 'hp', operationMode: 'hp-on' } })
    expect(commands).toEqual([]) // stored only, and no SUCCEEDED for the old session's instruction

    // Selecting again starts from scratch: the stored fill level is replayed.
    select('cem-1')
    expect((commands[1].frbc as Record<string, unknown>).storageStatus).toEqual({ presentFillLevel: 42 })
  })

  it('ignores Connected for a CEM that never selected FRBC', () => {
    const { input, instructions } = setup()
    const done = input({ topic: 'Connected', cemId: 'cem-1', payload: undefined })
    expect(done).toHaveBeenCalledWith()
    expect(instructions).toEqual([])
  })

  it('asks s2-rm to replay the FRBC selection, and handles a replayed selection like a real one', () => {
    const { controller, input, commands, instructions } = setup()
    controller.requestSelectionReplay()
    expect(commands).toEqual([{ command: 'ReplaySelection', controlType: 'FILL_RATE_BASED_CONTROL' }])

    input({ cemId: 'cem-1', topic: 'SelectControlType', payload: { message_type: 'SelectControlType', control_type: 'FILL_RATE_BASED_CONTROL', replay: true } })
    expect(commands[1]).toMatchObject({ command: 'SystemDescription', cemId: 'cem-1' })
    expect(instructions[0]).toMatchObject({ topic: 'Selected', cemId: 'cem-1' })
  })
})

describe('FRBCController - stored state after a configuration change', () => {
  it('drops stored statuses, timers and profiles the configuration no longer covers', () => {
    const config = makeConfig()
    config.systemDescription.storage.provides_fill_level_target_profile = false
    const future = new Date(Date.now() + 3600000).toISOString()
    const context: Record<string, unknown> = {
      s2FrbcState: {
        fillLevel: 20,
        actuators: {
          hp: { actuatorId: 'hp', activeOperationModeId: 'hp-on', operationModeFactor: 1, previousOperationModeId: 'hp-turbo', transitionTimestamp: '2026-01-01T00:00:00.000Z' },
          heater: { actuatorId: 'heater', activeOperationModeId: 'heater-boost', operationModeFactor: 1 },
          boiler: { actuatorId: 'boiler', activeOperationModeId: 'b-on', operationModeFactor: 1 }
        },
        timers: [
          { actuatorId: 'hp', timerId: 'min-on', finishedAt: future },
          { actuatorId: 'hp', timerId: 'removed-timer', finishedAt: future }
        ],
        fillLevelTargetProfile: { startTime: new Date().toISOString(), elements: [{ duration: 3600000, fill_level_range: { start_of_range: 1, end_of_range: 2 } }] }
      }
    }
    const { select, commands } = setup(config, context)
    select('cem-1')
    expect(commands[1].frbc).toEqual({
      // hp keeps its active mode, but the previous mode no longer exists; heater's mode and boiler are gone
      actuatorStatuses: [{ actuatorId: 'hp', activeOperationModeId: 'hp-on', operationModeFactor: 1 }],
      storageStatus: { presentFillLevel: 20 },
      timerStatuses: [{ actuatorId: 'hp', timerId: 'min-on', finishedAt: future }]
    })
  })

  it('leaves state the configuration still covers untouched', () => {
    const state = {
      fillLevel: 20,
      actuators: { hp: { actuatorId: 'hp', activeOperationModeId: 'hp-on', operationModeFactor: 1, previousOperationModeId: 'hp-off', transitionTimestamp: '2026-01-01T00:00:00.000Z' } },
      timers: []
    }
    const context: Record<string, unknown> = { s2FrbcState: JSON.parse(JSON.stringify(state)) }
    setup(makeConfig(), context)
    expect(context.s2FrbcState).toEqual(state)
  })
})

describe('FRBCController - unrecognised input', () => {
  it('warns about an ActuatorInstruction wired back without changing its topic', () => {
    const { input, commands, warnings } = setup()
    const done = input({ topic: 'ActuatorInstruction', payload: { actuatorId: 'hp', operationModeId: 'hp-on' } })
    expect(done).toHaveBeenCalledWith()
    expect(commands).toEqual([])
    expect(warnings).toEqual(['Ignored input with msg.topic "ActuatorInstruction": expected one of StorageStatus, ActuatorConfirmation, UsageForecast, FillLevelTargetProfile, TimerStatus - to confirm an instruction, send its payload with msg.topic "ActuatorConfirmation"'])
  })

  it('warns about input without a topic, but not about other S2 messages from s2-rm', () => {
    const { input, warnings } = setup()
    input({ payload: { fillLevel: 3 } })
    input({ cemId: 'cem-1', topic: 'ReceptionStatus', payload: { message_type: 'ReceptionStatus', subject_message_id: 'x', status: 'OK' } })
    expect(warnings).toEqual(['Ignored input with msg.topic (none): expected one of StorageStatus, ActuatorConfirmation, UsageForecast, FillLevelTargetProfile, TimerStatus'])
  })
})

describe('FRBCController - instruction lifecycle (every instruction ends in a final status)', () => {
  const statuses = (commands: Array<Record<string, unknown>>) =>
    commands.filter(c => c.command === 'InstructionStatus').map(c => `${String(c.instructionId)}:${String(c.status)}`)
  const confirm = (input: (msg: NodeMessage) => jest.Mock, operationMode: string, factor = 1) =>
    input({ topic: 'ActuatorConfirmation', payload: { actuator: 'hp', operationMode, factor } })

  it('closes every open instruction a confirmation fulfils, not only the newest', () => {
    const { select, instruct, input, commands } = setup()
    select('cem-1')
    instruct('cem-1', { id: 'i1', actuator_id: 'hp', operation_mode: 'hp-off' })
    instruct('cem-1', { id: 'i2', actuator_id: 'hp', operation_mode: 'hp-off' })
    instruct('cem-1', { id: 'i3', actuator_id: 'hp', operation_mode: 'hp-off' })
    confirm(input, 'hp-off')
    expect(statuses(commands)).toEqual(['i1:SUCCEEDED', 'i2:SUCCEEDED', 'i3:SUCCEEDED'])
  })

  it('aborts an unconfirmed instruction when a newer one for the same actuator asks for another mode', () => {
    const { select, instruct, commands } = setup()
    select('cem-1')
    instruct('cem-1', { id: 'i1', actuator_id: 'hp', operation_mode: 'hp-on' })
    instruct('cem-1', { id: 'h1', actuator_id: 'heater', operation_mode: 'heater-on' })
    instruct('cem-1', { id: 'i2', actuator_id: 'hp', operation_mode: 'hp-off' })
    // Only hp's own earlier instruction is overtaken; the heater's stays open.
    expect(statuses(commands)).toEqual(['i1:ABORTED'])
  })

  it('keeps an earlier instruction for the same mode open, and closes it with the confirmation', () => {
    const { select, instruct, input, commands } = setup()
    select('cem-1')
    instruct('cem-1', { id: 'i1', actuator_id: 'hp', operation_mode: 'hp-on', operation_mode_factor: 0.5 })
    instruct('cem-1', { id: 'i2', actuator_id: 'hp', operation_mode: 'hp-on', operation_mode_factor: 1 })
    expect(statuses(commands)).toEqual([])
    // i2 is confirmed; i1 (same mode, other factor) was overtaken by it.
    confirm(input, 'hp-on', 1)
    expect(statuses(commands)).toEqual(['i1:ABORTED', 'i2:SUCCEEDED'])
  })

  it('leaves newer instructions open when an older one is confirmed', () => {
    const { select, instruct, input, commands } = setup()
    select('cem-1')
    instruct('cem-1', { id: 'i1', actuator_id: 'hp', operation_mode: 'hp-on', operation_mode_factor: 1 })
    instruct('cem-1', { id: 'i2', actuator_id: 'hp', operation_mode: 'hp-on', operation_mode_factor: 0.5 })
    confirm(input, 'hp-on', 1)
    expect(statuses(commands)).toEqual(['i1:SUCCEEDED'])
    confirm(input, 'hp-on', 0.5)
    expect(statuses(commands)).toEqual(['i1:SUCCEEDED', 'i2:SUCCEEDED'])
  })

  it('reports an instruction revoked after it reached the flow as REVOKED and tells the flow', () => {
    const { select, instruct, input, commands, instructions } = setup()
    select('cem-1')
    instruct('cem-1', { id: 'i1', actuator_id: 'hp', operation_mode: 'hp-on', operation_mode_factor: 0.5 })
    input({ cemId: 'cem-1', topic: 'RevokeObject', payload: { message_type: 'RevokeObject', object_type: 'FRBC.Instruction', object_id: 'i1' } })
    expect(statuses(commands)).toEqual(['i1:REVOKED'])
    expect(instructions[instructions.length - 1]).toEqual({
      topic: 'Revoked',
      payload: { instructionId: 'i1', actuatorId: 'hp', operationModeId: 'hp-on', factor: 0.5 },
      cemId: 'cem-1'
    })
    // No longer open: a later confirmation doesn't report it again.
    confirm(input, 'hp-on', 0.5)
    expect(statuses(commands)).toEqual(['i1:REVOKED'])
  })

  it('ignores a revoke for an instruction it never handed to the flow (s2-rm answers those)', () => {
    const { select, input, commands, instructions } = setup()
    select('cem-1')
    const before = instructions.length
    input({ cemId: 'cem-1', topic: 'RevokeObject', payload: { message_type: 'RevokeObject', object_type: 'FRBC.Instruction', object_id: 'pending' } })
    expect(statuses(commands)).toEqual([])
    expect(instructions).toHaveLength(before)
  })

  it('aborts open instructions when the CEM switches to another control type, but not when the session ends', () => {
    const switched = setup()
    switched.select('cem-1')
    switched.instruct('cem-1', { id: 'i1', actuator_id: 'hp', operation_mode: 'hp-on' })
    switched.select('cem-1', 'NOT_CONTROLABLE')
    expect(statuses(switched.commands)).toEqual(['i1:ABORTED'])

    const disconnected = setup()
    disconnected.select('cem-1')
    disconnected.instruct('cem-1', { id: 'i1', actuator_id: 'hp', operation_mode: 'hp-on' })
    disconnected.input({ topic: 'Disconnected', cemId: 'cem-1', payload: undefined })
    expect(statuses(disconnected.commands)).toEqual([])
  })

  it('keeps open instructions when the CEM selects FRBC again', () => {
    const { select, instruct, input, commands } = setup()
    select('cem-1')
    instruct('cem-1', { id: 'i1', actuator_id: 'hp', operation_mode: 'hp-on' })
    select('cem-1')
    expect(statuses(commands)).toEqual([])
    confirm(input, 'hp-on')
    expect(statuses(commands)).toEqual(['i1:SUCCEEDED'])
  })

  it('aborts the oldest open instruction when more than 50 are open', () => {
    const { select, instruct, commands } = setup()
    select('cem-1')
    for (let i = 0; i <= 50; i++) instruct('cem-1', { id: `i${i}`, actuator_id: 'hp', operation_mode: 'hp-on' })
    expect(statuses(commands)).toEqual(['i0:ABORTED'])
  })
})
