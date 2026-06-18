import { S2Session, State, S2SessionOptions } from '../../src/lib/s2/session'
import { MessageType, ControlType, InstructionStatus, serialize } from '../../src/lib/s2/messages'

const defaultRmDetails = {
  resourceId: 'resource-uuid-1',
  name: 'Test AC Load',
  roles: [{ role: 'ENERGY_CONSUMER', commodity: 'ELECTRICITY' }],
  availableControlTypes: [ControlType.OMBC],
  providesForecast: false,
  providesPowerMeasurementTypes: [],
  instructionProcessingDelay: 0
}

function makeSession (overrides: Partial<S2SessionOptions> = {}) {
  const onSend = jest.fn()
  const onStateChange = jest.fn()
  const onMessage = jest.fn()
  const onError = jest.fn()
  const session = new S2Session({
    cemId: 'cem-1',
    rmDetails: defaultRmDetails,
    onSend,
    onStateChange,
    onMessage,
    onError,
    ...overrides
  })
  return { session, onSend, onStateChange, onMessage, onError }
}

function raw (obj: object): string {
  return serialize(obj)
}

describe('S2Session initial state', () => {
  it('starts in HANDSHAKING', () => {
    const { session } = makeSession()
    expect(session.state).toBe(State.HANDSHAKING)
  })

  it('exposes cemId', () => {
    const { session } = makeSession()
    expect(session.cemId).toBe('cem-1')
  })

  it('starts with NO_SELECTION control type', () => {
    const { session } = makeSession()
    expect(session.selectedControlType).toBe(ControlType.NO_SELECTION)
  })
})

describe('S2Session start', () => {
  it('sends a Handshake via onSend', () => {
    const { session, onSend } = makeSession()
    session.start()
    expect(onSend).toHaveBeenCalledTimes(1)
    const msg = onSend.mock.calls[0][0]
    expect(msg.message_type).toBe(MessageType.HANDSHAKE)
    expect(msg.role).toBe('RM')
    expect(Array.isArray(msg.supported_protocol_versions)).toBe(true)
  })

  it('remains in HANDSHAKING after start', () => {
    const { session } = makeSession()
    session.start()
    expect(session.state).toBe(State.HANDSHAKING)
  })
})

describe('S2Session CEM Handshake', () => {
  it('sends ReceptionStatus OK and forwards via onMessage', () => {
    const onInstruction = jest.fn()
    const { session, onSend, onMessage } = makeSession({ onInstruction })
    session.start()
    onSend.mockClear()

    session.handleMessage(raw({
      message_type: MessageType.HANDSHAKE,
      message_id: 'cem-hs-1',
      role: 'CEM',
      supported_protocol_versions: ['0.0.2-beta']
    }))

    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({
      message_type: MessageType.RECEPTION_STATUS,
      subject_message_id: 'cem-hs-1',
      status: 'OK'
    }))
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ message_type: MessageType.HANDSHAKE }))
    expect(onInstruction).not.toHaveBeenCalled()
  })
})

