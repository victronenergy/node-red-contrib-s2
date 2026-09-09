import { NodeMessage, NodeRedStatus } from '../../types/node-red'
import { S2Session, State, StatusPayload, SystemDescriptionPayload } from './session'
import { makePowerForecast, makePowerMeasurement, MessageType, ControlType, ReceptionStatusResult, InstructionStatus, InstructionStatusValue, PEBCPowerConstraintsInput, PowerForecastInput, PowerMeasurementValue, RmDetails } from './messages'

interface PendingInstruction {
  messageId: string
  instructionId: string | undefined
  instruction: Record<string, unknown>
  cemId: string
  executionTimeMs: number
}

const PENDING_INSTRUCTIONS_KEY = 's2PendingInstructions'
const PRUNE_GRACE_MS = 3_600_000 // 1 hour grace before an instruction is pruned
const DEFAULT_POLL_INTERVAL_MS = 2000

export interface S2ResourceManagerOptions {
  rmDetails: RmDetails
  nodeId: string
  pollIntervalMs?: number
  skipInstructionStatus?: boolean

  /** Port 1 - messages to send to the CEM (via transport). Pass null for "nothing on this port". */
  onSendToTransport: (msg: NodeMessage | null) => void
  /** Port 2 - all S2 messages from CEM (incl. instructions), plus lifecycle events. Pass null for "nothing on this port". */
  onEmitToCem: (msg: NodeMessage | null) => void
  onStatus: (status: NodeRedStatus) => void
  onLog: (msg: string) => void
  onWarn: (msg: string) => void
  onError: (msg: string) => void

  /** Backing store for the pending-instructions queue (e.g. flow context). */
  getContextValue: (key: string) => unknown
  setContextValue: (key: string, value: unknown) => void
  /** Resolves `{{global.xxx}}`/`{{flow.xxx}}` templates, used for `rmDetails.serialNumber`. */
  resolveContextTemplate: (template: string) => string
}

/**
 * S2ResourceManager - the generic S2 protocol state machine: handshake,
 * control-type selection, generic instruction ack/routing, one S2Session per
 * connected CEM. Extracted from `s2-rm`'s `registerType` body so it can be
 * constructed directly by both the `s2-rm` node and the `s2-resource`
 * composite node, with no behavior difference between them.
 *
 * Callback-based rather than tied to a Node-RED node instance - see
 * S2ResourceManagerOptions.
 */
export class S2ResourceManager {
  private readonly opts: S2ResourceManagerOptions
  private readonly rmDetails: RmDetails
  private readonly sessions = new Map<string, S2Session>()
  private readonly pollTimer: ReturnType<typeof setInterval>
  private readonly pollIntervalMs: number
  private readonly isSkipInstructionStatus: boolean
  private pendingPEBCConstraints: PEBCPowerConstraintsInput | null = null
  private statusTimer: ReturnType<typeof setTimeout> | null = null

  constructor (opts: S2ResourceManagerOptions) {
    this.opts = opts
    this.rmDetails = opts.rmDetails
    this.pollIntervalMs = opts.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS
    this.isSkipInstructionStatus = opts.skipInstructionStatus === true

    this.opts.onStatus({ fill: 'grey', shape: 'ring', text: 'waiting for CEM' })

    // Poll at the configured interval: dispatch due non-PEBC instructions, prune expired entries.
    // PEBC instructions bypass this queue entirely (see onInstruction) - their timing is owned by s2-pebc.
    this.pollTimer = setInterval(() => this.pollPending(), this.pollIntervalMs).unref()
  }

  private getPending (): PendingInstruction[] {
    return (this.opts.getContextValue(PENDING_INSTRUCTIONS_KEY) as PendingInstruction[] | undefined) || []
  }

  private setPending (pending: PendingInstruction[]): void {
    this.opts.setContextValue(PENDING_INSTRUCTIONS_KEY, pending)
  }

  private addToPending (item: PendingInstruction): void {
    const pending = this.getPending()
    const idx = pending.findIndex(p => p.messageId === item.messageId)
    if (idx >= 0) {
      pending[idx] = item
    } else {
      pending.push(item)
    }
    this.setPending(pending)
  }

