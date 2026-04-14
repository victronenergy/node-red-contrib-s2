import { randomUUID } from 'crypto'

/**
 * S2 protocol message type constants (EN 50491-12-2).
 * These are the message_type values used in S2 JSON messages.
 */
export const MessageType = Object.freeze({
  // Handshake
  HANDSHAKE: 'Handshake',
  HANDSHAKE_RESPONSE: 'HandshakeResponse',

  // Session
  SESSION_REQUEST: 'SessionRequest',

  // Resource Manager -> CEM
  RESOURCE_MANAGER_DETAILS: 'ResourceManagerDetails',
  POWER_MEASUREMENT: 'PowerMeasurement',
  RECEPTION_STATUS: 'ReceptionStatus',
  REVOKE_OBJECT: 'RevokeObject',
  SELECT_CONTROL_TYPE: 'SelectControlType',

  // CEM -> Resource Manager
  INSTRUCTION: 'Instruction',

  // Fill-rate Based Control (FRBC)
  FRBC_ACTUATOR_STATUS: 'FRBC.ActuatorStatus',
  FRBC_FILL_LEVEL_TARGET_PROFILE: 'FRBC.FillLevelTargetProfile',
  FRBC_LEAKAGE_BEHAVIOUR: 'FRBC.LeakagebBehaviour',
  FRBC_STORAGE_STATUS: 'FRBC.StorageStatus',
  FRBC_SYSTEM_DESCRIPTION: 'FRBC.SystemDescription',
  FRBC_TIMER_STATUS: 'FRBC.TimerStatus',
  FRBC_USAGE_FORECAST: 'FRBC.UsageForecast',
  FRBC_INSTRUCTION: 'FRBC.Instruction',

  // Demand Driven Based Control (DDBC)
  DDBC_ACTUAL_POWER: 'DDBC.ActualPower',
  DDBC_AVERAGE_DEMAND_RATE_FORECAST: 'DDBC.AverageDemandRateForecast',
  DDBC_SYSTEM_DESCRIPTION: 'DDBC.SystemDescription',
  DDBC_TIMER_STATUS: 'DDBC.TimerStatus',
  DDBC_INSTRUCTION: 'DDBC.Instruction',

  // Power Profile Based Control (PPBC)
  PPBC_POWER_PROFILE_STATUS: 'PPBC.PowerProfileStatus',
  PPBC_SCHEDULE_INSTRUCTION: 'PPBC.ScheduleInstruction',
  PPBC_START_INTERRUPTION_INSTRUCTION: 'PPBC.StartInterruptionInstruction',
  PPBC_END_INTERRUPTION_INSTRUCTION: 'PPBC.EndInterruptionInstruction',
  PPBC_POWER_PROFILE: 'PPBC.PowerProfileDefinition',

  // Operation Mode Based Control (OMBC)
  OMBC_SYSTEM_DESCRIPTION: 'OMBC.SystemDescription',
  OMBC_STATUS: 'OMBC.Status',
  OMBC_INSTRUCTION: 'OMBC.Instruction',

  // Power Envelope Based Control (PEBC)
  PEBC_POWER_CONSTRAINTS: 'PEBC.PowerConstraints',
  PEBC_DEVICE_CONSTRAINTS: 'PEBC.DeviceConstraints',
  PEBC_ENERGY_CONSTRAINT: 'PEBC.EnergyConstraint',
  PEBC_INSTRUCTION: 'PEBC.Instruction',

  // Common
  POWER_FORECAST: 'PowerForecast'
} as const)

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType]

/**
 * S2 control type identifiers (full names as used in s2python / s2-ws-json).
 */
export const ControlType = Object.freeze({
  NOT_CONTROLABLE: 'NOT_CONTROLABLE',
  OMBC: 'OPERATION_MODE_BASED_CONTROL',
  FRBC: 'FILL_RATE_BASED_CONTROL',
  DDBC: 'DEMAND_DRIVEN_BASED_CONTROL',
  PPBC: 'POWER_PROFILE_BASED_CONTROL',
  PEBC: 'POWER_ENVELOPE_BASED_CONTROL',
  NO_SELECTION: 'NO_SELECTION'
} as const)

export type ControlTypeValue = (typeof ControlType)[keyof typeof ControlType]

/**
 * ReceptionStatus result values (matches s2python ReceptionStatusValues).
 */
export const ReceptionStatusResult = Object.freeze({
  OK: 'OK',
  INVALID_DATA: 'INVALID_DATA',
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  INVALID_CONTENT: 'INVALID_CONTENT',
  TEMPORARY_ERROR: 'TEMPORARY_ERROR',
  PERMANENT_ERROR: 'PERMANENT_ERROR'
} as const)

export type ReceptionStatusResultValue = (typeof ReceptionStatusResult)[keyof typeof ReceptionStatusResult]

// -- Message interfaces --