describe('S2Session HandshakeResponse', () => {
  function startedSession () {
    const mocks = makeSession()
    mocks.session.start()
    mocks.onSend.mockClear()
    return mocks
  }

  it('transitions to CONNECTED on HandshakeResponse', () => {
    const { session, onStateChange, onMessage } = startedSession()

    session.handleMessage(raw({
      message_type: MessageType.HANDSHAKE_RESPONSE,
      message_id: 'hr1',
      selected_protocol_version: '0.0.2-beta'
    }))

    expect(session.state).toBe(State.CONNECTED)
    expect(onStateChange).toHaveBeenCalledWith(State.CONNECTED)
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ message_type: MessageType.HANDSHAKE_RESPONSE }))
  })

  it('sends ReceptionStatus for HandshakeResponse', () => {
    const { session, onSend } = startedSession()

    session.handleMessage(raw({
      message_type: MessageType.HANDSHAKE_RESPONSE,
      message_id: 'hr1',
      selected_protocol_version: '0.0.2-beta'
    }))

    const ack = onSend.mock.calls[0][0]
    expect(ack.message_type).toBe(MessageType.RECEPTION_STATUS)
    expect(ack.subject_message_id).toBe('hr1')
    expect(ack.status).toBe('OK')
  })

  it('sends ResourceManagerDetails after HandshakeResponse', () => {
    const { session, onSend } = startedSession()

    session.handleMessage(raw({
      message_type: MessageType.HANDSHAKE_RESPONSE,
      message_id: 'hr1',
      selected_protocol_version: '0.0.2-beta'
    }))

    // call[0] is ReceptionStatus for HandshakeResponse, call[1] is ResourceManagerDetails
    const rmd = onSend.mock.calls[1][0]
    expect(rmd.message_type).toBe(MessageType.RESOURCE_MANAGER_DETAILS)
    expect(rmd.resource_id).toBe(defaultRmDetails.resourceId)
    expect(rmd.name).toBe(defaultRmDetails.name)
    expect(rmd.available_control_types).toEqual([ControlType.OMBC])
    expect(rmd.provides_power_measurement_types).toEqual([])
    expect(rmd.instruction_processing_delay).toBe(0)
    expect(rmd.message_id).toBeDefined()
  })

  it('calls onError when no rmDetails configured', () => {
    const onSend = jest.fn()
    const onError = jest.fn()
    const session = new S2Session({ cemId: 'cem-1', onSend, onError })
    session.start()
    session.handleMessage(raw({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('rmDetails') }))
  })

  it('calls onError if HandshakeResponse arrives when already CONNECTED', () => {
    const { session, onError } = startedSession()
    const hr = raw({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' })
    session.handleMessage(hr)
    session.handleMessage(hr)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('HandshakeResponse') }))
  })
})

describe('S2Session SelectControlType', () => {
  const defaultOmbcConfig = {
    OMBC: {
      systemDescription: {
        operationModes: [
          {
            id: 'normal',
            diagnostic_label: 'Normal operation',
            power_ranges: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', start_of_range: 0, end_of_range: 2500 }],
            abnormal_condition_only: false
          }
        ],
        transitions: [],
        timers: []
      },
      status: { activeOperationModeId: 'normal', operationModeFactor: 1 }
    }
  }

  function connectedSession (controlTypeConfig = {}) {
    const mocks = makeSession({ controlTypeConfig })
    mocks.session.start()
    mocks.session.handleMessage(raw({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))
    mocks.onSend.mockClear()
    mocks.onMessage.mockClear()
    return mocks
  }

  it('acks SelectControlType and updates selectedControlType', () => {
    const { session, onSend, onMessage } = connectedSession()

    session.handleMessage(raw({
      message_type: MessageType.SELECT_CONTROL_TYPE,
      message_id: 'sc1',
      control_type: 'FRBC'
    }))

    expect(session.selectedControlType).toBe('FRBC')

    const ack = onSend.mock.calls[0][0]
    expect(ack.message_type).toBe(MessageType.RECEPTION_STATUS)
    expect(ack.subject_message_id).toBe('sc1')
    expect(ack.status).toBe('OK')

    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ message_type: MessageType.SELECT_CONTROL_TYPE }))
  })

  it('acks NOT_CONTROLABLE and sends nothing else', () => {
    const { session, onSend, onMessage } = connectedSession()

    session.handleMessage(raw({
      message_type: MessageType.SELECT_CONTROL_TYPE,
      message_id: 'sc-nc',
      control_type: ControlType.NOT_CONTROLABLE
    }))

    expect(session.selectedControlType).toBe(ControlType.NOT_CONTROLABLE)
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0][0].message_type).toBe(MessageType.RECEPTION_STATUS)
    expect(onSend.mock.calls[0][0].subject_message_id).toBe('sc-nc')
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ message_type: MessageType.SELECT_CONTROL_TYPE }))
  })

  it('sends OMBC.SystemDescription and OMBC.Status after selecting OMBC', () => {
    const { session, onSend } = connectedSession(defaultOmbcConfig)

    session.handleMessage(raw({
      message_type: MessageType.SELECT_CONTROL_TYPE,
      message_id: 'sc2',
      control_type: 'OPERATION_MODE_BASED_CONTROL'
    }))

    expect(session.selectedControlType).toBe('OPERATION_MODE_BASED_CONTROL')

    // Should send: ReceptionStatus, OMBC.SystemDescription, OMBC.Status
    expect(onSend).toHaveBeenCalledTimes(3)

    const ack = onSend.mock.calls[0][0]
    expect(ack.message_type).toBe(MessageType.RECEPTION_STATUS)

    const sysDesc = onSend.mock.calls[1][0]
    expect(sysDesc.message_type).toBe(MessageType.OMBC_SYSTEM_DESCRIPTION)
    expect(sysDesc.operation_modes).toBeDefined()
    expect(sysDesc.operation_modes.length).toBeGreaterThan(0)
    expect(sysDesc.operation_modes[0].power_ranges).toBeDefined()
    expect(sysDesc.operation_modes[0].power_ranges[0].end_of_range).toBeGreaterThan(0)

    const status = onSend.mock.calls[2][0]
    expect(status.message_type).toBe(MessageType.OMBC_STATUS)
    expect(status.active_operation_mode_id).toBeDefined()
  })

  it('calls onError when OMBC control type is selected but no OMBC config is provided', () => {
    const { session, onSend, onError } = connectedSession()

    session.handleMessage(raw({
      message_type: MessageType.SELECT_CONTROL_TYPE,
      message_id: 'sc-noconfig',
      control_type: 'OPERATION_MODE_BASED_CONTROL'
    }))

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('No OMBC config') }))
    // Only ReceptionStatus should have been sent, not SystemDescription or Status
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0][0].message_type).toBe(MessageType.RECEPTION_STATUS)
  })

  it('uses custom controlTypeConfig when provided', () => {
    const customConfig = {
      OMBC: {
        systemDescription: {
          operationModes: [
            {
              id: 'custom-mode',
              diagnostic_label: 'Custom mode',
              power_ranges: [
                {
                  start_of_range: 0,
                  end_of_range: 5000,
                  commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC'
                }
              ],
              abnormal_condition_only: false
            }
          ],
          transitions: [],
          timers: []
        },
        status: {
          activeOperationModeId: 'custom-mode',
          operationModeFactor: 0.75
        }
      }
    }

    const mocks = makeSession({ controlTypeConfig: customConfig })
    mocks.session.start()
    mocks.session.handleMessage(raw({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))
    mocks.onSend.mockClear()

    mocks.session.handleMessage(raw({
      message_type: MessageType.SELECT_CONTROL_TYPE,
      message_id: 'sc3',
      control_type: 'OPERATION_MODE_BASED_CONTROL'
    }))

    const sysDesc = mocks.onSend.mock.calls[1][0]
    expect(sysDesc.operation_modes[0].id).toBe('custom-mode')
    expect(sysDesc.operation_modes[0].power_ranges[0].end_of_range).toBe(5000)

    const status = mocks.onSend.mock.calls[2][0]
    expect(status.active_operation_mode_id).toBe('custom-mode')
    expect(status.operation_mode_factor).toBe(0.75)
  })
})

