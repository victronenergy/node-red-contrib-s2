import { NodeMessage, DoneFunction, NodeRedStatus } from '../../types/node-red'
import { ControlType, MessageType, OMBCStatusConfig, OMBCSystemDescriptionConfig } from './messages'
import { PowerMeasurementValue } from './power-measurement-cache'

interface CemState {
  selectedControlType: string | null
}

type PowerRange = { commodity_quantity: string, start_of_range: number, end_of_range: number }
type ResolvedOMBCMode = { id: string, index: number, label: string, factor: number, powerRanges: PowerRange[] }
type ModeIdResolution = { id: string } | { error: string }

const PERSISTED_STATUS_KEY_PREFIX = 's2OmbcStatus:'
const DEFAULT_STATUS_KEY = 's2OmbcDefaultStatus'

export interface OMBCControllerOptions {
  systemDescription: OMBCSystemDescriptionConfig
  /** Instructions/requests for the downstream flow (s2-ombc's output 1 today). */
  onEmitInstruction: (msg: NodeMessage) => void
  /** Commands to the resource manager (s2-ombc's output 2 / SystemDescription+UpdateStatus commands today). */
  onSendCommand: (msg: NodeMessage) => void
  onStatus: (status: NodeRedStatus) => void
  getContextValue: (key: string) => unknown
  setContextValue: (key: string, value: unknown) => void
  /** When true, an incoming OMBC.Instruction is confirmed back to the CEM immediately (the
   * same UpdateStatus that a ModeConfirmation on the input would produce), instead of waiting
   * for the flow to report the mode is actually active. Suits a resource with no independent
   * hardware-state feedback (e.g. a virtual/test device); a flow that confirms based on real
   * hardware state should leave this off. Defaults to false. */
  autoConfirmInstructions?: boolean
}

/**
 * OMBCController - OMBC-specific S2 protocol behavior: declares the OMBC
 * system description, resolves OMBC instructions into actionable output, and
 * confirms operation mode changes back to the CEM once told the hardware
 * state is confirmed. Extracted from `s2-ombc`'s `registerType` body so it
 * can be constructed directly by both the `s2-ombc` node and the
 * `s2-resource` composite node's built-in OMBC control type, with no
 * behavior difference between them.
 */
export class OMBCController {
  private readonly opts: OMBCControllerOptions
  private readonly systemDescription: OMBCSystemDescriptionConfig
  private readonly cemStates = new Map<string, CemState>()

  constructor (opts: OMBCControllerOptions) {
    this.opts = opts
    this.systemDescription = opts.systemDescription
    this.opts.onStatus({ fill: 'grey', shape: 'ring', text: 'idle' })
  }

  private getOrCreateState (cemId: string): CemState {
    let state = this.cemStates.get(cemId)
    if (!state) {
      state = { selectedControlType: null }
      this.cemStates.set(cemId, state)
    }
    return state
  }

  private getPersistedStatus (cemId: string): OMBCStatusConfig | null {
    return (this.opts.getContextValue(PERSISTED_STATUS_KEY_PREFIX + cemId) as OMBCStatusConfig | undefined) || null
  }

  private setPersistedStatus (cemId: string, status: OMBCStatusConfig): void {
    this.opts.setContextValue(PERSISTED_STATUS_KEY_PREFIX + cemId, status)
  }

  private getDefaultStatus (): OMBCStatusConfig | null {
    return (this.opts.getContextValue(DEFAULT_STATUS_KEY) as OMBCStatusConfig | undefined) || null
  }

  private setDefaultStatus (status: OMBCStatusConfig): void {
    this.opts.setContextValue(DEFAULT_STATUS_KEY, status)
  }

