import { NodeMessage, DoneFunction, NodeRedStatus } from '../../types/node-red'
import { ControlType, MessageType, OMBCStatusConfig, OMBCSystemDescriptionConfig } from './messages'
import { PowerMeasurementValue } from './power-measurement-cache'

interface CemState {
  selectedControlType: string | null
}

type PowerRange = { commodity_quantity: string, start_of_range: number, end_of_range: number }
type ResolvedOMBCMode = { id: string, index: number, label: string, factor: number, powerRanges: PowerRange[] }
type ModeIdResolution = { id: string } | { error: string }
type PowerMeasurementConfig = { measurementType: string, nrOfPhases: number, phaseSetting: number }

const PERSISTED_STATUS_KEY_PREFIX = 's2OmbcStatus:'
const DEFAULT_STATUS_KEY = 's2OmbcDefaultStatus'

export interface OMBCControllerOptions {
  systemDescription: OMBCSystemDescriptionConfig
  /** Instructions/requests for the downstream flow (s2-ombc's output 1 today). */
  onEmitInstruction: (msg: NodeMessage) => void
  /** Commands to the resource manager (s2-ombc's output 2 / SystemDescription+UpdateStatus commands today). */
  onSendCommand: (msg: NodeMessage) => void
  onStatus: (status: NodeRedStatus) => void
  onWarn?: (message: string) => void
  getContextValue: (key: string) => unknown
  setContextValue: (key: string, value: unknown) => void
  /** Optional D-Bus measurement shape. When present, resolved instructions use its S2 commodity shape. */
  powerMeasurement?: PowerMeasurementConfig
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
  // Priority id > index > label when more than one is present (rather than requiring exactly
  // one), so a whole previously-emitted ModeInstruction payload - which already carries id,
  // index, and label together - can be wired straight back in as a confirmation.
  private resolveModeIdentifier (payload: Record<string, unknown>): ModeIdResolution {
    const idField = payload.id ?? payload.confirmedOperationModeId
    const indexField = payload.index ?? payload.confirmedOperationModeIndex
    const labelField = payload.label ?? payload.confirmedOperationModeLabel

    if (idField === undefined && indexField === undefined && labelField === undefined) {
      return { error: 'Confirm message requires at least one of id, index, or label (or legacy confirmedOperationModeId/Index/Label)' }
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

  private calculatePowerProfile (powerRanges: PowerRange[], factor: number): { hasSymmetric: boolean, symmetric: number, phases: number[] } {
    const byCq = new Map<string, PowerRange>()
    for (const r of powerRanges) byCq.set(r.commodity_quantity, r)

    const sym = byCq.get('ELECTRIC.POWER.3_PHASE_SYMMETRIC')
    const rangeValue = (r: PowerRange | undefined): number => {
      if (!r) return 0
      return Math.round(r.start_of_range + factor * (r.end_of_range - r.start_of_range))
    }
    const symmetric = rangeValue(sym)
    const phases = ['L1', 'L2', 'L3'].map(phase => rangeValue(byCq.get(`ELECTRIC.POWER.${phase}`)))
    return { hasSymmetric: sym !== undefined, symmetric, phases }
  }

  // Resolves power from power ranges and factor in the same S2-shaped form as
  // PowerMeasurement/PowerRange values, constrained to the configured D-Bus measurement shape
  // when this controller is used by s2-resource.
  private calculatePower (powerRanges: PowerRange[], factor: number): PowerMeasurementValue[] {
    const profile = this.calculatePowerProfile(powerRanges, factor)
    const measurement = this.opts.powerMeasurement
    if (measurement?.measurementType === '3_PHASE_SYMMETRIC') {
      const total = profile.hasSymmetric ? profile.symmetric : profile.phases.reduce((sum, value) => sum + value, 0)
      return [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: total }]
    }
    if (measurement?.measurementType === 'L1_L2_L3') {
      if (measurement.nrOfPhases === 1) {
        const phase = Math.max(1, Math.min(3, measurement.phaseSetting))
        const value = profile.hasSymmetric ? Math.round(profile.symmetric / 3) : profile.phases[phase - 1]
        return [{ commodity_quantity: `ELECTRIC.POWER.L${phase}`, value }]
      }
      if (measurement.nrOfPhases === 3) {
        const phases = profile.hasSymmetric
          ? [1, 2, 3].map(() => profile.symmetric / 3)
          : profile.phases
        return phases.map((value, index) => ({ commodity_quantity: `ELECTRIC.POWER.L${index + 1}`, value }))
      }
    }

    if (profile.hasSymmetric) {
      return [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: profile.symmetric }]
    }
    return profile.phases.map((value, index) => ({ commodity_quantity: `ELECTRIC.POWER.L${index + 1}`, value }))
  }