describe('S2Session updateOMBCStatus', () => {
  const ombcConfig = {
    OMBC: {
      systemDescription: {
        operationModes: [
          {
            id: 'mode-on',
            power_ranges: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', start_of_range: 0, end_of_range: 2500 }],
            abnormal_condition_only: false
          },
          {
            id: 'mode-off',
            power_ranges: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', start_of_range: 0, end_of_range: 0 }],
            abnormal_condition_only: false
          }
        ],
        transitions: [],
        timers: []
      },
      status: { activeOperationModeId: 'mode-off', operationModeFactor: 1 }
    }
  }

  function connectedWithOmbc () {
    const mocks = makeSession({ controlTypeConfig: ombcConfig })
    mocks.session.start()
    mocks.session.handleMessage(raw({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))
    mocks.onSend.mockClear()
    return mocks
  }

  it('sends OMBC.Status to CEM when called while CONNECTED', () => {
    const { session, onSend } = connectedWithOmbc()

    session.updateOMBCStatus({ activeOperationModeId: 'mode-on', operationModeFactor: 1 })

    expect(onSend).toHaveBeenCalledTimes(1)
    const msg = onSend.mock.calls[0][0]
    expect(msg.message_type).toBe(MessageType.OMBC_STATUS)
    expect(msg.active_operation_mode_id).toBe('mode-on')
    expect(msg.operation_mode_factor).toBe(1)
  })

  it('includes previousOperationModeId when mode changes', () => {
    const { session, onSend } = connectedWithOmbc()

    session.updateOMBCStatus({ activeOperationModeId: 'mode-on', operationModeFactor: 1 })

    const msg = onSend.mock.calls[0][0]
    expect(msg.previous_operation_mode_id).toBe('mode-off')
    expect(msg.transition_timestamp).toBeDefined()
  })

  it('does not include previousOperationModeId when mode stays the same', () => {
    const { session, onSend } = connectedWithOmbc()

    session.updateOMBCStatus({ activeOperationModeId: 'mode-off', operationModeFactor: 1 })

    const msg = onSend.mock.calls[0][0]
    expect(msg.previous_operation_mode_id).toBeUndefined()
  })

  it('uses updated mode when SELECT_CONTROL_TYPE OMBC is received again', () => {
    const { session, onSend } = connectedWithOmbc()
    session.updateOMBCStatus({ activeOperationModeId: 'mode-on', operationModeFactor: 0.5 })
    onSend.mockClear()

    session.handleMessage(raw({
      message_type: MessageType.SELECT_CONTROL_TYPE,
      message_id: 'sc-reselect',
      control_type: 'OPERATION_MODE_BASED_CONTROL'
    }))

    // ReceptionStatus, SystemDescription, Status
    const statusMsg = onSend.mock.calls[2][0]
    expect(statusMsg.message_type).toBe(MessageType.OMBC_STATUS)
    expect(statusMsg.active_operation_mode_id).toBe('mode-on')
    expect(statusMsg.operation_mode_factor).toBe(0.5)
  })

  it('does not send when not CONNECTED', () => {
    const mocks = makeSession({ controlTypeConfig: ombcConfig })
    mocks.session.start()

    mocks.session.updateOMBCStatus({ activeOperationModeId: 'mode-on', operationModeFactor: 1 })

    // Only the Handshake was sent, updateOMBCStatus should not have sent anything
    expect(mocks.onSend).toHaveBeenCalledTimes(1)
    expect(mocks.onSend.mock.calls[0][0].message_type).toBe(MessageType.HANDSHAKE)
  })
})

describe('S2Session instruction handling', () => {
  const instructionTypes = [
    MessageType.FRBC_INSTRUCTION,
    MessageType.DDBC_INSTRUCTION,
    MessageType.OMBC_INSTRUCTION,
    MessageType.PEBC_INSTRUCTION,
    MessageType.PPBC_SCHEDULE_INSTRUCTION
  ]

  function connectedSession () {
    const mocks = makeSession()
    mocks.session.start()
    mocks.session.handleMessage(raw({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))
    mocks.onSend.mockClear()
    mocks.onMessage.mockClear()
    return mocks
  }

  instructionTypes.forEach((type) => {
    it(`acks and forwards ${type}`, () => {
      const { session, onSend, onMessage } = connectedSession()
      session.handleMessage(raw({ message_type: type, message_id: 'i1' }))
      const ack = onSend.mock.calls[0][0]
      expect(ack.message_type).toBe(MessageType.RECEPTION_STATUS)
      expect(ack.subject_message_id).toBe('i1')
      expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ message_type: type }))
    })
  })
})

