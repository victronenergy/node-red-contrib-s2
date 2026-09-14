import { validateS2Message } from '../../src/lib/s2/schema-validation'
import {
  makeResourceManagerDetails, makeOMBCSystemDescription, makeHandshake, makeReceptionStatus,
  makeOMBCStatus, makePowerMeasurement, makePEBCPowerConstraints, makePowerForecast,
  makeInstructionStatusUpdate, RmDetails, ReceptionStatusResult, InstructionStatus
} from '../../src/lib/s2/messages'

const RM_DETAILS: RmDetails = {
  resourceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  name: 'Test RM',
  roles: [{ role: 'ENERGY_CONSUMER', commodity: 'ELECTRICITY' }],
  availableControlTypes: ['OPERATION_MODE_BASED_CONTROL', 'NOT_CONTROLABLE'],
  providesForecast: false,
  providesPowerMeasurementTypes: ['ELECTRIC.POWER.3_PHASE_SYMMETRIC'],
  manufacturer: 'Acme',
  model: 'X1',
  serialNumber: 'sn-1',
  firmwareVersion: '2.0.0'
}

describe('validateS2Message - ResourceManagerDetails', () => {
  it('accepts a valid ResourceManagerDetails built by this repo\'s own makeResourceManagerDetails()', () => {
    const msg = makeResourceManagerDetails(RM_DETAILS)
    const result = validateS2Message(msg)
    expect(result.valid).toBe(true)
    expect(result.errors).toBeUndefined()
  })

  it('rejects a ResourceManagerDetails missing a required field', () => {
    const msg = makeResourceManagerDetails(RM_DETAILS) as unknown as Record<string, unknown>
    delete msg.resource_id
    const result = validateS2Message(msg)
    expect(result.valid).toBe(false)
    expect(result.errors?.join(' ')).toMatch(/resource_id/)
  })

  it('rejects an available_control_types entry that is not a real ControlType value', () => {
    const msg = makeResourceManagerDetails({ ...RM_DETAILS, availableControlTypes: ['NOT_A_REAL_CONTROL_TYPE'] }) as unknown as Record<string, unknown>
    const result = validateS2Message(msg)
    expect(result.valid).toBe(false)
  })

  it('treats a 6-entry available_control_types (5 real types + NOT_CONTROLABLE) as valid, flagged advisory - not blocked', () => {
    const msg = makeResourceManagerDetails({
      ...RM_DETAILS,
      availableControlTypes: [
        'OPERATION_MODE_BASED_CONTROL',
        'FILL_RATE_BASED_CONTROL',
        'DEMAND_DRIVEN_BASED_CONTROL',
        'POWER_PROFILE_BASED_CONTROL',
        'POWER_ENVELOPE_BASED_CONTROL',
        'NOT_CONTROLABLE'
      ]
    })
    const result = validateS2Message(msg)
    expect(result.valid).toBe(true)
    expect(result.errors).toBeUndefined()
    expect(result.advisory?.join(' ')).toMatch(/available_control_types/)
  })

  it('still rejects a genuinely malformed message even when it also happens to exceed maxItems', () => {
    const msg = makeResourceManagerDetails({
      ...RM_DETAILS,
      availableControlTypes: ['OPERATION_MODE_BASED_CONTROL', 'FILL_RATE_BASED_CONTROL', 'DEMAND_DRIVEN_BASED_CONTROL', 'POWER_PROFILE_BASED_CONTROL', 'POWER_ENVELOPE_BASED_CONTROL', 'NOT_CONTROLABLE']
    }) as unknown as Record<string, unknown>
    delete msg.roles
    const result = validateS2Message(msg)
    expect(result.valid).toBe(false)
    expect(result.errors?.join(' ')).toMatch(/roles/)
  })
})

