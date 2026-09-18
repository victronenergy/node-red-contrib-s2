import { S2ResourceManager, S2ResourceManagerOptions } from '../../src/lib/s2/resource-manager'
import { MessageType, RmDetails, serialize } from '../../src/lib/s2/messages'

const RM_DETAILS: RmDetails = {
  resourceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  name: 'Test RM',
  roles: [{ role: 'ENERGY_CONSUMER', commodity: 'ELECTRICITY' }],
  availableControlTypes: ['OPERATION_MODE_BASED_CONTROL'],
  providesForecast: false,
  manufacturer: 'Acme',
  model: 'X1',
  serialNumber: 'sn-1',
  firmwareVersion: '2.0.0'
}

type Msg = Record<string, unknown> | null

function setup (overrides: Partial<S2ResourceManagerOptions> = {}) {
  const transportMsgs: Msg[] = []
  const cemMsgs: Msg[] = []
  const statuses: unknown[] = []
  const warnings: string[] = []
  const contextStore: Record<string, unknown> = {}

  const rm = new S2ResourceManager({
    rmDetails: RM_DETAILS,
    nodeId: 'node-test-id',
    onSendToTransport: (msg) => transportMsgs.push(msg),
    onEmitToCem: (msg) => cemMsgs.push(msg),
    onStatus: (s) => statuses.push(s),
    onLog: () => {},
    onWarn: (m) => warnings.push(m),
    onError: () => {},
    getContextValue: (key) => contextStore[key],
    setContextValue: (key, value) => { contextStore[key] = value },
    resolveContextTemplate: (t) => t,
    ...overrides
  })

  return { rm, transportMsgs, cemMsgs, statuses, warnings, contextStore }
}

function connectAndHandshake (rm: S2ResourceManager, cemId = 'cem-1'): void {
  rm.handleInput({ payload: { command: 'Connect', cemId, keepAliveInterval: 0 } }, jest.fn())
  rm.handleInput(
    { payload: { command: 'Message', cemId, message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1', selected_protocol_version: '0.0.2-beta' }) } },
    jest.fn()
  )
}

describe('S2ResourceManager - handshake', () => {
  it('sends ResourceManagerDetails after HandshakeResponse', () => {
    const { rm, transportMsgs } = setup()
    connectAndHandshake(rm)

    const rmd = transportMsgs.find(m => {
      const payload = m?.payload as { message?: { message_type?: string } } | undefined
      return payload?.message?.message_type === MessageType.RESOURCE_MANAGER_DETAILS
    })
    expect(rmd).toBeDefined()
    const details = (rmd!.payload as { message: Record<string, unknown> }).message
    expect(details.resource_id).toBe(RM_DETAILS.resourceId)
    expect(details.name).toBe(RM_DETAILS.name)
  })
})

describe('S2ResourceManager - control-type selection and S2/0/Active', () => {
  it('emits S2/0/Active: 1 for an active control type, 0 for NO_SELECTION/NOT_CONTROLABLE', () => {
    const { rm, transportMsgs } = setup()
    connectAndHandshake(rm)
    transportMsgs.length = 0

    rm.handleInput({
      payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.SELECT_CONTROL_TYPE, message_id: 'sct1', control_type: 'OPERATION_MODE_BASED_CONTROL' }) }
    }, jest.fn())

    const active = transportMsgs.find(m => (m?.payload as Record<string, unknown>)?.['S2/0/Active'] !== undefined)
    expect(active).toBeDefined()
    expect((active!.payload as Record<string, unknown>)['S2/0/Active']).toBe(1)
  })
})

describe('S2ResourceManager - instruction acknowledgment and routing', () => {
  it('emits an immediate OMBC instruction on the CEM output with topic set to message_type', () => {
    const { rm, cemMsgs } = setup()
    connectAndHandshake(rm)
    cemMsgs.length = 0

    rm.handleInput({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-1',
          id: 'instr-1',
          execution_time: new Date(Date.now() - 1000).toISOString(),
          operation_mode_id: 'mode-1',
          operation_mode_factor: 1,
          abnormal_condition: false
        })
      }
    }, jest.fn())

    const instr = cemMsgs.find(m => m?.topic === MessageType.OMBC_INSTRUCTION)
    expect(instr).toBeDefined()
    expect(instr!.cemId).toBe('cem-1')
  })
})