describe('S2Session send', () => {
  it('calls onSend when CONNECTED', () => {
    const { session, onSend } = makeSession()
    session.start()
    session.handleMessage(raw({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))
    onSend.mockClear()

    const msg = { message_type: MessageType.POWER_MEASUREMENT, message_id: 'pm1' }
    session.send(msg)
    expect(onSend).toHaveBeenCalledWith(msg)
  })

  it('calls onError when not CONNECTED', () => {
    const { session, onError } = makeSession()
    session.send({ message_type: MessageType.POWER_MEASUREMENT, message_id: 'pm1' })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('HANDSHAKING') }))
  })
})

describe('S2Session keepAlive', () => {
  it('records the timestamp of the last keepalive', () => {
    const { session } = makeSession()
    expect(session.lastKeepAlive).toBeNull()
    session.keepAlive()
    expect(session.lastKeepAlive).toBeInstanceOf(Date)
  })
})

describe('S2Session ReceptionStatus', () => {
  it('forwards ReceptionStatus via onMessage without sending a response', () => {
    const { session, onSend, onMessage } = makeSession()
    session.start()
    session.handleMessage(raw({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))
    onSend.mockClear()
    onMessage.mockClear()

    session.handleMessage(raw({ message_type: MessageType.RECEPTION_STATUS, message_id: 'rs1', subject_message_id: 'pm1', result: 'OK' }))
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ message_type: MessageType.RECEPTION_STATUS }))
    expect(onSend).not.toHaveBeenCalled()
  })
})