/** Base shape for any S2 message parsed from JSON. */
export interface S2IncomingMessage {
  message_type: string
  message_id?: string
  [key: string]: unknown
}

export interface S2Role {
  role: string
  commodity: string
}

export interface PowerMeasurementValue {
  commodity_quantity: string
  value: number
}

export interface S2HandshakeMessage {
  message_type: typeof MessageType.HANDSHAKE
  message_id: string
  role: 'RM'
  supported_protocol_versions: string[]
}

export interface S2ReceptionStatusMessage {
  message_type: typeof MessageType.RECEPTION_STATUS
  subject_message_id: string
  status: ReceptionStatusResultValue
  diagnostic_label?: string
}

export interface S2ResourceManagerDetailsMessage {
  message_type: typeof MessageType.RESOURCE_MANAGER_DETAILS
  message_id: string
  resource_id: string
  name: string
  roles: S2Role[]
  manufacturer: string
  model: string
  serial_number: string
  firmware_version: string
  available_control_types: string[]
  provides_forecast: boolean
  provides_power_measurement_types: string[]
  instruction_processing_delay: number
}

export interface S2OMBCSystemDescriptionMessage {
  message_type: typeof MessageType.OMBC_SYSTEM_DESCRIPTION
  message_id: string
  valid_from: string
  operation_modes: unknown[]
  transitions: unknown[]
  timers: unknown[]
}

export interface S2OMBCStatusMessage {
  message_type: typeof MessageType.OMBC_STATUS
  message_id: string
  active_operation_mode_id: string
  operation_mode_factor: number
  previous_operation_mode_id?: string
  transition_timestamp?: string
}

export interface S2PowerMeasurementMessage {
  message_type: typeof MessageType.POWER_MEASUREMENT
  message_id: string
  measurement_timestamp: string
  values: PowerMeasurementValue[]
}

// -- Input parameter interfaces --

export interface RmDetails {
  resourceId: string
  name: string
  roles: S2Role[]
  availableControlTypes: string[]
  providesForecast: boolean
  providesPowerMeasurementTypes?: string[]
  instructionProcessingDelay?: number
  manufacturer?: string
  model?: string
  serialNumber?: string
  firmwareVersion?: string
}

export interface OMBCSystemDescriptionConfig {
  operationModes: unknown[]
  transitions?: unknown[]
  timers?: unknown[]
}

export interface OMBCStatusConfig {
  activeOperationModeId: string
  operationModeFactor?: number
  previousOperationModeId?: string
  transitionTimestamp?: string
}

/**
 * Simplified input for building a PEBC.PowerConstraints message.
 * Produces a single commodity constraint with matching LOWER_LIMIT and
 * UPPER_LIMIT ranges, consequence_type DEFER - as required by most CEMs.
 */
export interface PEBCPowerConstraintsInput {
  /** e.g. 'ELECTRIC.POWER.3_PHASE_SYMMETRIC' */
  commodityQuantity: string
  /** Lower bound of the allowed power range in Watts (may be negative for export) */
  minPower: number
  /** Upper bound of the allowed power range in Watts */
  maxPower: number
  /** ISO 8601 datetime; defaults to now */
  validFrom?: string
}

export interface PowerForecastValue {
  commodity_quantity: string
  value_expected: number
  value_upper_limit?: number
  value_lower_limit?: number
}

export interface PowerForecastElement {
  duration: number // milliseconds
  power_values: PowerForecastValue[]
}

export interface PowerForecastInput {
  startTime: string // ISO 8601 timezone-aware datetime
  elements: PowerForecastElement[]
}

/**
 * Parse a raw WebSocket message string into an S2 message object.
 * Returns null and calls onError if parsing fails.
 *
 * @param raw - raw JSON string
 * @param onError - called with an Error if parsing fails
 */
export function parse(raw: string, onError: (err: Error) => void): S2IncomingMessage | null {
  try {
    const msg = JSON.parse(raw) as Record<string, unknown>
    if (!msg.message_type) {
      onError(new Error('S2 message missing message_type'))
      return null
    }
    return msg as S2IncomingMessage
  } catch (err) {
    onError(new Error(`Failed to parse S2 message: ${(err as Error).message}`))
    return null
  }
}

/**
 * Serialize an S2 message object to a string for sending over the wire.
 */
export function serialize(msg: object): string {
  return JSON.stringify(msg)
}

/**
 * Create a ReceptionStatus message acknowledging a received message.
 *
 * @param subjectMessageId - message_id of the message being acknowledged
 * @param status - one of ReceptionStatusResult values
 * @param diagnosticLabel - optional human-readable diagnostic
 */
export function makeReceptionStatus(
  subjectMessageId: string,
  status: ReceptionStatusResultValue,
  diagnosticLabel?: string
): S2ReceptionStatusMessage {
  const msg: S2ReceptionStatusMessage = {
    message_type: MessageType.RECEPTION_STATUS,
    subject_message_id: subjectMessageId,
    status
  }
  if (diagnosticLabel) {
    msg.diagnostic_label = diagnosticLabel
  }
  return msg
}

