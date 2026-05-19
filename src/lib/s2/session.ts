import {
  MessageType,
  ControlType,
  ControlTypeValue,
  ReceptionStatusResult,
  S2IncomingMessage,
  RmDetails,
  OMBCSystemDescriptionConfig,
  OMBCStatusConfig,
  PEBCPowerConstraintsInput,
  makeReceptionStatus,
  makeHandshake,
  makeResourceManagerDetails,
  makeOMBCSystemDescription,
  makeOMBCStatus,
  makePEBCPowerConstraints,
  parse
} from './messages'

/**
 * S2 session states.
 */
export const State = Object.freeze({
  HANDSHAKING: 'HANDSHAKING', // Handshake sent by RM, waiting for HandshakeResponse from CEM
  CONNECTED: 'CONNECTED' // HandshakeResponse received, session active
} as const)

export type StateValue = (typeof State)[keyof typeof State]

export interface OMBCConfig {
  systemDescription?: OMBCSystemDescriptionConfig
  status?: OMBCStatusConfig
}

export interface ControlTypeConfig {
  OMBC?: OMBCConfig
  [key: string]: unknown
}

export interface S2SessionOptions {
  cemId: string
  rmDetails?: RmDetails
  controlTypeConfig?: ControlTypeConfig
  onSend?: (msg: object) => void
  onStateChange?: (state: StateValue) => void
  onMessage?: (msg: S2IncomingMessage) => void
  onInstruction?: (msg: S2IncomingMessage) => void
  onError?: (err: Error) => void
  retryDelayMs?: number
}

/**
 * S2Session manages the S2 protocol state for a single CEM connection.
 *
 * The RM (us) initiates the Handshake immediately after the CEM connects.
 * This applies to both transports:
 * - D-Bus (acload): CEM calls Connect on D-Bus, RM sends Handshake via Message signal
 * - WebSocket (future): CEM opens WS connection, RM sends Handshake over the socket
 *
 * Usage:
 *   const session = new S2Session({
 *     cemId,
 *     rmDetails,
 *     controlTypeConfig: {  // optional control type configuration
 *       OMBC: {
 *         systemDescription: { operationModes: [...], transitions: [], timers: [] },
 *         status: { activeOperationModeId: 'mode-1', operationModeFactor: 1 }
 *       }
 *     },
 *     onSend:        (msg) => <send S2 message object to CEM>,
 *     onStateChange: (state) => ...,
 *     onMessage:     (msg) => <forward received message downstream>,
 *     onError:       (err) => ...
 *   })
 *
 *   session.start()              // sends Handshake, call after Connect
 *   session.handleMessage(msg)   // call for each Message from the CEM
 *   session.send(msg)            // send an outbound S2 message (only when CONNECTED)
 */
export class S2Session {
  private readonly _cemId: string
  private readonly _rmDetails: RmDetails | undefined
  private readonly _controlTypeConfig: ControlTypeConfig
  private readonly _onSend: (msg: object) => void
  private readonly _onStateChange: (state: StateValue) => void
  private readonly _onMessage: (msg: S2IncomingMessage) => void
  private readonly _onInstruction: (msg: S2IncomingMessage) => void
  private readonly _onError: (err: Error) => void
  private readonly _retryDelayMs: number
  private readonly _sentMessages: Map<string, { msg: object, retryCount: number }>
  private readonly _retryTimers: Map<string, ReturnType<typeof setTimeout>>
  private _state: StateValue
  private _selectedControlType: ControlTypeValue | string
  private _lastKeepAlive: Date | null
  private _pebcPowerConstraints: PEBCPowerConstraintsInput | null