describe('S2Session handleMessage accepts objects', () => {
  it('processes a message passed as an object (D-Bus transport)', () => {
    const { session, onMessage } = makeSession()
    session.start()
    session.handleMessage({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' })
    expect(session.state).toBe(State.CONNECTED)
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ message_type: MessageType.HANDSHAKE_RESPONSE }))
  })
})

describe('S2Session invalid input', () => {
  it('calls onError for invalid JSON without crashing', () => {
    const { session, onError } = makeSession()
    session.handleMessage('{not valid json}')
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    expect(session.state).toBe(State.HANDSHAKING)
  })

  it('calls onError for object without message_type', () => {
    const { session, onError } = makeSession()
    session.handleMessage({ message_id: 'x1' } as never)
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })

  it('calls onError for string with missing message_type', () => {
    const { session, onError } = makeSession()
    session.handleMessage(raw({ message_id: 'x1' }))
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })
})

// Helper: drive a session to CONNECTED state
function connectSession (session: S2Session, onSend: jest.Mock): void {
  session.start()
  onSend.mockClear()
  session.handleMessage(raw({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))
  onSend.mockClear()
}

function selectPEBC (session: S2Session, onSend: jest.Mock): void {
  session.handleMessage(raw({ message_type: MessageType.SELECT_CONTROL_TYPE, message_id: 'sct1', control_type: 'POWER_ENVELOPE_BASED_CONTROL' }))
  onSend.mockClear()
}

const pebcInput = {
  commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC',
  minPower: -3000,
  maxPower: 3000
}

describe('S2Session PEBC.PowerConstraints - setPEBCPowerConstraints', () => {
  it('sends PEBC.PowerConstraints immediately when PEBC is already the active control type', () => {
    const { session, onSend } = makeSession()
    connectSession(session, onSend)
    selectPEBC(session, onSend)

    session.setPEBCPowerConstraints(pebcInput)

    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ message_type: 'PEBC.PowerConstraints' }))
  })

  it('does not send when PEBC is not yet selected', () => {
    const { session, onSend } = makeSession()
    connectSession(session, onSend)

    session.setPEBCPowerConstraints(pebcInput)

    expect(onSend).not.toHaveBeenCalled()
  })

  it('does not send when not yet connected', () => {
    const { session, onSend } = makeSession()

    session.setPEBCPowerConstraints(pebcInput)

    expect(onSend).not.toHaveBeenCalled()
  })
})

describe('S2Session PEBC.PowerConstraints - auto-send on SelectControlType', () => {
  it('sends stored constraints when SelectControlType(PEBC) is received', () => {
    const { session, onSend } = makeSession()
    connectSession(session, onSend)
    session.setPEBCPowerConstraints(pebcInput)
    onSend.mockClear()

    session.handleMessage(raw({ message_type: MessageType.SELECT_CONTROL_TYPE, message_id: 'sct1', control_type: 'POWER_ENVELOPE_BASED_CONTROL' }))

    const pcCall = onSend.mock.calls.find((c: unknown[]) => (c[0] as Record<string, unknown>).message_type === 'PEBC.PowerConstraints')
    expect(pcCall).toBeDefined()
  })

  it('does not send constraints when SelectControlType is for a different control type', () => {
    const { session, onSend } = makeSession()
    connectSession(session, onSend)
    session.setPEBCPowerConstraints(pebcInput)
    onSend.mockClear()

    session.handleMessage(raw({ message_type: MessageType.SELECT_CONTROL_TYPE, message_id: 'sct1', control_type: 'OPERATION_MODE_BASED_CONTROL' }))

    const pcCall = onSend.mock.calls.find((c: unknown[]) => (c[0] as Record<string, unknown>).message_type === 'PEBC.PowerConstraints')
    expect(pcCall).toBeUndefined()
  })

  it('does not send constraints when none have been set', () => {
    const { session, onSend } = makeSession()
    connectSession(session, onSend)
    onSend.mockClear()

    session.handleMessage(raw({ message_type: MessageType.SELECT_CONTROL_TYPE, message_id: 'sct1', control_type: 'POWER_ENVELOPE_BASED_CONTROL' }))

    const pcCall = onSend.mock.calls.find((c: unknown[]) => (c[0] as Record<string, unknown>).message_type === 'PEBC.PowerConstraints')
    expect(pcCall).toBeUndefined()
  })
})

