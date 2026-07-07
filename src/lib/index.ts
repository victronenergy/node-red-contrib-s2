export { S2Session, State } from './s2/session'
export type { StateValue, S2SessionOptions, ControlTypeConfig } from './s2/session'

export {
  MessageType,
  ControlType,
  ReceptionStatusResult,
  parse,
  serialize,
  makeReceptionStatus,
  makeHandshake,
  makeResourceManagerDetails,
  generateId
} from './s2/messages'
export type {
  MessageTypeValue,
  ControlTypeValue,
  ReceptionStatusResultValue,
  S2IncomingMessage,
  S2Role,
  PowerMeasurementValue,
  RmDetails
} from './s2/messages'