  private pollPending (): void {
    const pending = this.getPending()
    if (pending.length === 0) return
    const now = Date.now()
    let changed = false
    const remaining: PendingInstruction[] = []
    for (const item of pending) {
      const expired = item.executionTimeMs + PRUNE_GRACE_MS < now
      if (expired) { changed = true; continue }
      if (item.executionTimeMs <= now) {
        const session = this.sessions.get(item.cemId)
        if (session && item.instructionId && !this.isSkipInstructionStatus) {
          session.sendInstructionStatus(item.instructionId, InstructionStatus.STARTED)
        }
        this.opts.onEmitToCem({ payload: item.instruction, cemId: item.cemId, topic: item.instruction.message_type as string })
        changed = true
        continue
      }
      remaining.push(item)
    }
    if (changed) this.setPending(remaining)
  }

  // S2 is a 1:1 CEM<->RM relationship, so the common case (one session) gets a
  // singular status naming the connected CEM. Multiple concurrent sessions are
  // technically possible (the map is keyed by cemId), so that case still shows a count.
  private updateStatus (): void {
    const count = this.sessions.size
    if (count === 0) {
      this.opts.onStatus({ fill: 'grey', shape: 'ring', text: 'waiting for CEM' })
    } else if (count === 1) {
      const [cemId] = this.sessions.keys()
      this.opts.onStatus({ fill: 'green', shape: 'dot', text: `CEM connected (${cemId})` })
    } else {
      this.opts.onStatus({ fill: 'green', shape: 'dot', text: `${count} CEMs connected` })
    }
  }

  private createSession (cemId: string): S2Session {
    // Resolve context variable templates at connect time (not at init)
    const resolvedDetails = this.rmDetails.serialNumber && this.rmDetails.serialNumber.includes('{{')
      ? { ...this.rmDetails, serialNumber: this.opts.resolveContextTemplate(this.rmDetails.serialNumber) || this.opts.nodeId }
      : this.rmDetails

    const session = new S2Session({
      cemId,
      rmDetails: resolvedDetails,

      onSend: (msg) => {
        const m = msg as Record<string, unknown>
        if (m.message_type === MessageType.PEBC_POWER_CONSTRAINTS && typeof m.id === 'string') {
          this.opts.setContextValue('pebcConstraintsId', m.id)
        }
        this.opts.onSendToTransport({ payload: { s2Signal: 'Message', message: msg }, cemId })
      },

      onStateChange: (state) => {
        if (state === State.CONNECTED) {
          this.opts.onLog(`CEM ${cemId} handshake complete`)
        }
        this.updateStatus()
      },

      onMessage: (msg) => {
        if (msg.message_type === MessageType.RECEPTION_STATUS &&
            msg.status && msg.status !== ReceptionStatusResult.OK) {
          const diag = msg.diagnostic_label ? `: ${msg.diagnostic_label}` : ''
          this.opts.onWarn(`CEM ${cemId} rejected message ${msg.subject_message_id || '?'} with ${msg.status}${diag}`)
          if (this.statusTimer) clearTimeout(this.statusTimer)
          this.opts.onStatus({ fill: 'yellow', shape: 'dot', text: `CEM rejection: ${msg.status}` })
          this.statusTimer = setTimeout(() => { this.statusTimer = null; this.updateStatus() }, 5000)
        }
        if (msg.message_type === MessageType.REVOKE_OBJECT) {
          const revokedId = (msg as { object_id?: string }).object_id
          const revokedObjectType = (msg as { object_type?: string }).object_type
          if (revokedId && revokedObjectType && revokedObjectType.endsWith('.Instruction')) {
            const pending = this.getPending()
            const revokedItem = pending.find(p => p.instructionId === revokedId)
            if (revokedItem) {
              this.setPending(pending.filter(p => p.instructionId !== revokedId))
              if (!this.isSkipInstructionStatus) {
                const sess = this.sessions.get(cemId)
                if (sess) sess.sendInstructionStatus(revokedId, InstructionStatus.REVOKED)
              }
            }
          }
        }
        this.opts.onEmitToCem({ payload: msg, cemId, topic: msg.message_type })
        if (msg.message_type === MessageType.SELECT_CONTROL_TYPE) {
          const controlType = (msg.control_type as string) || ControlType.NO_SELECTION
          const isActive = controlType !== ControlType.NO_SELECTION && controlType !== ControlType.NOT_CONTROLABLE
          this.opts.onSendToTransport({ payload: { 'S2/0/Active': isActive ? 1 : 0 } })
          if ((this.rmDetails.providesPowerMeasurementTypes || []).length > 0) {
            this.opts.onSendToTransport({
              payload: {
                s2Signal: 'PowerMeasurementStart',
                commodityQuantities: this.rmDetails.providesPowerMeasurementTypes
              },
              cemId
            })
          }
        }
      },

      onInstruction: (msg) => {
        const rawMsg = msg as Record<string, unknown>
        const messageId = rawMsg.message_id as string | undefined
        const instructionId = rawMsg.id as string | undefined
        const executionTimeStr = rawMsg.execution_time as string | undefined
        const executionTimeMs = executionTimeStr ? new Date(executionTimeStr).getTime() : Date.now()

        if (msg.message_type === MessageType.PEBC_INSTRUCTION) {
          // PEBC schedule accumulation and per-element dispatch timing is owned by s2-pebc -
          // deliver the raw instruction immediately so it can build/dispatch with its own timers.
          this.opts.onEmitToCem({ payload: msg, cemId, topic: msg.message_type })
          return
        }

        const now = Date.now()
        if (executionTimeMs <= now) {
          const session = this.sessions.get(cemId)
          if (session && instructionId && !this.isSkipInstructionStatus) {
            session.sendInstructionStatus(instructionId, InstructionStatus.STARTED)
          }
          this.opts.onEmitToCem({ payload: msg, cemId, topic: msg.message_type })
        } else {
          if (messageId) {
            this.addToPending({
              messageId,
              instructionId,
              instruction: rawMsg,
              cemId,
              executionTimeMs
            })
          }
        }
      },

      onError: (err) => {
        this.opts.onError(`S2 session error for CEM ${cemId}: ${err.message}`)
      }
    })
    this.sessions.set(cemId, session)
    if (this.pendingPEBCConstraints) {
      session.setPEBCPowerConstraints(this.pendingPEBCConstraints)
    }
    return session
  }