describe('S2ResourceManager - UpdateStatus / SystemDescription commands', () => {
  it('sends OMBC.SystemDescription to the CEM for a SystemDescription command', () => {
    const { rm, transportMsgs } = setup()
    connectAndHandshake(rm)
    transportMsgs.length = 0

    rm.handleInput({
      payload: {
        command: 'SystemDescription',
        cemId: 'cem-1',
        controlType: 'OPERATION_MODE_BASED_CONTROL',
        ombc: {
          operationModes: [{
            id: 'mode-on',
            diagnostic_label: 'On',
            power_ranges: [{ start_of_range: 0, end_of_range: 1000, commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC' }],
            abnormal_condition_only: false
          }],
          transitions: [],
          timers: []
        }
      }
    }, jest.fn())

    const sysDesc = transportMsgs.find(m => {
      const payload = m?.payload as { message?: { message_type?: string } } | undefined
      return payload?.message?.message_type === MessageType.OMBC_SYSTEM_DESCRIPTION
    })
    expect(sysDesc).toBeDefined()
  })

  it('warns and does not throw when a command targets an unknown CEM', () => {
    const { rm, warnings } = setup()
    const done = jest.fn()

    rm.handleInput({ payload: { command: 'UpdateStatus', cemId: 'cem-unknown', controlType: 'OPERATION_MODE_BASED_CONTROL', ombc: {} } }, done)

    expect(done).toHaveBeenCalledWith()
    expect(warnings.length).toBeGreaterThan(0)
  })
})

describe('S2ResourceManager - pending instruction context', () => {
  it('persists a future instruction via the injected context store', () => {
    const { rm, contextStore } = setup()
    connectAndHandshake(rm)

    const futureTime = new Date(Date.now() + 60000).toISOString()
    rm.handleInput({
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
    }, jest.fn())

    const pending = contextStore.s2PendingInstructions as unknown[]
    expect(Array.isArray(pending)).toBe(true)
    expect(pending.length).toBe(1)
  })
})

describe('S2ResourceManager - close', () => {
  it('disposes sessions without throwing', () => {
    const { rm } = setup()
    connectAndHandshake(rm)
    expect(() => rm.close()).not.toThrow()
  })
})

function rmdMessages (msgs: Msg[]): Record<string, unknown>[] {
  return msgs
    .map(m => (m?.payload as { message?: Record<string, unknown> } | undefined)?.message)
    .filter((m): m is Record<string, unknown> => !!m && m.message_type === MessageType.RESOURCE_MANAGER_DETAILS)
}

describe('S2ResourceManager - available control types', () => {
  it('does not add NOT_CONTROLABLE when the configured list omits it', () => {
    const { rm, transportMsgs } = setup()
    connectAndHandshake(rm)

    const [rmd] = rmdMessages(transportMsgs)
    expect(rmd.available_control_types).toEqual(['OPERATION_MODE_BASED_CONTROL'])
  })

  it('SetAvailableControlTypes replaces the list verbatim (no NOT_CONTROLABLE added) and resends ResourceManagerDetails to a connected session', () => {
    const { rm, transportMsgs } = setup()
    connectAndHandshake(rm)
    transportMsgs.length = 0

    const done = jest.fn()
    rm.handleInput({ payload: { command: 'SetAvailableControlTypes', availableControlTypes: ['POWER_ENVELOPE_BASED_CONTROL'] } }, done)

    expect(done).toHaveBeenCalledWith()
    const [rmd] = rmdMessages(transportMsgs)
    expect(rmd).toBeDefined()
    expect(rmd.available_control_types).toEqual(['POWER_ENVELOPE_BASED_CONTROL'])
  })

  it('rejects an unknown control type before changing state or resending ResourceManagerDetails', () => {
    const { rm, transportMsgs } = setup()
    connectAndHandshake(rm)
    transportMsgs.length = 0

    const done = jest.fn()
    rm.handleInput({ payload: { command: 'SetAvailableControlTypes', availableControlTypes: ['OPERATION_MODE_BASED_CONTROOL'] } }, done)

    expect(done).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('unknown control type') }))
    expect(transportMsgs).toHaveLength(0)

    rm.handleInput({ payload: { command: 'SetAvailableControlTypes', isControllable: true } }, jest.fn())
    const [rmd] = rmdMessages(transportMsgs)
    expect(rmd.available_control_types).toEqual(['OPERATION_MODE_BASED_CONTROL'])
  })

  it('applies before any CEM connects and is reflected in the next handshake', () => {
    const { rm, transportMsgs } = setup()

    rm.handleInput({ payload: { command: 'SetAvailableControlTypes', availableControlTypes: ['FILL_RATE_BASED_CONTROL'] } }, jest.fn())
    expect(rmdMessages(transportMsgs).length).toBe(0)

    connectAndHandshake(rm)
    const [rmd] = rmdMessages(transportMsgs)
    expect(rmd.available_control_types).toEqual(['FILL_RATE_BASED_CONTROL'])
  })

  it('isControllable: false advertises exactly [NOT_CONTROLABLE] when initially available', () => {
    const { rm, transportMsgs } = setup({
      rmDetails: { ...RM_DETAILS, availableControlTypes: ['NOT_CONTROLABLE', 'OPERATION_MODE_BASED_CONTROL'] }
    })
    connectAndHandshake(rm)
    transportMsgs.length = 0

    const done = jest.fn()
    rm.handleInput({ payload: { command: 'SetAvailableControlTypes', isControllable: false } }, done)

    expect(done).toHaveBeenCalledWith()
    const [rmd] = rmdMessages(transportMsgs)
    expect(rmd.available_control_types).toEqual(['NOT_CONTROLABLE'])
  })

  it('rejects isControllable: false when NOT_CONTROLABLE was initially unavailable', () => {
    const { rm, transportMsgs } = setup({
      rmDetails: { ...RM_DETAILS, availableControlTypes: ['OPERATION_MODE_BASED_CONTROL'] }
    })
    connectAndHandshake(rm)
    transportMsgs.length = 0

    const done = jest.fn()
    rm.handleInput({ payload: { command: 'SetAvailableControlTypes', isControllable: false } }, done)

    expect(done).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('NOT_CONTROLABLE') }))
    expect(transportMsgs).toHaveLength(0)
  })

  it('isControllable: true restores the constructor\'s configured list, including after a prior list-form SetAvailableControlTypes call', () => {
    const { rm, transportMsgs } = setup({
      rmDetails: { ...RM_DETAILS, availableControlTypes: ['OPERATION_MODE_BASED_CONTROL', 'NOT_CONTROLABLE'] }
    })
    connectAndHandshake(rm)
    rm.handleInput({ payload: { command: 'SetAvailableControlTypes', availableControlTypes: ['POWER_ENVELOPE_BASED_CONTROL'] } }, jest.fn())
    transportMsgs.length = 0

    const done = jest.fn()
    rm.handleInput({ payload: { command: 'SetAvailableControlTypes', isControllable: true } }, done)

    expect(done).toHaveBeenCalledWith()
    const [rmd] = rmdMessages(transportMsgs)
    expect(rmd.available_control_types).toEqual(['OPERATION_MODE_BASED_CONTROL', 'NOT_CONTROLABLE'])
  })

  it('rejects a SetAvailableControlTypes payload specifying both availableControlTypes and isControllable', () => {
    const { rm, transportMsgs } = setup()
    connectAndHandshake(rm)
    transportMsgs.length = 0

    const done = jest.fn()
    rm.handleInput({ payload: { command: 'SetAvailableControlTypes', availableControlTypes: ['POWER_ENVELOPE_BASED_CONTROL'], isControllable: true } }, done)

    expect(done).toHaveBeenCalledWith(expect.any(Error))
    expect(rmdMessages(transportMsgs).length).toBe(0)
  })

  it('rejects a SetAvailableControlTypes payload specifying neither availableControlTypes nor isControllable', () => {
    const { rm, transportMsgs } = setup()
    connectAndHandshake(rm)
    transportMsgs.length = 0

    const done = jest.fn()
    rm.handleInput({ payload: { command: 'SetAvailableControlTypes' } }, done)

    expect(done).toHaveBeenCalledWith(expect.any(Error))
    expect(rmdMessages(transportMsgs).length).toBe(0)
  })

  it('resends ResourceManagerDetails to every connected CEM', () => {
    const { rm, transportMsgs } = setup()
    connectAndHandshake(rm, 'cem-1')
    connectAndHandshake(rm, 'cem-2')
    transportMsgs.length = 0

    rm.handleInput({ payload: { command: 'SetAvailableControlTypes', availableControlTypes: ['POWER_ENVELOPE_BASED_CONTROL'] } }, jest.fn())

    const resent = rmdMessages(transportMsgs)
    expect(resent.length).toBe(2)
    const cemIds = transportMsgs.filter(m => rmdMessages([m]).length > 0).map(m => m?.cemId)
    expect(cemIds.sort()).toEqual(['cem-1', 'cem-2'])
  })

  it('does not force a deselect or disconnect when the CEM\'s active control type becomes unavailable', () => {
    const { rm, transportMsgs, cemMsgs, warnings } = setup()
    connectAndHandshake(rm)
    rm.handleInput({
      payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.SELECT_CONTROL_TYPE, message_id: 'sct1', control_type: 'OPERATION_MODE_BASED_CONTROL' }) }
    }, jest.fn())
    transportMsgs.length = 0
    cemMsgs.length = 0

    rm.handleInput({ payload: { command: 'SetAvailableControlTypes', availableControlTypes: ['POWER_ENVELOPE_BASED_CONTROL'] } }, jest.fn())

    // Only the RMD resend happens - no S2/0/Active flip, no Disconnected event.
    expect(transportMsgs.some(m => (m?.payload as Record<string, unknown>)?.['S2/0/Active'] !== undefined)).toBe(false)
    expect(cemMsgs.some(m => m?.topic === 'Disconnected')).toBe(false)

    // The session itself is still usable afterward.
    const pmDone = jest.fn()
    rm.handleInput({ payload: { command: 'PowerMeasurement', cemId: 'cem-1', values: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: 100 }] } }, pmDone)
    expect(pmDone).toHaveBeenCalledWith()
    expect(warnings.length).toBe(0)
  })

  it('resent ResourceManagerDetails carries a fresh message_id and unchanged identity/capability fields', () => {
    const { rm, transportMsgs } = setup()
    connectAndHandshake(rm)
    const [initialRmd] = rmdMessages(transportMsgs)
    transportMsgs.length = 0

    rm.handleInput({ payload: { command: 'SetAvailableControlTypes', availableControlTypes: ['POWER_ENVELOPE_BASED_CONTROL'] } }, jest.fn())

    const [resentRmd] = rmdMessages(transportMsgs)
    expect(resentRmd.message_id).not.toBe(initialRmd.message_id)
    expect(resentRmd.resource_id).toBe(RM_DETAILS.resourceId)
    expect(resentRmd.roles).toEqual(initialRmd.roles)
    expect(resentRmd.instruction_processing_delay).toBe(initialRmd.instruction_processing_delay)
    expect(resentRmd.provides_forecast).toBe(initialRmd.provides_forecast)
    expect(resentRmd.provides_power_measurement_types).toEqual(initialRmd.provides_power_measurement_types)
  })
})