/**
 * Create a Handshake message (sent by RM on connect).
 *
 * @param rmId - unique ID identifying this Resource Manager
 */
export function makeHandshake(rmId: string): S2HandshakeMessage {
  void rmId // included in API for symmetry; not sent in Handshake per spec
  return {
    message_type: MessageType.HANDSHAKE,
    message_id: generateId(),
    role: 'RM',
    supported_protocol_versions: ['0.0.2-beta']
  }
}

/**
 * Create a ResourceManagerDetails message (sent by RM after HandshakeResponse).
 */
export function makeResourceManagerDetails(details: RmDetails): S2ResourceManagerDetailsMessage {
  return {
    message_type: MessageType.RESOURCE_MANAGER_DETAILS,
    message_id: generateId(),
    resource_id: details.resourceId,
    name: details.name,
    roles: details.roles,
    manufacturer: details.manufacturer || '',
    model: details.model || '',
    serial_number: details.serialNumber || '',
    firmware_version: details.firmwareVersion || '',
    available_control_types: details.availableControlTypes,
    provides_forecast: details.providesForecast || false,
    provides_power_measurement_types: details.providesPowerMeasurementTypes || [],
    instruction_processing_delay: details.instructionProcessingDelay || 0
  }
}

/**
 * Create an OMBC.SystemDescription message.
 */
export function makeOMBCSystemDescription(config: OMBCSystemDescriptionConfig): S2OMBCSystemDescriptionMessage {
  return {
    message_type: MessageType.OMBC_SYSTEM_DESCRIPTION,
    message_id: generateId(),
    valid_from: new Date().toISOString(),
    operation_modes: config.operationModes || [],
    transitions: config.transitions || [],
    timers: config.timers || []
  }
}

/**
 * Create an OMBC.Status message.
 */
export function makeOMBCStatus(status: OMBCStatusConfig): S2OMBCStatusMessage {
  const msg: S2OMBCStatusMessage = {
    message_type: MessageType.OMBC_STATUS,
    message_id: generateId(),
    active_operation_mode_id: status.activeOperationModeId,
    operation_mode_factor: status.operationModeFactor !== undefined ? status.operationModeFactor : 1
  }
  if (status.previousOperationModeId) {
    msg.previous_operation_mode_id = status.previousOperationModeId
  }
  if (status.transitionTimestamp) {
    msg.transition_timestamp = status.transitionTimestamp
  }
  return msg
}

/**
 * Create a PowerMeasurement message (sent by RM to report current power).
 *
 * @param values - array of { commodity_quantity, value } objects
 */
export function makePowerMeasurement(values: PowerMeasurementValue[]): S2PowerMeasurementMessage {
  return {
    message_type: MessageType.POWER_MEASUREMENT,
    message_id: generateId(),
    measurement_timestamp: new Date().toISOString(),
    values
  }
}

/**
 * Build a PEBC.PowerConstraints message with matching LOWER_LIMIT and
 * UPPER_LIMIT ranges and consequence_type DEFER.
 *
 * Wire format (s2-ws-json 0.0.2-beta):
 *   id + allowed_limit_ranges are top-level fields on the message itself,
 *   not nested under a power_constraints array.
 */
export function makePEBCPowerConstraints (input: PEBCPowerConstraintsInput): object {
  const validFrom = input.validFrom ?? new Date().toISOString()
  const rangeBoundary = { start_of_range: input.minPower, end_of_range: input.maxPower }
  return {
    message_type: MessageType.PEBC_POWER_CONSTRAINTS,
    message_id: generateId(),
    id: generateId(),
    valid_from: validFrom,
    valid_until: null,
    consequence_type: 'DEFER',
    allowed_limit_ranges: [
      { commodity_quantity: input.commodityQuantity, limit_type: 'LOWER_LIMIT', range_boundary: rangeBoundary, abnormal_condition_only: false },
      { commodity_quantity: input.commodityQuantity, limit_type: 'UPPER_LIMIT', range_boundary: rangeBoundary, abnormal_condition_only: false }
    ]
  }
}

/**
 * Build a PowerForecast message from pre-formed elements.
 *
 * @param input.startTime - ISO 8601 timezone-aware datetime for the first element
 * @param input.elements - array of { duration (ms), power_values: [{ commodity_quantity, value_expected }] }
 */
export function makePowerForecast (input: PowerForecastInput): object {
  return {
    message_type: MessageType.POWER_FORECAST,
    message_id: generateId(),
    start_time: input.startTime,
    elements: input.elements
  }
}

/**
 * Generate a UUID v4 message ID.
 * Node >=14.17.4 is required, which includes crypto.randomUUID.
 */
export function generateId(): string {
  return randomUUID()
}