  /**
   * Handle one input message, in the same shape s2-rm's node input handler
   * accepts today: `{ payload: { command, cemId, ... } }`.
   */
  handleInput (msg: NodeMessage, done: (err?: Error) => void): void {
    if (!msg.payload || typeof msg.payload !== 'object') {
      done(new Error('msg.payload must be an object'))
      return
    }

    const { command, cemId, message, keepAliveInterval } = msg.payload as {
      command?: string
      cemId?: string
      message?: unknown
      keepAliveInterval?: number
    }

    if (!command) {
      done(new Error("msg.payload must have a 'command' field"))
      return
    }

    // PowerConstraints applies globally (all current + future sessions), so unlike every
    // other command it does not require a cemId - a control-type node can push a default
    // at deploy time, before any CEM has connected.
    if (command === 'PowerConstraints') {
      const { constraints } = msg.payload as { constraints?: PEBCPowerConstraintsInput }
      if (!constraints || typeof constraints !== 'object') {
        done(new Error('PowerConstraints requires a constraints object'))
        return
      }
      this.pendingPEBCConstraints = constraints
      for (const session of this.sessions.values()) {
        session.setPEBCPowerConstraints(constraints)
      }
      done()
      return
    }

    if (!cemId) {
      done(new Error("msg.payload must have a 'cemId' field"))
      return
    }

    switch (command) {
      case 'Connect': {
        if (this.sessions.has(cemId)) {
          this.opts.onWarn(`CEM ${cemId} connected again without prior Disconnect - replacing session`)
          this.sessions.get(cemId)!.dispose()
          this.sessions.delete(cemId)
        }
        const session = this.createSession(cemId)
        session.start()
        this.opts.onEmitToCem({ topic: 'Connected', cemId })
        this.opts.onLog(`CEM ${cemId} connected (keepAliveInterval: ${keepAliveInterval}s)`)
        this.updateStatus()
        done()
        break
      }

      case 'Message': {
        const session = this.sessions.get(cemId)
        if (!session) {
          done(new Error(`No session for CEM ${cemId} - missing Connect?`))
          return
        }
        if (message === undefined || message === null) {
          done(new Error(`message is missing for CEM ${cemId}`))
          return
        }
        session.handleMessage(message as string)
        done()
        break
      }

      case 'KeepAlive': {
        const kaSession = this.sessions.get(cemId)
        if (!kaSession) {
          this.opts.onWarn(`KeepAlive for unknown CEM ${cemId}`)
        } else {
          kaSession.keepAlive()
        }
        done()
        break
      }

      case 'PowerMeasurement': {
        const pmSession = this.sessions.get(cemId)
        if (!pmSession) {
          this.opts.onWarn(`PowerMeasurement for unknown CEM ${cemId} - ignoring`)
          done()
          return
        }
        const { values } = msg.payload as { values?: unknown[] }
        if (!Array.isArray(values) || values.length === 0) {
          done(new Error(`PowerMeasurement requires a non-empty values array for CEM ${cemId}`))
          return
        }
        pmSession.send(makePowerMeasurement(values as PowerMeasurementValue[]))
        done()
        break
      }

      case 'Forecast': {
        const { forecast } = msg.payload as { forecast?: PowerForecastInput }
        if (!forecast || !forecast.startTime || !Array.isArray(forecast.elements)) {
          done(new Error('Forecast requires a forecast object with startTime and elements'))
          return
        }
        const fcSession = this.sessions.get(cemId)
        if (!fcSession) {
          this.opts.onWarn(`Forecast for unknown CEM ${cemId} - ignoring`)
          done()
          return
        }
        fcSession.send(makePowerForecast(forecast))
        done()
        break
      }

      case 'Disconnect': {
        this.sessions.get(cemId)?.dispose()
        this.sessions.delete(cemId)
        this.opts.onEmitToCem({ topic: 'Disconnected', cemId, reason: 'cem_initiated' })
        this.opts.onLog(`CEM ${cemId} disconnected`)
        this.updateStatus()
        done()
        break
      }

      case 'InstructionStatus': {
        const { instructionId, status } = msg.payload as { instructionId?: string, status?: string }
        if (!instructionId || typeof instructionId !== 'string') {
          done(new Error('InstructionStatus requires an instructionId string'))
          return
        }
        if (!status || !Object.values(InstructionStatus).includes(status as InstructionStatusValue)) {
          done(new Error(`InstructionStatus requires a valid status: ${Object.values(InstructionStatus).join(', ')}`))
          return
        }
        const isSession = this.sessions.get(cemId)
        if (!isSession) {
          this.opts.onWarn(`InstructionStatus for unknown CEM ${cemId} - ignoring`)
          done()
          return
        }
        isSession.sendInstructionStatus(instructionId, status as InstructionStatusValue)
        done()
        break
      }

      case 'UpdateStatus': {
        const { controlType, ...payload } = msg.payload as { controlType?: string, [key: string]: unknown }
        if (!controlType || typeof controlType !== 'string') {
          done(new Error('UpdateStatus requires a controlType string'))
          return
        }
        const usSession = this.sessions.get(cemId)
        if (!usSession) {
          this.opts.onWarn(`UpdateStatus for unknown CEM ${cemId} - ignoring`)
          done()
          return
        }
        usSession.updateStatus(controlType, payload as StatusPayload)
        done()
        break
      }

      case 'SystemDescription': {
        const { controlType, ...payload } = msg.payload as { controlType?: string, [key: string]: unknown }
        if (!controlType || typeof controlType !== 'string') {
          done(new Error('SystemDescription requires a controlType string'))
          return
        }
        const sdSession = this.sessions.get(cemId)
        if (!sdSession) {
          this.opts.onWarn(`SystemDescription for unknown CEM ${cemId} - ignoring`)
          done()
          return
        }
        sdSession.sendSystemDescription(controlType, payload as SystemDescriptionPayload)
        done()
        break
      }

      default:
        done(new Error(`Unknown command: ${command}`))
    }
  }

  /** Dispose all sessions and timers. Call on node close. */
  close (): void {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer)
      this.statusTimer = null
    }
    clearInterval(this.pollTimer)
    for (const session of this.sessions.values()) {
      session.dispose()
    }
    this.sessions.clear()
  }
}