describe('validateS2Message - OMBC.SystemDescription', () => {
  it('accepts a valid system description built by makeOMBCSystemDescription()', () => {
    const msg = makeOMBCSystemDescription({
      operationModes: [{
        id: 'mode-1',
        diagnostic_label: 'On',
        power_ranges: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', start_of_range: 0, end_of_range: 0 }],
        abnormal_condition_only: false
      }],
      transitions: [],
      timers: []
    })
    const result = validateS2Message(msg)
    expect(result.valid).toBe(true)
  })

  it('rejects an operation mode missing a required field', () => {
    const msg = makeOMBCSystemDescription({
      operationModes: [{ id: 'mode-1' } as unknown as unknown as Record<string, unknown>],
      transitions: [],
      timers: []
    })
    const result = validateS2Message(msg)
    expect(result.valid).toBe(false)
  })
})

describe('validateS2Message - message types without a vendored schema', () => {
  it('returns valid: true for a message_type with no matching schema file', () => {
    const result = validateS2Message({ message_type: 'SomeFutureMessageType', foo: 'bar' })
    expect(result.valid).toBe(true)
    expect(result.errors).toBeUndefined()
  })
})

describe('validateS2Message - malformed input', () => {
  it('returns valid: true when the payload has no message_type at all', () => {
    expect(validateS2Message({ foo: 'bar' })).toEqual({ valid: true })
  })

  it('returns valid: true for a non-object payload', () => {
    expect(validateS2Message('not an object')).toEqual({ valid: true })
    expect(validateS2Message(null)).toEqual({ valid: true })
  })
})

describe('validateS2Message - Handshake (a message type this repo also sends)', () => {
  it('accepts a valid Handshake built by makeHandshake()', () => {
    const msg = makeHandshake('rm-id')
    const result = validateS2Message(msg)
    expect(result.valid).toBe(true)
  })
})

// Every make*() builder this repo actually uses to construct an outgoing message, checked
// against the real vendored schema - a safety net before this validator becomes a hard gate on
// the send path (src/lib/s2/session.ts). A failure here means either messages.ts's own shape is
// wrong, or the schema genuinely disagrees with something this repo has always sent.
describe('validateS2Message - every outgoing message builder in messages.ts', () => {
  it('makeReceptionStatus()', () => {
    expect(validateS2Message(makeReceptionStatus('subj-1', ReceptionStatusResult.OK)).valid).toBe(true)
    expect(validateS2Message(makeReceptionStatus('subj-1', ReceptionStatusResult.INVALID_CONTENT, 'bad field')).valid).toBe(true)
  })

  it('makeOMBCStatus()', () => {
    const result = validateS2Message(makeOMBCStatus({ activeOperationModeId: 'mode-1', operationModeFactor: 1 }))
    expect(result.valid).toBe(true)
  })

  it('makeOMBCStatus() with previous mode and transition timestamp', () => {
    const result = validateS2Message(makeOMBCStatus({
      activeOperationModeId: 'mode-2',
      operationModeFactor: 0.5,
      previousOperationModeId: 'mode-1',
      transitionTimestamp: new Date().toISOString()
    }))
    expect(result.valid).toBe(true)
  })

  it('makePowerMeasurement()', () => {
    const result = validateS2Message(makePowerMeasurement([{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: 1500 }]))
    expect(result.valid).toBe(true)
  })

  it('makePEBCPowerConstraints()', () => {
    const result = validateS2Message(makePEBCPowerConstraints({ commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', minPower: -3000, maxPower: 3000 }))
    expect(result.valid).toBe(true)
    expect(result.errors).toBeUndefined()
  })

  it('makePowerForecast()', () => {
    const result = validateS2Message(makePowerForecast({
      startTime: new Date().toISOString(),
      elements: [{ duration: 60000, power_values: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value_expected: 1000 }] }]
    }))
    expect(result.valid).toBe(true)
  })

  it('makeInstructionStatusUpdate()', () => {
    const result = validateS2Message(makeInstructionStatusUpdate('instr-1', InstructionStatus.ACCEPTED))
    expect(result.valid).toBe(true)
  })
})
