import {
  MessageType,
  ControlType,
  ReceptionStatusResult,
  parse,
  serialize,
  makeReceptionStatus,
  makeHandshake,
  makeResourceManagerDetails,
  makeOMBCSystemDescription,
  makeOMBCStatus,
  makePowerMeasurement,
  generateId
} from '../../src/lib/s2/messages'

describe('generateId', () => {
  it('returns a string', () => {
    expect(typeof generateId()).toBe('string')
  })

  it('returns unique values', () => {
    expect(generateId()).not.toBe(generateId())
  })
})

describe('parse', () => {
  it('parses a valid S2 message', () => {
    const raw = JSON.stringify({ message_type: 'Handshake', message_id: '123' })
    const onError = jest.fn()
    const result = parse(raw, onError)
    expect(result).toEqual({ message_type: 'Handshake', message_id: '123' })
    expect(onError).not.toHaveBeenCalled()
  })

  it('returns null and calls onError for invalid JSON', () => {
    const onError = jest.fn()
    const result = parse('{invalid', onError)
    expect(result).toBeNull()
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })

  it('returns null and calls onError when message_type is missing', () => {
    const onError = jest.fn()
    const result = parse(JSON.stringify({ message_id: '123' }), onError)
    expect(result).toBeNull()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('message_type') }))
  })
})

describe('serialize', () => {
  it('serializes an object to JSON string', () => {
    const msg = { message_type: 'Handshake', message_id: '123' }
    expect(serialize(msg)).toBe(JSON.stringify(msg))
  })
})

describe('makeReceptionStatus', () => {
  it('creates a ReceptionStatus message', () => {
    const msg = makeReceptionStatus('subject-123', ReceptionStatusResult.OK)
    expect(msg.message_type).toBe(MessageType.RECEPTION_STATUS)
    expect(msg.subject_message_id).toBe('subject-123')
    expect(msg.status).toBe(ReceptionStatusResult.OK)
    expect((msg as unknown as Record<string, unknown>).message_id).toBeUndefined() // ReceptionStatus does not have message_id per S2 spec
  })

  it('includes diagnostic_label when provided', () => {
    const msg = makeReceptionStatus('subject-123', ReceptionStatusResult.PERMANENT_ERROR, 'bad message')
    expect(msg.diagnostic_label).toBe('bad message')
  })

  it('omits diagnostic_label when not provided', () => {
    const msg = makeReceptionStatus('subject-123', ReceptionStatusResult.OK)
    expect(msg.diagnostic_label).toBeUndefined()
  })
})

describe('makeHandshake', () => {
  it('creates a Handshake message with role RM', () => {
    const msg = makeHandshake('rm-id-1')
    expect(msg.message_type).toBe(MessageType.HANDSHAKE)
    expect(msg.role).toBe('RM')
    expect(msg.message_id).toBeDefined()
    expect(Array.isArray(msg.supported_protocol_versions)).toBe(true)
  })
})

describe('makeResourceManagerDetails', () => {
  it('creates a ResourceManagerDetails message with all required fields', () => {
    const msg = makeResourceManagerDetails({
      resourceId: 'rm-123',
      name: 'Test RM',
      roles: [{ role: 'ENERGY_CONSUMER', commodity: 'ELECTRICITY' }],
      availableControlTypes: ['OPERATION_MODE_BASED_CONTROL'],
      providesForecast: false,
      providesPowerMeasurementTypes: ['ELECTRIC.POWER.3_PHASE_SYMMETRIC']
    })
    expect(msg.message_type).toBe(MessageType.RESOURCE_MANAGER_DETAILS)
    expect(msg.message_id).toBeDefined()
    expect(msg.resource_id).toBe('rm-123')
    expect(msg.name).toBe('Test RM')
    expect(msg.roles).toEqual([{ role: 'ENERGY_CONSUMER', commodity: 'ELECTRICITY' }])
    expect(msg.available_control_types).toEqual(['OPERATION_MODE_BASED_CONTROL'])
    expect(msg.provides_forecast).toBe(false)
    expect(msg.provides_power_measurement_types).toEqual(['ELECTRIC.POWER.3_PHASE_SYMMETRIC'])
  })

  it('includes empty provides_power_measurement_types when empty array provided', () => {
    const msg = makeResourceManagerDetails({
      resourceId: 'rm-123',
      name: 'Test RM',
      roles: [{ role: 'ENERGY_CONSUMER', commodity: 'ELECTRICITY' }],
      availableControlTypes: ['OPERATION_MODE_BASED_CONTROL'],
      providesForecast: false,
      providesPowerMeasurementTypes: []
    })
    expect(msg.provides_power_measurement_types).toEqual([])
  })

  it('defaults provides_power_measurement_types to empty array when omitted', () => {
    const msg = makeResourceManagerDetails({
      resourceId: 'rm-123',
      name: 'Test RM',
      roles: [{ role: 'ENERGY_CONSUMER', commodity: 'ELECTRICITY' }],
      availableControlTypes: ['OPERATION_MODE_BASED_CONTROL'],
      providesForecast: false
    })
    expect(msg.provides_power_measurement_types).toEqual([])
  })

  it('includes optional manufacturer and model information', () => {
    const msg = makeResourceManagerDetails({
      resourceId: 'rm-123',
      name: 'Test RM',
      roles: [{ role: 'ENERGY_CONSUMER', commodity: 'ELECTRICITY' }],
      availableControlTypes: ['OPERATION_MODE_BASED_CONTROL'],
      providesForecast: false,
      manufacturer: 'Victron Energy',
      model: 'Virtual AC Load',
      serialNumber: 'SN12345',
      firmwareVersion: '1.0.0'
    })
    expect(msg.manufacturer).toBe('Victron Energy')
    expect(msg.model).toBe('Virtual AC Load')
    expect(msg.serial_number).toBe('SN12345')
    expect(msg.firmware_version).toBe('1.0.0')
  })
})