  constructor ({ cemId, rmDetails, controlTypeConfig, onSend, onStateChange, onMessage, onInstruction, onError, retryDelayMs }: S2SessionOptions) {
    this._cemId = cemId
    this._rmDetails = rmDetails
    this._controlTypeConfig = controlTypeConfig || {}
    this._onSend = onSend || (() => {})
    this._onStateChange = onStateChange || (() => {})
    this._onMessage = onMessage || (() => {})
    this._onInstruction = onInstruction || this._onMessage
    this._onError = onError || ((err) => console.error(err))
    this._retryDelayMs = retryDelayMs ?? 5000
    this._sentMessages = new Map()
    this._retryTimers = new Map()

    this._state = State.HANDSHAKING
    this._selectedControlType = ControlType.NO_SELECTION
    this._lastKeepAlive = null
    this._pebcPowerConstraints = null
  }

  get cemId (): string { return this._cemId }
  get state (): StateValue { return this._state }
  get selectedControlType (): ControlTypeValue | string { return this._selectedControlType }
  get lastKeepAlive (): Date | null { return this._lastKeepAlive }

  /**
   * Cancel pending retry timers and clear the sent-message buffer.
   * Call when the session is no longer needed (disconnect, node close).
   */
  dispose (): void {
    for (const timer of this._retryTimers.values()) {
      clearTimeout(timer)
    }
    this._retryTimers.clear()
    this._sentMessages.clear()
  }

  /**
   * Record that a keepalive was received from the CEM.
   */
  keepAlive (): void {
    this._lastKeepAlive = new Date()
  }

  /**
   * Send the initial Handshake to the CEM. Call once after the CEM connects.
   */
  start (): void {
    this._send(makeHandshake(this._cemId))
  }

  /**
   * Process an S2 message received from the CEM.
   * Accepts a raw JSON string or an already-parsed object.
   */
  handleMessage (raw: string | S2IncomingMessage): void {
    let msg: S2IncomingMessage | null
    if (raw && typeof raw === 'object') {
      if (!raw.message_type) {
        this._onError(new Error('S2 message missing message_type'))
        return
      }
      msg = raw
    } else {
      msg = parse(raw as string, this._onError)
    }
    if (!msg) return

    switch (msg.message_type) {
      case MessageType.HANDSHAKE:
        // CEM's own Handshake (role: CEM) - ack and forward as a regular message
        this._send(makeReceptionStatus(msg.message_id as string, ReceptionStatusResult.OK))
        this._onMessage(msg)
        break

      case MessageType.HANDSHAKE_RESPONSE:
        this._handleHandshakeResponse(msg)
        break

      case MessageType.SELECT_CONTROL_TYPE:
        this._handleSelectControlType(msg)
        break

      case MessageType.RECEPTION_STATUS: {
        const statusResult = (msg as { status?: string }).status
        const subjectId = (msg as { subject_message_id?: string }).subject_message_id
        if (subjectId && statusResult === ReceptionStatusResult.OK) {
          const pendingTimer = this._retryTimers.get(subjectId)
          if (pendingTimer) { clearTimeout(pendingTimer); this._retryTimers.delete(subjectId) }
          this._sentMessages.delete(subjectId)
        } else if (subjectId && statusResult === ReceptionStatusResult.TEMPORARY_ERROR) {
          const entry = this._sentMessages.get(subjectId)
          if (entry && entry.retryCount < 1) {
            entry.retryCount++
            const timer = setTimeout(() => {
              this._retryTimers.delete(subjectId)
              const e = this._sentMessages.get(subjectId)
              if (e) this._onSend(e.msg)
            }, this._retryDelayMs)
            this._retryTimers.set(subjectId, timer)
          } else if (entry) {
            this._sentMessages.delete(subjectId)
            this._onError(new Error(`Message ${subjectId} rejected with TEMPORARY_ERROR after retry`))
          }
        }
        this._onMessage(msg)
        break
      }

      case MessageType.INSTRUCTION:
      case MessageType.FRBC_INSTRUCTION:
      case MessageType.DDBC_INSTRUCTION:
      case MessageType.OMBC_INSTRUCTION:
      case MessageType.PEBC_INSTRUCTION:
      case MessageType.PPBC_SCHEDULE_INSTRUCTION:
      case MessageType.PPBC_START_INTERRUPTION_INSTRUCTION:
      case MessageType.PPBC_END_INTERRUPTION_INSTRUCTION:
        this._ackAndForward(msg)
        break

      default:
        this._onMessage(msg)
        break
    }
  }