  // Same power-ranges/factor interpolation as calculatePower(), reshaped into the `values`
  // convenience shape PowerMeasurement input already accepts (a number for 3-phase-symmetric,
  // or an array whose length matches the configured per-phase count) - computed independently from the ranges rather than
  // derived from calculatePower()'s already-per-phase-rounded output, so a symmetric mode's
  // total isn't off by the rounding this codebase's per-phase division introduces.
  private calculateValues (powerRanges: PowerRange[], factor: number): number | number[] {
    const profile = this.calculatePowerProfile(powerRanges, factor)
    const measurement = this.opts.powerMeasurement
    if (measurement?.measurementType === '3_PHASE_SYMMETRIC') {
      return profile.hasSymmetric ? profile.symmetric : profile.phases.reduce((sum, value) => sum + value, 0)
    }
    if (measurement?.measurementType === 'L1_L2_L3' && measurement.nrOfPhases === 1) {
      const phase = Math.max(1, Math.min(3, measurement.phaseSetting))
      return [profile.hasSymmetric ? Math.round(profile.symmetric / 3) : profile.phases[phase - 1]]
    }
    if (measurement?.measurementType === 'L1_L2_L3' && measurement.nrOfPhases === 3) {
      return profile.hasSymmetric ? [1, 2, 3].map(() => profile.symmetric / 3) : profile.phases
    }
    return profile.hasSymmetric ? profile.symmetric : profile.phases
  }

  private modeLabelOrId (modeId: string): string {
    const modes = (this.systemDescription.operationModes || []) as Array<Record<string, unknown>>
    const mode = modes.find(m => m.id === modeId)
    return (mode?.diagnostic_label as string | undefined) || modeId
  }

  private toPowerMeasurementValues (rawValues: unknown): PowerMeasurementValue[] {
    const measurement = this.opts.powerMeasurement
    const numericArray = Array.isArray(rawValues) && rawValues.every(value => typeof value === 'number')
    const warn = (message: string): void => this.opts.onWarn?.(`PowerMeasurement values: ${message}`)

    if (rawValues === null || rawValues === 0) {
      rawValues = 0
    }

    if (measurement?.measurementType === '3_PHASE_SYMMETRIC') {
      if (typeof rawValues === 'number') {
        return [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: rawValues }]
      }
      if (numericArray && (rawValues as unknown[]).length === 3) {
        warn('summed the three values for 3-phase symmetric power')
        return [{
          commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC',
          value: (rawValues as number[]).reduce((sum, value) => sum + value, 0)
        }]
      }
    } else if (measurement?.measurementType === 'L1_L2_L3') {
      const phase = Math.max(1, Math.min(3, measurement.phaseSetting))
      if (measurement.nrOfPhases === 1) {
        if (typeof rawValues === 'number') {
          return [{ commodity_quantity: `ELECTRIC.POWER.L${phase}`, value: rawValues }]
        }
        if (numericArray && (rawValues as unknown[]).length === 3) {
          warn(`selected index ${phase - 1} for wired phase L${phase} from the three-value array`)
          return [{ commodity_quantity: `ELECTRIC.POWER.L${phase}`, value: (rawValues as number[])[phase - 1] }]
        }
        if (numericArray && (rawValues as unknown[]).length === 1) {
          return [{ commodity_quantity: `ELECTRIC.POWER.L${phase}`, value: (rawValues as number[])[0] }]
        }
      } else if (measurement.nrOfPhases === 3 && numericArray && (rawValues as unknown[]).length === 3) {
        return (rawValues as number[]).map((value, index) => ({
          commodity_quantity: `ELECTRIC.POWER.L${index + 1}`,
          value
        }))
      } else if (measurement.nrOfPhases === 3 && typeof rawValues === 'number') {
        warn('divided the scalar equally across L1, L2, and L3')
        const perPhase = (rawValues as number) / 3
        return [1, 2, 3].map(index => ({ commodity_quantity: `ELECTRIC.POWER.L${index}`, value: perPhase }))
      }
    } else {
      // Preserve the standalone s2-ombc input contract when no D-Bus measurement shape exists.
      if (typeof rawValues === 'number') {
        return [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: rawValues }]
      }
      if (numericArray && (rawValues as unknown[]).length === 3) {
        return (rawValues as number[]).map((value, index) => ({
          commodity_quantity: `ELECTRIC.POWER.L${index + 1}`,
          value
        }))
      }
    }

    if (Array.isArray(rawValues) && rawValues.length > 0 && rawValues.every(value => typeof value === 'object' && value !== null)) {
      return rawValues as PowerMeasurementValue[]
    }
    throw new Error('PowerMeasurement values do not match the configured S2 measurement shape')
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
      const values = this.calculateValues(resolved.powerRanges, resolved.factor)
      this.opts.onStatus({ fill: 'green', shape: 'dot', text: resolved.label })
      this.opts.onEmitInstruction({
        topic: 'ModeInstruction',
        payload: { id: resolved.id, index: resolved.index, label: resolved.label, factor: resolved.factor, commodityPower, values },
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
      const hasValues = Object.prototype.hasOwnProperty.call(payload, 'values')
      const rawValues = hasValues ? payload.values : payload.commodityPower
      let values: PowerMeasurementValue[]
      try {
        values = this.toPowerMeasurementValues(rawValues)
      } catch (err) {
        done(err as Error)
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