describe('makeOMBCSystemDescription', () => {
  it('creates an OMBC.SystemDescription message with required fields', () => {
    const msg = makeOMBCSystemDescription({
      operationModes: [
        {
          id: 'mode-1',
          power_ranges: [{ start_of_range: 0, end_of_range: 100, commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC' }],
          abnormal_condition_only: false
        }
      ]
    })
    expect(msg.message_type).toBe(MessageType.OMBC_SYSTEM_DESCRIPTION)
    expect(msg.message_id).toBeDefined()
    expect(msg.valid_from).toBeDefined()
    expect(msg.operation_modes).toEqual([
      {
        id: 'mode-1',
        power_ranges: [{ start_of_range: 0, end_of_range: 100, commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC' }],
        abnormal_condition_only: false
      }
    ])
    expect(msg.transitions).toEqual([])
    expect(msg.timers).toEqual([])
  })

  it('includes transitions and timers when provided', () => {
    const transitions = [{ id: 't1', from: 'mode-1', to: 'mode-2' }]
    const timers = [{ id: 'timer-1', duration: 60000 }]
    const msg = makeOMBCSystemDescription({
      operationModes: [],
      transitions,
      timers
    })
    expect(msg.transitions).toEqual(transitions)
    expect(msg.timers).toEqual(timers)
  })
})

describe('makeOMBCStatus', () => {
  it('creates an OMBC.Status message with required fields', () => {
    const msg = makeOMBCStatus({
      activeOperationModeId: 'mode-1'
    })
    expect(msg.message_type).toBe(MessageType.OMBC_STATUS)
    expect(msg.message_id).toBeDefined()
    expect(msg.active_operation_mode_id).toBe('mode-1')
    expect(msg.operation_mode_factor).toBe(1)
  })

  it('includes optional fields when provided', () => {
    const msg = makeOMBCStatus({
      activeOperationModeId: 'mode-2',
      operationModeFactor: 0.5,
      previousOperationModeId: 'mode-1',
      transitionTimestamp: '2026-04-08T12:00:00Z'
    })
    expect(msg.active_operation_mode_id).toBe('mode-2')
    expect(msg.operation_mode_factor).toBe(0.5)
    expect(msg.previous_operation_mode_id).toBe('mode-1')
    expect(msg.transition_timestamp).toBe('2026-04-08T12:00:00Z')
  })

  it('omits optional fields when not provided', () => {
    const msg = makeOMBCStatus({
      activeOperationModeId: 'mode-1',
      operationModeFactor: 0.75
    })
    expect(msg.previous_operation_mode_id).toBeUndefined()
    expect(msg.transition_timestamp).toBeUndefined()
  })
})

describe('makePowerMeasurement', () => {
  it('creates a PowerMeasurement message with required fields', () => {
    const values = [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: 1500 }]
    const msg = makePowerMeasurement(values)
    expect(msg.message_type).toBe(MessageType.POWER_MEASUREMENT)
    expect(msg.message_id).toBeDefined()
    expect(msg.measurement_timestamp).toBeDefined()
    expect(new Date(msg.measurement_timestamp).getTime()).not.toBeNaN()
    expect(msg.values).toEqual(values)
  })

  it('sets measurement_timestamp to a timezone-aware ISO string', () => {
    const msg = makePowerMeasurement([{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: 0 }])
    expect(msg.measurement_timestamp).toMatch(/Z$/)
  })
})

describe('MessageType', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(MessageType)).toBe(true)
  })
})

describe('ControlType', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(ControlType)).toBe(true)
  })
})