  // Resolves a mode identifier from payload down to a configured mode's canonical id.
  // Accepts new format (id/index/label) and legacy format (confirmedOperationModeId/Index/Label).
  private resolveModeIdentifier (payload: Record<string, unknown>): ModeIdResolution {
    const idField = payload.id ?? payload.confirmedOperationModeId
    const indexField = payload.index ?? payload.confirmedOperationModeIndex
    const labelField = payload.label ?? payload.confirmedOperationModeLabel
    const providedCount = [idField, indexField, labelField].filter(v => v !== undefined).length

    if (providedCount !== 1) {
      return { error: 'Confirm message requires exactly one of id, index, or label (or legacy confirmedOperationModeId/Index/Label)' }
    }

    const modes = (this.systemDescription.operationModes || []) as Array<Record<string, unknown>>

    if (idField !== undefined) {
      const modeId = idField as string
      const match = modes.find(m => m.id === modeId)
      if (!match) {
        return { error: `confirmedOperationModeId "${modeId}" does not match any configured operation mode` }
      }
      return { id: modeId }
    }

    if (indexField !== undefined) {
      const index = indexField as number
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= modes.length) {
        return { error: `confirmedOperationModeIndex ${String(index)} is out of range (0-${modes.length - 1})` }
      }
      return { id: modes[index].id as string }
    }