  /**
   * Send an S2 message object to the CEM. Only valid when CONNECTED.
   */
  send (msg: object): void {
    if (this._state !== State.CONNECTED) {
      this._onError(new Error(`Cannot send in state ${this._state} for CEM ${this._cemId}`))
      return
    }
    this._send(msg)
  }

  /**
   * Store PEBC power constraints and send them to the CEM immediately if
   * PEBC is the active control type. Stored constraints are also sent
   * automatically when SelectControlType(PEBC) is received.
   */
  setPEBCPowerConstraints (input: PEBCPowerConstraintsInput): void {
    this._pebcPowerConstraints = input
    if (this._state === State.CONNECTED &&
        this._selectedControlType === ControlType.PEBC) {
      this._send(makePEBCPowerConstraints(input))
    }
  }

  // -- private --

  /**
   * Buffer the message by its message_id (if present) and forward to onSend.
   * Buffered messages can be retried when the CEM responds with TEMPORARY_ERROR.
   */
  private _send (msg: object): void {
    const m = msg as Record<string, unknown>
    if (typeof m.message_id === 'string') {
      this._sentMessages.set(m.message_id, { msg, retryCount: 0 })
    }
    this._onSend(msg)
  }

  private _setState (newState: StateValue): void {
    if (newState !== this._state) {
      this._state = newState
      this._onStateChange(newState)
    }
  }

  private _handleHandshakeResponse (msg: S2IncomingMessage): void {
    if (this._state !== State.HANDSHAKING) {
      this._onError(new Error(`Unexpected HandshakeResponse in state ${this._state} for CEM ${this._cemId}`))
      return
    }
    this._send(makeReceptionStatus(msg.message_id as string, ReceptionStatusResult.OK))
    this._setState(State.CONNECTED)
    this._onMessage(msg)
    if (this._rmDetails) {
      this._send(makeResourceManagerDetails(this._rmDetails))
    } else {
      this._onError(new Error(`No rmDetails configured - cannot send ResourceManagerDetails for CEM ${this._cemId}`))
    }
  }

  private _handleSelectControlType (msg: S2IncomingMessage): void {
    this._selectedControlType = (msg.control_type as string) || ControlType.NO_SELECTION
    this._send(makeReceptionStatus(msg.message_id as string, ReceptionStatusResult.OK))
    this._onMessage(msg)

    // After SelectControlType, send the appropriate SystemDescription and Status
    const controlType = msg.control_type as string
    if (controlType === ControlType.OMBC || controlType === 'OMBC') {
      this._sendOMBCSystemDescriptionAndStatus()
    } else if (controlType === ControlType.PEBC) {
      if (this._pebcPowerConstraints) {
        this._send(makePEBCPowerConstraints(this._pebcPowerConstraints))
      }
    }
  }

  private _sendOMBCSystemDescriptionAndStatus (): void {
    const config = this._controlTypeConfig.OMBC
    if (!config) {
      this._onError(new Error(`No OMBC config for CEM ${this._cemId} - set Control Type Config in the s2-rm node`))
      return
    }
    if (config.systemDescription) {
      this._send(makeOMBCSystemDescription(config.systemDescription))
    }
    if (config.status) {
      this._send(makeOMBCStatus(config.status))
    }
  }

  private _ackAndForward (msg: S2IncomingMessage): void {
    this._send(makeReceptionStatus(msg.message_id as string, ReceptionStatusResult.OK))
    this._onInstruction(msg)
  }
}