describe('S2Session TEMPORARY_ERROR retry', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  function connectedPebcSession () {
    const mocks = makeSession({ retryDelayMs: 1000 })
    connectSession(mocks.session, mocks.onSend)
    selectPEBC(mocks.session, mocks.onSend)
    return mocks
  }

  it('retries the rejected message once after retryDelayMs', () => {
    const { session, onSend } = connectedPebcSession()
    session.setPEBCPowerConstraints(pebcInput)
    const sentMsg = onSend.mock.calls[0][0] as Record<string, unknown>
    const msgId = sentMsg.message_id as string
    onSend.mockClear()

    session.handleMessage(raw({ message_type: MessageType.RECEPTION_STATUS, subject_message_id: msgId, status: 'TEMPORARY_ERROR' }))

    expect(onSend).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1000)
    expect(onSend).toHaveBeenCalledWith(sentMsg)
  })

  it('still calls onMessage for TEMPORARY_ERROR', () => {
    const { session, onSend, onMessage } = connectedPebcSession()
    session.setPEBCPowerConstraints(pebcInput)
    const msgId = (onSend.mock.calls[0][0] as Record<string, unknown>).message_id as string
    onMessage.mockClear()

    session.handleMessage(raw({ message_type: MessageType.RECEPTION_STATUS, subject_message_id: msgId, status: 'TEMPORARY_ERROR' }))

    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
      message_type: MessageType.RECEPTION_STATUS,
      status: 'TEMPORARY_ERROR'
    }))
  })

  it('calls onError when TEMPORARY_ERROR is received a second time for the same message', () => {
    const { session, onSend, onError } = connectedPebcSession()
    session.setPEBCPowerConstraints(pebcInput)
    const msgId = (onSend.mock.calls[0][0] as Record<string, unknown>).message_id as string
    onSend.mockClear()

    session.handleMessage(raw({ message_type: MessageType.RECEPTION_STATUS, subject_message_id: msgId, status: 'TEMPORARY_ERROR' }))
    jest.advanceTimersByTime(1000)
    onSend.mockClear()

    session.handleMessage(raw({ message_type: MessageType.RECEPTION_STATUS, subject_message_id: msgId, status: 'TEMPORARY_ERROR' }))

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining(msgId) }))
    jest.advanceTimersByTime(5000)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('clears the buffer on OK so no further retry occurs', () => {
    const { session, onSend, onError } = connectedPebcSession()
    session.setPEBCPowerConstraints(pebcInput)
    const msgId = (onSend.mock.calls[0][0] as Record<string, unknown>).message_id as string
    onSend.mockClear()

    session.handleMessage(raw({ message_type: MessageType.RECEPTION_STATUS, subject_message_id: msgId, status: 'TEMPORARY_ERROR' }))
    jest.advanceTimersByTime(1000)
    onSend.mockClear()

    session.handleMessage(raw({ message_type: MessageType.RECEPTION_STATUS, subject_message_id: msgId, status: 'OK' }))

    expect(onError).not.toHaveBeenCalled()
    jest.advanceTimersByTime(5000)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('dispose cancels a pending retry timer', () => {
    const { session, onSend } = connectedPebcSession()
    session.setPEBCPowerConstraints(pebcInput)
    const msgId = (onSend.mock.calls[0][0] as Record<string, unknown>).message_id as string
    onSend.mockClear()

    session.handleMessage(raw({ message_type: MessageType.RECEPTION_STATUS, subject_message_id: msgId, status: 'TEMPORARY_ERROR' }))
    session.dispose()

    jest.advanceTimersByTime(5000)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('does nothing special for TEMPORARY_ERROR on an unknown message_id', () => {
    const { session, onMessage, onError } = connectedPebcSession()

    session.handleMessage(raw({ message_type: MessageType.RECEPTION_STATUS, subject_message_id: 'unknown-id', status: 'TEMPORARY_ERROR' }))

    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ status: 'TEMPORARY_ERROR' }))
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('S2Session InstructionStatusUpdate - auto ACCEPTED', () => {
  function connectedSession () {
    const mocks = makeSession()
    mocks.session.start()
    mocks.session.handleMessage(raw({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))
    mocks.onSend.mockClear()
    return mocks
  }

  it('sends InstructionStatusUpdate(ACCEPTED) after ReceptionStatus when instruction has id field', () => {
    const { session, onSend } = connectedSession()
    session.handleMessage(raw({ message_type: MessageType.OMBC_INSTRUCTION, message_id: 'msg-1', id: 'instr-1' }))

    const statusUpdate = onSend.mock.calls[1][0]
    expect(statusUpdate.message_type).toBe(MessageType.INSTRUCTION_STATUS_UPDATE)
    expect(statusUpdate.instruction_id).toBe('instr-1')
    expect(statusUpdate.status_type).toBe(InstructionStatus.ACCEPTED)
  })

  it('sends ReceptionStatus before InstructionStatusUpdate', () => {
    const { session, onSend } = connectedSession()
    session.handleMessage(raw({ message_type: MessageType.OMBC_INSTRUCTION, message_id: 'msg-1', id: 'instr-1' }))

    expect(onSend.mock.calls[0][0].message_type).toBe(MessageType.RECEPTION_STATUS)
    expect(onSend.mock.calls[1][0].message_type).toBe(MessageType.INSTRUCTION_STATUS_UPDATE)
  })

  it('does not send InstructionStatusUpdate when instruction has no id field', () => {
    const { session, onSend } = connectedSession()
    session.handleMessage(raw({ message_type: MessageType.OMBC_INSTRUCTION, message_id: 'msg-1' }))

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0][0].message_type).toBe(MessageType.RECEPTION_STATUS)
  })

  it('sends ACCEPTED for all instruction types that have an id field', () => {
    const types = [
      MessageType.FRBC_INSTRUCTION,
      MessageType.DDBC_INSTRUCTION,
      MessageType.PEBC_INSTRUCTION,
      MessageType.PPBC_SCHEDULE_INSTRUCTION
    ]
    for (const type of types) {
      const { session, onSend } = connectedSession()
      session.handleMessage(raw({ message_type: type, message_id: 'msg-x', id: 'instr-x' }))
      const hasStatusUpdate = onSend.mock.calls.some(
        (c: unknown[]) => (c[0] as Record<string, unknown>).message_type === MessageType.INSTRUCTION_STATUS_UPDATE
      )
      expect(hasStatusUpdate).toBe(true)
    }
  })
})

describe('S2Session OMBC.Status on instruction accept', () => {
  const ombcConfig = {
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
  }

  function connectedWithOmbc () {
    const mocks = makeSession({ controlTypeConfig: ombcConfig })
    mocks.session.start()
    mocks.session.handleMessage(raw({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))
    mocks.onSend.mockClear()
    return mocks
  }

  it('sends OMBC.Status when OMBC instruction with operation_mode_id is received', () => {
    const { session, onSend } = connectedWithOmbc()

    session.handleMessage(raw({
      message_type: MessageType.OMBC_INSTRUCTION,
      message_id: 'msg-1',
      id: 'instr-1',
      operation_mode_id: 'mode-on',
      operation_mode_factor: 0.5,
      abnormal_condition: false
    }))

    const ombcStatus = onSend.mock.calls.find((c: unknown[]) => (c[0] as { message_type?: string }).message_type === MessageType.OMBC_STATUS)
    expect(ombcStatus).toBeDefined()
    const msg = ombcStatus![0] as { active_operation_mode_id: string, operation_mode_factor: number }
    expect(msg.active_operation_mode_id).toBe('mode-on')
    expect(msg.operation_mode_factor).toBe(0.5)
  })

  it('sends OMBC.Status after ACCEPTED in the same _ackAndForward call', () => {
    const { session, onSend } = connectedWithOmbc()

    session.handleMessage(raw({
      message_type: MessageType.OMBC_INSTRUCTION,
      message_id: 'msg-2',
      id: 'instr-2',
      operation_mode_id: 'mode-on',
      operation_mode_factor: 1,
      abnormal_condition: false
    }))

    // ReceptionStatus(OK), InstructionStatusUpdate(ACCEPTED), OMBC.Status - in that order
    expect(onSend.mock.calls[0][0].message_type).toBe(MessageType.RECEPTION_STATUS)
    expect(onSend.mock.calls[1][0].message_type).toBe(MessageType.INSTRUCTION_STATUS_UPDATE)
    expect(onSend.mock.calls[2][0].message_type).toBe(MessageType.OMBC_STATUS)
  })

  it('includes previous_operation_mode_id and transition_timestamp when mode changes', () => {
    const { session, onSend } = connectedWithOmbc()

    session.handleMessage(raw({
      message_type: MessageType.OMBC_INSTRUCTION,
      message_id: 'msg-3',
      id: 'instr-3',
      operation_mode_id: 'mode-on',
      operation_mode_factor: 1,
      abnormal_condition: false
    }))

    const statusMsg = onSend.mock.calls[2][0] as { previous_operation_mode_id?: string, transition_timestamp?: string }
    expect(statusMsg.previous_operation_mode_id).toBe('mode-off')
    expect(statusMsg.transition_timestamp).toBeDefined()
  })

  it('does not send OMBC.Status when OMBC instruction has no operation_mode_id', () => {
    const { session, onSend } = connectedWithOmbc()

    session.handleMessage(raw({
      message_type: MessageType.OMBC_INSTRUCTION,
      message_id: 'msg-4',
      id: 'instr-4',
      abnormal_condition: false
    }))

    const ombcStatus = onSend.mock.calls.find((c: unknown[]) => (c[0] as { message_type?: string }).message_type === MessageType.OMBC_STATUS)
    expect(ombcStatus).toBeUndefined()
  })

  it('does not send OMBC.Status for non-OMBC instruction types', () => {
    const { session, onSend } = connectedWithOmbc()

    for (const type of [MessageType.PEBC_INSTRUCTION, MessageType.FRBC_INSTRUCTION, MessageType.DDBC_INSTRUCTION]) {
      onSend.mockClear()
      session.handleMessage(raw({ message_type: type, message_id: 'msg-x', id: 'instr-x', operation_mode_id: 'mode-on' }))
      const ombcStatus = onSend.mock.calls.find((c: unknown[]) => (c[0] as { message_type?: string }).message_type === MessageType.OMBC_STATUS)
      expect(ombcStatus).toBeUndefined()
    }
  })

  it('exposes currentOMBCStatus reflecting the committed mode after instruction accept', () => {
    const { session } = connectedWithOmbc()

    expect(session.currentOMBCStatus?.activeOperationModeId).toBe('mode-off')

    session.handleMessage(raw({
      message_type: MessageType.OMBC_INSTRUCTION,
      message_id: 'msg-5',
      id: 'instr-5',
      operation_mode_id: 'mode-on',
      operation_mode_factor: 0.8,
      abnormal_condition: false
    }))

    expect(session.currentOMBCStatus?.activeOperationModeId).toBe('mode-on')
    expect(session.currentOMBCStatus?.operationModeFactor).toBe(0.8)
  })
})

describe('S2Session sendInstructionStatus', () => {
  function connectedSession () {
    const mocks = makeSession()
    mocks.session.start()
    mocks.session.handleMessage(raw({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))
    mocks.onSend.mockClear()
    return mocks
  }

  it('sends InstructionStatusUpdate with the given status', () => {
    const { session, onSend } = connectedSession()
    session.sendInstructionStatus('instr-42', InstructionStatus.STARTED)

    expect(onSend).toHaveBeenCalledTimes(1)
    const msg = onSend.mock.calls[0][0]
    expect(msg.message_type).toBe(MessageType.INSTRUCTION_STATUS_UPDATE)
    expect(msg.instruction_id).toBe('instr-42')
    expect(msg.status_type).toBe(InstructionStatus.STARTED)
  })

  it('sends InstructionStatusUpdate with ABORTED status', () => {
    const { session, onSend } = connectedSession()
    session.sendInstructionStatus('instr-5', InstructionStatus.ABORTED)

    const msg = onSend.mock.calls[0][0]
    expect(msg.status_type).toBe(InstructionStatus.ABORTED)
    expect(msg.instruction_id).toBe('instr-5')
  })
})