    const label = labelField as string
    const matches = modes.filter(m => m.diagnostic_label === label)
    if (matches.length === 0) {
      return { error: `confirmedOperationModeLabel "${label}" does not match any configured operation mode` }
    }
    if (matches.length > 1) {
      return { error: `confirmedOperationModeLabel "${label}" matches more than one configured operation mode` }
    }
    return { id: matches[0].id as string }
  }

  private resolveMode (rawInstr: Record<string, unknown>): ResolvedOMBCMode | null {
    const modeId = (rawInstr.operation_mode_id || rawInstr.operation_mode) as string | undefined
    if (!modeId) return null
    const factor = typeof rawInstr.operation_mode_factor === 'number' ? rawInstr.operation_mode_factor : 1
    const modes = this.systemDescription.operationModes as Array<Record<string, unknown>> | undefined
    const modeIndex = modes?.findIndex(m => m.id === modeId) ?? -1
    const mode = modeIndex >= 0 ? modes![modeIndex] : undefined
    return {
      id: modeId,
      index: modeIndex,
      label: (mode?.diagnostic_label as string | undefined) || modeId,
      factor,
      powerRanges: (mode?.power_ranges as PowerRange[] | undefined) || []
    }
  }

  // Resolves per-phase power from power ranges and factor, S2-shaped: one {commodity_quantity,
  // value} pair per phase (L1/L2/L3), the same shape PowerMeasurement/PowerRange values use
  // elsewhere in this codebase and in the S2 spec itself.
  private calculatePower (powerRanges: PowerRange[], factor: number): PowerMeasurementValue[] {
    const byCq = new Map<string, PowerRange>()
    for (const r of powerRanges) byCq.set(r.commodity_quantity, r)

    const sym = byCq.get('ELECTRIC.POWER.3_PHASE_SYMMETRIC')
    if (sym) {
      const total = sym.start_of_range + factor * (sym.end_of_range - sym.start_of_range)
      const perPhase = Math.round(total / 3)
      return [
        { commodity_quantity: 'ELECTRIC.POWER.L1', value: perPhase },
        { commodity_quantity: 'ELECTRIC.POWER.L2', value: perPhase },
        { commodity_quantity: 'ELECTRIC.POWER.L3', value: perPhase }
      ]
    }

    function phaseValue (cq: string): number {
      const r = byCq.get(cq)
      if (!r) return 0
      return Math.round(r.start_of_range + factor * (r.end_of_range - r.start_of_range))
    }
    return [
      { commodity_quantity: 'ELECTRIC.POWER.L1', value: phaseValue('ELECTRIC.POWER.L1') },
      { commodity_quantity: 'ELECTRIC.POWER.L2', value: phaseValue('ELECTRIC.POWER.L2') },
      { commodity_quantity: 'ELECTRIC.POWER.L3', value: phaseValue('ELECTRIC.POWER.L3') }
    ]
  }

  private modeLabelOrId (modeId: string): string {
    const modes = (this.systemDescription.operationModes || []) as Array<Record<string, unknown>>
    const mode = modes.find(m => m.id === modeId)
    return (mode?.diagnostic_label as string | undefined) || modeId
  }

  private handleInstruction (msg: NodeMessage): void {
    const payload = msg.payload as Record<string, unknown>
    const messageType = payload.message_type as string
    if (messageType !== MessageType.OMBC_INSTRUCTION) {
      return
    }
    const resolved = this.resolveMode(payload)
    if (resolved) {
      const commodityPower = this.calculatePower(resolved.powerRanges, resolved.factor)
      this.opts.onStatus({ fill: 'green', shape: 'dot', text: resolved.label })
      this.opts.onEmitInstruction({
        topic: 'ModeInstruction',
        payload: { id: resolved.id, index: resolved.index, label: resolved.label, factor: resolved.factor, commodityPower },
        cemId: msg.cemId,
        rawS2Message: msg.payload
      })
      if (this.opts.autoConfirmInstructions && msg.cemId) {
        this.confirmMode(msg.cemId as string, resolved.id, resolved.factor)
      }
    } else {
      this.opts.onEmitInstruction({ ...msg })
    }
  }

  private handleSelectControlType (msg: NodeMessage): void {
    const cemId = msg.cemId
    if (!cemId) return
    const payload = msg.payload as Record<string, unknown>
    const controlType = payload.control_type as string
    this.getOrCreateState(cemId).selectedControlType = controlType
    if (controlType !== ControlType.OMBC) return

    this.opts.onSendCommand({ payload: { command: 'SystemDescription', cemId, controlType: ControlType.OMBC, ombc: this.systemDescription } })

    let status = this.getPersistedStatus(cemId)
    if (!status) {
      const defaultStatus = this.getDefaultStatus()
      if (defaultStatus) {
        this.setPersistedStatus(cemId, defaultStatus)
        status = defaultStatus
      }
    }

    if (status) {
      this.opts.onSendCommand({ payload: { command: 'UpdateStatus', cemId, controlType: ControlType.OMBC, ombc: status } })
    } else {
      this.opts.onEmitInstruction({ topic: 'ModeRequest', payload: null, cemId })
    }
  }

  private handleConfirm (msg: NodeMessage, done: DoneFunction): void {
    const payload = msg.payload as Record<string, unknown>

    const resolution = this.resolveModeIdentifier(payload)
    if ('error' in resolution) {
      done(new Error(resolution.error))
      return
    }
    const modeId = resolution.id

    let cemId = msg.cemId as string | undefined
    if (!cemId) {
      const ombcCemIds = Array.from(this.cemStates.entries())
        .filter(([, state]) => state.selectedControlType === ControlType.OMBC)
        .map(([id]) => id)
      if (ombcCemIds.length > 1) {
        done(new Error('Confirm message with no cemId is ambiguous - multiple CEMs currently have OMBC selected; specify cemId'))
        return
      }
      if (ombcCemIds.length === 1) {
        cemId = ombcCemIds[0]
      }
    }

    const factor = payload.factor ?? payload.operationModeFactor
    const operationModeFactor = typeof factor === 'number' ? factor : 1

    if (!cemId) {
      // No CEM currently has OMBC selected (pre-connection, or after a disconnect) - store as
      // the default status for whichever CEM next selects OMBC, per "Pre-connection default
      // status" in the spec.
      this.setDefaultStatus({ activeOperationModeId: modeId, operationModeFactor })
      this.opts.onStatus({ fill: 'blue', shape: 'dot', text: `default: ${this.modeLabelOrId(modeId)}` })
      done()
      return
    }

    if (!this.confirmMode(cemId, modeId, operationModeFactor)) {
      this.opts.onStatus({ fill: 'yellow', shape: 'ring', text: 'OMBC not selected - confirm ignored' })
    }
    done()
  }

  /**
   * Persists and reports a confirmed active mode for a CEM (the shared tail of an explicit
   * ModeConfirmation and an auto-confirmed instruction). Returns false without doing anything
   * if that CEM doesn't currently have OMBC selected.
   */
  private confirmMode (cemId: string, modeId: string, operationModeFactor: number): boolean {
    const state = this.getOrCreateState(cemId)
    if (state.selectedControlType !== ControlType.OMBC) {
      return false
    }

    const previous = this.getPersistedStatus(cemId)
    let status: OMBCStatusConfig = {
      activeOperationModeId: modeId,
      operationModeFactor
    }
    if (previous && previous.activeOperationModeId !== modeId) {
      status = {
        ...status,
        previousOperationModeId: previous.activeOperationModeId,
        transitionTimestamp: new Date().toISOString()
      }
    }
    this.setPersistedStatus(cemId, status)
    this.opts.onStatus({ fill: 'green', shape: 'dot', text: `Confirmed: ${this.modeLabelOrId(modeId)}` })
    this.opts.onSendCommand({ payload: { command: 'UpdateStatus', cemId, controlType: ControlType.OMBC, ombc: status } })
    return true
  }

  /**
   * Handle one input message, in the same shape s2-ombc's node input handler
   * accepts today: CEM messages forwarded from the RM, plus ModeConfirmation/
   * PowerMeasurement messages from the flow.
   */
  handleInput (msg: NodeMessage, done: DoneFunction): void {
    const cemId = msg.cemId
    const topic = msg.topic

    if (topic === 'Disconnected' && cemId) {
      const state = this.cemStates.get(cemId)
      if (state) state.selectedControlType = null
      done()
      return
    }

    const payload = msg.payload as Record<string, unknown> | undefined
    if (!payload || typeof payload !== 'object') {
      done()
      return
    }

    if (topic === 'ModeConfirmation' ||
        'confirmedOperationModeId' in payload || 'confirmedOperationModeIndex' in payload || 'confirmedOperationModeLabel' in payload) {
      this.handleConfirm(msg, done)
      return
    }

    if (topic === 'PowerMeasurement') {
      let pmCemId = msg.cemId as string | undefined
      if (!pmCemId) {
        const ombcCemIds = Array.from(this.cemStates.entries())
          .filter(([, state]) => state.selectedControlType === ControlType.OMBC)
          .map(([id]) => id)
        if (ombcCemIds.length === 1) {
          pmCemId = ombcCemIds[0]
        } else {
          done()
          return
        }
      }
      const rawValues = (payload as Record<string, unknown>).values
      // values: 3000 → 3-phase symmetric; values: [L1, L2, L3] → per-phase
      let values: unknown[]
      if (typeof rawValues === 'number') {
        values = [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: rawValues }]
      } else if (Array.isArray(rawValues) && rawValues.length === 3 && typeof rawValues[0] === 'number') {
        values = [
          { commodity_quantity: 'ELECTRIC.POWER.L1', value: rawValues[0] },
          { commodity_quantity: 'ELECTRIC.POWER.L2', value: rawValues[1] },
          { commodity_quantity: 'ELECTRIC.POWER.L3', value: rawValues[2] }
        ]
      } else if (Array.isArray(rawValues) && rawValues.length > 0 && typeof rawValues[0] === 'object') {
        values = rawValues
      } else {
        done(new Error('PowerMeasurement values must be a number (3-phase symmetric), a 3-element array [L1, L2, L3], or an array of {commodity_quantity, value} objects'))
        return
      }
      this.opts.onSendCommand({ payload: { command: 'PowerMeasurement', cemId: pmCemId, values } })
      done()
      return
    }

    if ('controlType' in msg) {
      // Legacy enriched instruction from s2-rm (pre-v0.3)
      this.handleInstruction(msg)
      done()
      return
    }

    const messageType = (payload as Record<string, unknown>).message_type as string | undefined
    if (messageType && messageType.startsWith('OMBC.')) {
      this.handleInstruction(msg)
      done()
      return
    }

    if (payload.message_type === MessageType.SELECT_CONTROL_TYPE) {
      this.handleSelectControlType(msg)
      done()
      return
    }

    done()
  }
}
