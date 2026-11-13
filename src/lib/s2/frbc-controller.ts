import { NodeMessage, DoneFunction, NodeRedStatus } from '../../types/node-red'
import {
  ControlType,
  MessageType,
  InstructionStatus,
  InstructionStatusValue,
  FRBCActuatorStatusConfig,
  FRBCLeakageBehaviourConfig,
  FRBCProfileConfig,
  FRBCStatusPayload,
  FRBCSystemDescriptionConfig,
  FRBCTimerStatusConfig,
  makeFRBCFillLevelTargetProfile,
  makeFRBCLeakageBehaviour,
  makeFRBCSystemDescription,
  makeFRBCUsageForecast
} from './messages'
import { validateS2Message } from './schema-validation'

type NumberRange = { start_of_range: number, end_of_range: number }
type PowerRange = NumberRange & { commodity_quantity: string }
type OperationModeElement = { fill_level_range: NumberRange, fill_rate: NumberRange, power_ranges: PowerRange[] }
type OperationMode = { id: string, diagnostic_label?: string, elements: OperationModeElement[], abnormal_condition_only?: boolean }
type Transition = { id: string, from: string, to: string, start_timers: string[], blocking_timers: string[] }
type Timer = { id: string, diagnostic_label?: string, duration: number }
type Actuator = { id: string, diagnostic_label?: string, operation_modes: OperationMode[], transitions: Transition[], timers: Timer[] }
type Storage = { fill_level_range: NumberRange, provides_leakage_behaviour?: boolean, provides_fill_level_target_profile?: boolean, provides_usage_forecast?: boolean }

/** s2-frbc-config's two JSON fields, parsed. */
export interface FRBCConfig {
  systemDescription: FRBCSystemDescriptionConfig
  leakageBehaviour?: FRBCLeakageBehaviourConfig
}

/** Device state - one physical buffer, whichever CEM is controlling it - kept in node context. */
interface DeviceState {
  fillLevel?: number
  actuators: Record<string, FRBCActuatorStatusConfig>
  timers: FRBCTimerStatusConfig[]
  usageForecast?: Required<FRBCProfileConfig>
  fillLevelTargetProfile?: Required<FRBCProfileConfig>
}

interface OpenInstruction {
  instructionId: string
  actuatorId: string
  operationModeId: string
  factor: number
}

interface CemState {
  selected: boolean
  /** Fill level last sent to this CEM, so an unchanged value isn't sent again. */
  lastSentFillLevel?: number
  /** Instructions emitted to the flow and not yet confirmed, oldest first. */
  openInstructions: OpenInstruction[]
}

const DEVICE_STATE_KEY = 's2FrbcState'
// Open instructions per CEM, kept in node context so they still get a final status after s2-frbc
// alone is redeployed (s2-rm keeps its sessions then).
const OPEN_INSTRUCTIONS_KEY = 's2FrbcOpenInstructions'
// Bounds openInstructions when a CEM keeps instructing without the flow ever confirming.
const MAX_OPEN_INSTRUCTIONS = 50
const FLOW_TOPICS = ['StorageStatus', 'ActuatorConfirmation', 'UsageForecast', 'FillLevelTargetProfile', 'TimerStatus']

function label (item: { id: string, diagnostic_label?: string }): string {
  return item.diagnostic_label || item.id
}

function inRange (value: number, range: NumberRange): boolean {
  return value >= range.start_of_range && value <= range.end_of_range
}

function nearestElement (elements: OperationModeElement[], fillLevel: number): OperationModeElement {
  const distance = (e: OperationModeElement): number =>
    Math.max(e.fill_level_range.start_of_range - fillLevel, fillLevel - e.fill_level_range.end_of_range)
  return elements.reduce((best, e) => distance(e) < distance(best) ? e : best)
}

function interpolate (range: NumberRange, factor: number): number {
  return range.start_of_range + factor * (range.end_of_range - range.start_of_range)
}

/** Time at which a profile's last element ends, in ms since the epoch. */
function profileEndMs (profile: Required<FRBCProfileConfig>): number {
  const total = (profile.elements as Array<{ duration?: unknown }>)
    .reduce((sum, e) => sum + (typeof e.duration === 'number' ? e.duration : 0), 0)
  return new Date(profile.startTime).getTime() + total
}

// Keys whose value must be an object, and arrays whose entries must be objects. The vendored S2
// schemas don't say so ("type": "object"), so `storage: null` or `actuators: [null]` would pass.
const OBJECT_KEYS = new Set(['storage', 'fill_level_range', 'fill_rate', 'running_costs'])
const OBJECT_ARRAYS = new Set(['actuators', 'operation_modes', 'elements', 'power_ranges', 'transitions', 'timers'])

function isObject (value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** JSON pointers of values in OBJECT_KEYS or entries in OBJECT_ARRAYS that are not objects. */
function nonObjectEntries (value: unknown, path = ''): string[] {
  if (typeof value !== 'object' || value === null) return []
  const problems: string[] = []
  for (const [key, child] of Object.entries(value)) {
    const at = `${path}/${key}`
    if (OBJECT_KEYS.has(key) && !isObject(child)) problems.push(`${at} must be an object`)
    if (OBJECT_ARRAYS.has(key) && Array.isArray(child)) {
      child.forEach((entry, i) => { if (!isObject(entry)) problems.push(`${at}/${i} must be an object`) })
    }
    problems.push(...nonObjectEntries(child, at))
  }
  return problems
}

/** Element fill level ranges must each start below their end, and be contiguous (in any order). */
function fillLevelRangeProblems (elements: Array<{ fill_level_range: NumberRange }>, where: string): string[] {
  const problems: string[] = []
  elements.forEach((element, i) => {
    const range = element.fill_level_range
    if (!(range.start_of_range < range.end_of_range)) problems.push(`${where}, element ${i}: fill_level_range must start below its end`)
  })
  const ranges = elements.map(e => e.fill_level_range).sort((a, b) => a.start_of_range - b.start_of_range)
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start_of_range !== ranges[i - 1].end_of_range) {
      problems.push(`${where}: fill_level_ranges must be contiguous, but one ends at ${ranges[i - 1].end_of_range} and the next starts at ${ranges[i].start_of_range}`)
    }
  }
  return problems
}

/**
 * Cross-reference checks on an FRBC configuration that the S2 JSON schema can't express:
 * unique ids, transitions and timers that refer to things that exist within the same actuator,
 * and leakage behaviour given if and only if the storage description says it is provided.
 * Assumes the shape already passed (or will be checked by) schema validation - anything missing
 * is skipped rather than reported twice. Returns one message per problem, empty when consistent.
 */
export function frbcConfigProblems (config: FRBCConfig): string[] {
  const problems: string[] = []
  const actuators = (Array.isArray(config.systemDescription?.actuators) ? config.systemDescription.actuators : []) as Actuator[]

  const actuatorIds = new Set<string>()
  for (const actuator of actuators) {
    if (!actuator || typeof actuator !== 'object') continue
    const where = `actuator "${actuator.id}"`
    if (actuatorIds.has(actuator.id)) problems.push(`Duplicate actuator id "${actuator.id}"`)
    actuatorIds.add(actuator.id)

    const modeIds = new Set<string>()
    for (const mode of Array.isArray(actuator.operation_modes) ? actuator.operation_modes : []) {
      if (modeIds.has(mode.id)) problems.push(`${where}: duplicate operation mode id "${mode.id}"`)
      modeIds.add(mode.id)
      const mWhere = `${where}, mode "${mode.id}"`
      problems.push(...fillLevelRangeProblems(mode.elements, mWhere))
      mode.elements.forEach((element, i) => {
        const quantities = element.power_ranges.map(r => r.commodity_quantity)
        for (const cq of new Set(quantities.filter((q, j) => quantities.indexOf(q) !== j))) {
          problems.push(`${mWhere}, element ${i}: more than one power range for ${cq}`)
        }
      })
    }
    const timerIds = new Set<string>()
    for (const timer of Array.isArray(actuator.timers) ? actuator.timers : []) {
      if (timerIds.has(timer.id)) problems.push(`${where}: duplicate timer id "${timer.id}"`)
      timerIds.add(timer.id)
    }
    const transitionIds = new Set<string>()
    for (const transition of Array.isArray(actuator.transitions) ? actuator.transitions : []) {
      const tWhere = `${where}, transition "${transition.id}"`
      if (transitionIds.has(transition.id)) problems.push(`${where}: duplicate transition id "${transition.id}"`)
      transitionIds.add(transition.id)
      if (!modeIds.has(transition.from)) problems.push(`${tWhere}: "from" refers to unknown operation mode "${transition.from}"`)
      if (!modeIds.has(transition.to)) problems.push(`${tWhere}: "to" refers to unknown operation mode "${transition.to}"`)
      for (const field of ['start_timers', 'blocking_timers'] as const) {
        for (const timerId of Array.isArray(transition[field]) ? transition[field] : []) {
          if (!timerIds.has(timerId)) problems.push(`${tWhere}: ${field} refers to unknown timer "${timerId}"`)
        }
      }
    }
  }

  if (config.leakageBehaviour) {
    problems.push(...fillLevelRangeProblems(config.leakageBehaviour.elements as Array<{ fill_level_range: NumberRange }>, 'leakage behaviour'))
  }

  const providesLeakage = (config.systemDescription?.storage as Storage | undefined)?.provides_leakage_behaviour === true
  if (providesLeakage && !config.leakageBehaviour) {
    problems.push('storage.provides_leakage_behaviour is true, but no leakage behaviour is configured')
  } else if (!providesLeakage && config.leakageBehaviour) {
    problems.push('A leakage behaviour is configured, but storage.provides_leakage_behaviour is not true')
  }
  return problems
}

/**
 * Parses s2-frbc-config's raw JSON fields. An empty leakage field means no leakage behaviour.
 * Throws with a message naming the field on invalid JSON or a non-object value.
 */
export function parseFRBCConfig (rawSystemDescription: string | undefined, rawLeakageBehaviour: string | undefined): FRBCConfig {
  const parseObject = (raw: string, field: string): Record<string, unknown> => {
    let parsed: unknown
    let parseError: string | null = null
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      parseError = (err as Error).message
    }
    if (parseError !== null) {
      throw new Error(`${field}: invalid JSON: ${parseError}`)
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${field}: must be a JSON object`)
    }
    return parsed as Record<string, unknown>
  }
  if (!rawSystemDescription || !rawSystemDescription.trim()) {
    throw new Error('System description: not configured')
  }
  const config: FRBCConfig = {
    systemDescription: parseObject(rawSystemDescription, 'System description') as unknown as FRBCSystemDescriptionConfig
  }
  if (rawLeakageBehaviour && rawLeakageBehaviour.trim()) {
    config.leakageBehaviour = parseObject(rawLeakageBehaviour, 'Leakage behaviour') as unknown as FRBCLeakageBehaviourConfig
  }
  return config
}

/**
 * Validates an FRBC configuration the way s2-frbc will use it: both messages built from it must
 * pass S2 schema validation, and the cross-references the schema can't check must hold. Used by
 * s2-frbc-config's save-time endpoint and s2-frbc's deploy-time check. Empty when valid.
 */
export function validateFRBCConfig (config: FRBCConfig): string[] {
  const errors: string[] = []
  const sd = validateS2Message(makeFRBCSystemDescription(config.systemDescription))
  if (!sd.valid) errors.push(...(sd.errors ?? []).map(e => `System description: ${e}`))
  if (config.leakageBehaviour) {
    const lb = validateS2Message(makeFRBCLeakageBehaviour(config.leakageBehaviour))
    if (!lb.valid) errors.push(...(lb.errors ?? []).map(e => `Leakage behaviour: ${e}`))
  }
  if (errors.length === 0) {
    errors.push(...nonObjectEntries(config.systemDescription).map(e => `System description: ${e}`))
    if (config.leakageBehaviour) errors.push(...nonObjectEntries(config.leakageBehaviour).map(e => `Leakage behaviour: ${e}`))
  }
  // Cross-reference checks assume the shape is right; reporting them on a broken shape only
  // adds noise to the errors above.
  if (errors.length === 0) errors.push(...frbcConfigProblems(config))
  return errors
}

export interface FRBCControllerOptions {
  config: FRBCConfig
  /** Instructions and Selected/Deselected events for the downstream flow (output 1). */
  onEmitInstruction: (msg: NodeMessage) => void
  /** Commands to s2-rm (output 2). */
  onSendCommand: (msg: NodeMessage) => void
  onStatus: (status: NodeRedStatus) => void
  onWarn: (message: string) => void
  getContextValue: (key: string) => unknown
  setContextValue: (key: string, value: unknown) => void
}

/**
 * FRBCController - FRBC-specific S2 protocol behaviour for the s2-frbc node: pushes the FRBC
 * system description when a CEM selects FRBC, replays the known device state, resolves FRBC
 * instructions into actionable output, and turns flow inputs (fill level, actuator
 * confirmation, forecasts, timers) into FRBC status messages via s2-rm's UpdateStatus command.
 */
export class FRBCController {
  private readonly opts: FRBCControllerOptions
  private readonly actuators: Actuator[]
  private readonly storage: Storage
  private readonly cemStates = new Map<string, CemState>()

  constructor (opts: FRBCControllerOptions) {
    this.opts = opts
    this.actuators = opts.config.systemDescription.actuators as Actuator[]
    this.storage = opts.config.systemDescription.storage as Storage
    this.reconcileStoredState()
    const open = this.opts.getContextValue(OPEN_INSTRUCTIONS_KEY) as Record<string, OpenInstruction[]> | undefined
    for (const [cemId, openInstructions] of Object.entries(open ?? {})) {
      this.cemStates.set(cemId, { selected: false, openInstructions })
    }
    this.refreshStatus()
  }

  private hasMode (actuatorId: string, modeId: string | undefined): boolean {
    return modeId !== undefined && !!this.actuators.find(a => a.id === actuatorId)?.operation_modes.some(m => m.id === modeId)
  }

  private saveOpenInstructions (): void {
    const open = [...this.cemStates].filter(([, s]) => s.openInstructions.length > 0).map(([id, s]) => [id, s.openInstructions])
    this.opts.setContextValue(OPEN_INSTRUCTIONS_KEY, Object.fromEntries(open))
  }

  /**
   * Drops stored device state the current configuration no longer covers. Node context survives
   * redeploys, so after the config changed (an actuator, mode or timer removed, or a profile no
   * longer declared) the replay on selection would otherwise send messages about things the
   * system description doesn't describe.
   */
  private reconcileStoredState (): void {
    const stored = this.opts.getContextValue(DEVICE_STATE_KEY) as DeviceState | undefined
    if (!stored) return
    const device = this.getDeviceState()
    const actuatorById = new Map(this.actuators.map(a => [a.id, a]))

    const actuators: Record<string, FRBCActuatorStatusConfig> = {}
    for (const status of Object.values(device.actuators)) {
      if (!this.hasMode(status.actuatorId, status.activeOperationModeId)) continue
      if (status.previousOperationModeId !== undefined && !this.hasMode(status.actuatorId, status.previousOperationModeId)) {
        actuators[status.actuatorId] = { actuatorId: status.actuatorId, activeOperationModeId: status.activeOperationModeId, operationModeFactor: status.operationModeFactor }
      } else {
        actuators[status.actuatorId] = status
      }
    }
    device.actuators = actuators
    device.timers = device.timers.filter(t => !!actuatorById.get(t.actuatorId)?.timers.some(timer => timer.id === t.timerId))
    if (this.storage.provides_usage_forecast !== true) delete device.usageForecast
    if (this.storage.provides_fill_level_target_profile !== true) delete device.fillLevelTargetProfile
    this.setDeviceState(device)
  }

  /**
   * Asks s2-rm to re-emit SelectControlType for every CEM that currently has FRBC selected. A
   * restarted s2-frbc (e.g. after its config changed) starts without knowing the selection, while
   * s2-rm's sessions - and the CEM's choice of FRBC - survive a modified-nodes deploy; the replay
   * makes this node send its (new) system description and state again.
   */
  requestSelectionReplay (): void {
    this.opts.onSendCommand({ payload: { command: 'ReplaySelection', controlType: ControlType.FRBC } })
  }

  // -- state --

  private getDeviceState (): DeviceState {
    const stored = this.opts.getContextValue(DEVICE_STATE_KEY) as DeviceState | undefined
    return stored ? { ...stored, actuators: { ...stored.actuators }, timers: [...stored.timers] } : { actuators: {}, timers: [] }
  }

  private setDeviceState (state: DeviceState): void {
    this.opts.setContextValue(DEVICE_STATE_KEY, state)
  }

  private getOrCreateCemState (cemId: string): CemState {
    let state = this.cemStates.get(cemId)
    if (!state) {
      state = { selected: false, openInstructions: [] }
      this.cemStates.set(cemId, state)
    }
    return state
  }

  private selectedCemIds (): string[] {
    return [...this.cemStates.entries()].filter(([, s]) => s.selected).map(([id]) => id)
  }

  /**
   * The CEMs a flow input is sent to: the given cemId if FRBC is selected for it, otherwise the
   * one CEM with FRBC selected. An empty list means "store only". Throws when cemId is omitted
   * and more than one CEM has FRBC selected.
   */
  private targetCemIds (cemId: unknown): string[] {
    if (typeof cemId === 'string' && cemId) {
      return this.cemStates.get(cemId)?.selected ? [cemId] : []
    }
    const selected = this.selectedCemIds()
    if (selected.length > 1) {
      throw new Error('More than one CEM has FRBC selected - set msg.cemId to say which one this is for')
    }
    return selected
  }

  private sendStatus (cemId: string, frbc: FRBCStatusPayload): void {
    this.opts.onSendCommand({ payload: { command: 'UpdateStatus', cemId, controlType: ControlType.FRBC, frbc } })
  }

  private refreshStatus (): void {
    const selected = this.selectedCemIds()
    const device = this.getDeviceState()
    const fill = device.fillLevel === undefined ? 'fill level unknown' : `fill ${device.fillLevel}`
    if (selected.length === 0) {
      this.opts.onStatus({ fill: 'grey', shape: 'ring', text: `FRBC not selected - ${fill}` })
    } else if (device.fillLevel === undefined) {
      this.opts.onStatus({ fill: 'yellow', shape: 'ring', text: 'FRBC selected - fill level unknown, send StorageStatus' })
    } else {
      this.opts.onStatus({ fill: 'green', shape: 'dot', text: `FRBC selected - ${fill}` })
    }
  }

  // -- reference resolution --

  /**
   * Resolves an actuator or operation mode reference: a string matching an id (preferred) or a
   * unique diagnostic_label, or a number used as a 0-based index.
   */
  private resolveRef<T extends { id: string, diagnostic_label?: string }> (items: T[], ref: unknown, kind: string): T {
    if (typeof ref === 'number') {
      if (!Number.isInteger(ref) || ref < 0 || ref >= items.length) {
        throw new Error(`${kind} index ${ref} is out of range (0-${items.length - 1})`)
      }
      return items[ref]
    }
    if (typeof ref !== 'string' || !ref) {
      throw new Error(`${kind} is required (an id, a 0-based index or a diagnostic label)`)
    }
    const byId = items.find(i => i.id === ref)
    if (byId) return byId
    const byLabel = items.filter(i => i.diagnostic_label === ref)
    if (byLabel.length === 1) return byLabel[0]
    if (byLabel.length > 1) throw new Error(`${kind} label "${ref}" matches more than one ${kind}`)
    throw new Error(`${kind} "${ref}" does not match any configured ${kind}`)
  }

  // -- CEM messages --

  /**
   * Gives an open instruction its final status. S2 requires an InstructionStatusUpdate for every
   * instruction until it reaches SUCCEEDED, REVOKED, REJECTED or ABORTED, so no open instruction
   * may be forgotten without one.
   */
  private finishInstruction (cemId: string, open: OpenInstruction, status: InstructionStatusValue): void {
    this.opts.onSendCommand({ payload: { command: 'InstructionStatus', cemId, instructionId: open.instructionId, status } })
  }

  /** Ends an instruction that will not be carried out: a warning, ABORTED, and no output. */
  private abortInstruction (cemId: string | undefined, instructionId: string, reason: string): void {
    this.opts.onWarn(`FRBC.Instruction ${instructionId} ${reason} - aborted`)
    if (cemId && instructionId) {
      this.opts.onSendCommand({ payload: { command: 'InstructionStatus', cemId, instructionId, status: InstructionStatus.ABORTED } })
    }
  }

  /** Forgets a CEM's FRBC selection and session state, telling the flow if it had FRBC selected. */
  // With sessionEnded the session is gone (Disconnected) or replaced (Connected), so there is no
  // one left to report to; after a switch to another control type the session remains, and open
  // FRBC instructions get ABORTED - they will no longer be carried out.
  private deselect (cemId: string, reason: Record<string, unknown>, sessionEnded: boolean): void {
    const state = this.cemStates.get(cemId)
    // Also for a CEM restored from context that has not been selected again yet.
    if (state && state.openInstructions.length > 0) {
      if (!sessionEnded) {
        for (const open of state.openInstructions) this.finishInstruction(cemId, open, InstructionStatus.ABORTED)
      }
      state.openInstructions = []
      this.saveOpenInstructions()
    }
    if (state?.selected) {
      state.selected = false
      state.lastSentFillLevel = undefined
      this.opts.onEmitInstruction({ topic: 'Deselected', payload: reason, cemId })
    }
    this.refreshStatus()
  }

  private handleSelectControlType (msg: NodeMessage): void {
    const cemId = msg.cemId as string | undefined
    if (!cemId) return
    const controlType = (msg.payload as Record<string, unknown>).control_type as string
    const state = this.getOrCreateCemState(cemId)

    if (controlType !== ControlType.FRBC) {
      this.deselect(cemId, { controlType }, false)
      return
    }

    state.selected = true
    state.lastSentFillLevel = undefined
    // Open instructions stay open when FRBC is selected again: the device may still carry them out.
    // Those restored after a redeploy whose actuator or mode the configuration no longer has can't
    // be confirmed any more.
    const openCount = state.openInstructions.length
    state.openInstructions = state.openInstructions.filter(open => {
      if (this.hasMode(open.actuatorId, open.operationModeId)) return true
      this.finishInstruction(cemId, open, InstructionStatus.ABORTED)
      return false
    })
    if (state.openInstructions.length !== openCount) this.saveOpenInstructions()
    this.opts.onSendCommand({
      payload: {
        command: 'SystemDescription',
        cemId,
        controlType: ControlType.FRBC,
        frbc: {
          systemDescription: this.opts.config.systemDescription,
          ...(this.opts.config.leakageBehaviour ? { leakageBehaviour: this.opts.config.leakageBehaviour } : {})
        }
      }
    })

    // Replay what is known about the device, so the CEM can plan without the flow resending.
    const device = this.getDeviceState()
    const now = Date.now()
    const replay: FRBCStatusPayload = {}
    const actuatorStatuses = Object.values(device.actuators)
    if (actuatorStatuses.length > 0) replay.actuatorStatuses = actuatorStatuses
    if (device.fillLevel !== undefined) {
      replay.storageStatus = { presentFillLevel: device.fillLevel }
      state.lastSentFillLevel = device.fillLevel
    }
    const timers = device.timers.filter(t => new Date(t.finishedAt).getTime() > now)
    if (timers.length > 0) replay.timerStatuses = timers
    if (device.usageForecast && profileEndMs(device.usageForecast) > now) replay.usageForecast = device.usageForecast
    if (device.fillLevelTargetProfile && profileEndMs(device.fillLevelTargetProfile) > now) replay.fillLevelTargetProfile = device.fillLevelTargetProfile
    if (Object.keys(replay).length > 0) this.sendStatus(cemId, replay)

    this.opts.onEmitInstruction({ topic: 'Selected', payload: { controlType }, cemId })
    this.refreshStatus()
  }

  private handleInstruction (msg: NodeMessage): void {
    const instr = msg.payload as Record<string, unknown>
    const cemId = msg.cemId as string | undefined
    const instructionId = instr.id as string
    const factor = typeof instr.operation_mode_factor === 'number' ? instr.operation_mode_factor : 1

    if (!cemId || !this.cemStates.get(cemId)?.selected) {
      this.abortInstruction(cemId, instructionId, 'from a CEM that has not selected FRBC')
      return
    }
    if (factor < 0 || factor > 1) {
      this.abortInstruction(cemId, instructionId, `has operation_mode_factor ${factor}, outside 0-1`)
      return
    }

    const actuatorIndex = this.actuators.findIndex(a => a.id === instr.actuator_id)
    const actuator = this.actuators[actuatorIndex]
    const modeIndex = actuator ? actuator.operation_modes.findIndex(m => m.id === instr.operation_mode) : -1
    if (!actuator || modeIndex < 0) {
      const what = actuator ? `operation mode "${String(instr.operation_mode)}" of actuator "${actuator.id}"` : `actuator "${String(instr.actuator_id)}"`
      this.abortInstruction(cemId, instructionId, `refers to unknown ${what}`)
      return
    }
    const mode = actuator.operation_modes[modeIndex]
    if (mode.abnormal_condition_only === true && instr.abnormal_condition !== true) {
      this.abortInstruction(cemId, instructionId, `selects mode "${label(mode)}", which is for abnormal conditions only`)
      return
    }

    const fillLevel = this.getDeviceState().fillLevel
    let element: OperationModeElement | undefined
    if (fillLevel === undefined) {
      element = mode.elements[0]
      this.opts.onWarn(`FRBC.Instruction ${instructionId}: fill level unknown - using the first element of mode "${label(mode)}"`)
    } else {
      element = mode.elements.find(e => inRange(fillLevel, e.fill_level_range))
      if (!element) {
        // S2 lets a mode cover only part of the fill level range, e.g. fast charging up to 80 %. A
        // fill level outside the storage's range (a sensor overshooting), or an abnormal condition,
        // must not stop the CEM from switching the device: use the nearest element then.
        if (inRange(fillLevel, this.storage.fill_level_range) && instr.abnormal_condition !== true) {
          this.abortInstruction(cemId, instructionId, `selects mode "${label(mode)}", which is not available at fill level ${fillLevel}`)
          return
        }
        element = nearestElement(mode.elements, fillLevel)
        this.opts.onWarn(`FRBC.Instruction ${instructionId}: no element of mode "${label(mode)}" covers fill level ${fillLevel} - using the nearest one`)
      }
    }

    const commodityPower = element.power_ranges.map(r => ({ commodity_quantity: r.commodity_quantity, value: interpolate(r, factor) }))
    const byCq = new Map(commodityPower.map(p => [p.commodity_quantity, p.value]))
    let values: number | number[] | undefined
    if (byCq.has('ELECTRIC.POWER.3_PHASE_SYMMETRIC')) {
      values = byCq.get('ELECTRIC.POWER.3_PHASE_SYMMETRIC')
    } else if (['L1', 'L2', 'L3'].some(p => byCq.has(`ELECTRIC.POWER.${p}`))) {
      values = ['L1', 'L2', 'L3'].map(p => byCq.get(`ELECTRIC.POWER.${p}`) ?? 0)
    }

    if (instructionId) {
      const state = this.getOrCreateCemState(cemId)
      // An unconfirmed earlier instruction for this actuator that asked for another mode is
      // overtaken: it will not be carried out any more. One for the same mode stays open - the
      // device may still be switching to it, and the confirmation closes both.
      state.openInstructions = state.openInstructions.filter(open => {
        if (open.actuatorId !== actuator.id || open.operationModeId === mode.id) return true
        this.finishInstruction(cemId, open, InstructionStatus.ABORTED)
        return false
      })
      state.openInstructions.push({ instructionId, actuatorId: actuator.id, operationModeId: mode.id, factor })
      if (state.openInstructions.length > MAX_OPEN_INSTRUCTIONS) {
        this.finishInstruction(cemId, state.openInstructions.shift()!, InstructionStatus.ABORTED)
      }
      this.saveOpenInstructions()
    }

    this.opts.onStatus({ fill: 'green', shape: 'dot', text: `instructed: ${label(actuator)} → ${label(mode)}` })
    this.opts.onEmitInstruction({
      topic: 'ActuatorInstruction',
      payload: {
        instructionId,
        actuatorId: actuator.id,
        actuatorLabel: label(actuator),
        actuatorIndex,
        operationModeId: mode.id,
        operationModeLabel: label(mode),
        operationModeIndex: modeIndex,
        factor,
        abnormalCondition: instr.abnormal_condition === true,
        fillRate: interpolate(element.fill_rate, factor),
        commodityPower,
        ...(values !== undefined ? { values } : {})
      },
      cemId,
      rawS2Message: instr
    })
  }

  // s2-rm already answers a revoke for an instruction it still holds (execution_time not reached).
  // Revoking one that was already handed to the flow is left open by S2; the CEM asked for it, so
  // it gets REVOKED, and the flow is told so the device logic can decide whether to undo anything.
  private handleRevoke (msg: NodeMessage): void {
    const payload = msg.payload as Record<string, unknown>
    const cemId = msg.cemId as string
    const state = this.cemStates.get(cemId)
    if (!state || payload.object_type !== MessageType.FRBC_INSTRUCTION) return
    const index = state.openInstructions.findIndex(i => i.instructionId === payload.object_id)
    if (index < 0) return
    const [open] = state.openInstructions.splice(index, 1)
    this.saveOpenInstructions()
    this.finishInstruction(cemId, open, InstructionStatus.REVOKED)
    this.opts.onEmitInstruction({
      topic: 'Revoked',
      payload: { instructionId: open.instructionId, actuatorId: open.actuatorId, operationModeId: open.operationModeId, factor: open.factor },
      cemId
    })
  }

  // -- flow inputs --

  // Flow inputs take their targets lazily: they describe the device, so they are stored even when
  // no single CEM can be determined to send them to (several with FRBC selected and no msg.cemId).
  private handleStorageStatus (payload: Record<string, unknown>, targets: () => string[]): void {
    const fillLevel = payload.fillLevel
    if (typeof fillLevel !== 'number' || !Number.isFinite(fillLevel)) {
      throw new Error('StorageStatus requires payload.fillLevel to be a finite number')
    }
    const device = this.getDeviceState()
    device.fillLevel = fillLevel
    this.setDeviceState(device)
    this.refreshStatus()
    for (const cemId of targets()) {
      const state = this.getOrCreateCemState(cemId)
      if (state.lastSentFillLevel === fillLevel) continue
      state.lastSentFillLevel = fillLevel
      this.sendStatus(cemId, { storageStatus: { presentFillLevel: fillLevel } })
    }
  }

  private handleActuatorConfirmation (payload: Record<string, unknown>, targets: () => string[]): void {
    const actuator = this.resolveRef(this.actuators, payload.actuator ?? payload.actuatorId, 'actuator')
    const mode = this.resolveRef(actuator.operation_modes, payload.operationMode ?? payload.operationModeId, 'operation mode')
    const factor = payload.factor === undefined ? 1 : payload.factor
    if (typeof factor !== 'number' || !(factor >= 0 && factor <= 1)) {
      throw new Error(`ActuatorConfirmation factor must be a number from 0 to 1, got ${JSON.stringify(payload.factor)}`)
    }

    const device = this.getDeviceState()
    const previous = device.actuators[actuator.id]
    const now = new Date()
    const status: FRBCActuatorStatusConfig = { actuatorId: actuator.id, activeOperationModeId: mode.id, operationModeFactor: factor }
    const timerStatuses: FRBCTimerStatusConfig[] = []
    if (previous && previous.activeOperationModeId !== mode.id) {
      status.previousOperationModeId = previous.activeOperationModeId
      status.transitionTimestamp = now.toISOString()
      const transition = actuator.transitions.find(t => t.from === previous.activeOperationModeId && t.to === mode.id)
      for (const timerId of transition?.start_timers || []) {
        const timer = actuator.timers.find(t => t.id === timerId)
        if (!timer) continue
        timerStatuses.push({ actuatorId: actuator.id, timerId, finishedAt: new Date(now.getTime() + timer.duration).toISOString() })
      }
    } else if (previous) {
      // Same mode, maybe a new factor - keep the last real transition on record.
      if (previous.previousOperationModeId) status.previousOperationModeId = previous.previousOperationModeId
      if (previous.transitionTimestamp) status.transitionTimestamp = previous.transitionTimestamp
    }
    device.actuators[actuator.id] = status
    device.timers = [
      ...device.timers.filter(t => !timerStatuses.some(n => n.actuatorId === t.actuatorId && n.timerId === t.timerId)),
      ...timerStatuses
    ]
    this.setDeviceState(device)

    for (const cemId of targets()) {
      this.sendStatus(cemId, { actuatorStatuses: [status], ...(timerStatuses.length > 0 ? { timerStatuses } : {}) })
    }
    // Also for a CEM restored after a redeploy whose selection hasn't been replayed yet.
    for (const [cemId, state] of this.cemStates) {
      // Every open instruction for this actuator that asked for exactly this mode and factor is
      // fulfilled; any older one for the actuator that asked for something else is overtaken.
      const matches = (open: OpenInstruction): boolean =>
        open.actuatorId === actuator.id && open.operationModeId === mode.id && Math.abs(open.factor - factor) < 1e-9
      let lastMatch = -1
      state.openInstructions.forEach((open, i) => { if (matches(open)) lastMatch = i })
      if (lastMatch >= 0) {
        state.openInstructions = state.openInstructions.filter((open, i) => {
          if (open.actuatorId !== actuator.id || i > lastMatch) return true
          this.finishInstruction(cemId, open, matches(open) ? InstructionStatus.SUCCEEDED : InstructionStatus.ABORTED)
          return false
        })
        this.saveOpenInstructions()
      }
    }
    const selected = this.selectedCemIds().length > 0
    this.opts.onStatus({
      fill: selected ? 'green' : 'grey',
      shape: selected ? 'dot' : 'ring',
      text: `${label(actuator)}: ${label(mode)}${selected ? '' : ' (stored, FRBC not selected)'}`
    })
  }

  private handleProfile (kind: 'UsageForecast' | 'FillLevelTargetProfile', payload: Record<string, unknown>, targets: () => string[]): void {
    const declared = kind === 'UsageForecast' ? this.storage.provides_usage_forecast : this.storage.provides_fill_level_target_profile
    if (declared !== true) {
      const flag = kind === 'UsageForecast' ? 'provides_usage_forecast' : 'provides_fill_level_target_profile'
      this.opts.onWarn(`${kind} ignored: the system description's storage.${flag} is not true`)
      return
    }
    if (payload.revoke !== undefined) {
      if (payload.revoke !== true || payload.elements !== undefined) {
        throw new Error(`${kind} takes either payload.elements or payload.revoke: true, not both`)
      }
      // S2 JSON has no RevokeObject type for these (s2-json up to v1.0.0), so only stop replaying it.
      const device = this.getDeviceState()
      const key = kind === 'UsageForecast' ? 'usageForecast' : 'fillLevelTargetProfile'
      if (!device[key]) {
        this.opts.onWarn(`${kind} revoke ignored: none was sent`)
        return
      }
      delete device[key]
      this.setDeviceState(device)
      this.opts.onWarn(`${kind} withdrawn: it is no longer sent on selection, but S2 has no message to revoke it, so a CEM keeps the one it has until it ends`)
      return
    }
    if (!Array.isArray(payload.elements) || payload.elements.length === 0) {
      throw new Error(`${kind} requires a non-empty payload.elements array`)
    }
    const profile = { startTime: typeof payload.startTime === 'string' ? payload.startTime : new Date().toISOString(), elements: payload.elements }
    // Checked before it is stored: an invalid profile would otherwise be replayed on every selection.
    const check = validateS2Message(kind === 'UsageForecast' ? makeFRBCUsageForecast(profile) : makeFRBCFillLevelTargetProfile(profile))
    if (!check.valid) throw new Error(`${kind} is not valid S2: ${(check.errors ?? []).join('; ')}`)
    const device = this.getDeviceState()
    if (kind === 'UsageForecast') device.usageForecast = profile
    else device.fillLevelTargetProfile = profile
    this.setDeviceState(device)
    for (const cemId of targets()) {
      this.sendStatus(cemId, kind === 'UsageForecast' ? { usageForecast: profile } : { fillLevelTargetProfile: profile })
    }
  }

  private handleTimerStatus (payload: Record<string, unknown>, targets: () => string[]): void {
    const actuator = this.resolveRef(this.actuators, payload.actuator ?? payload.actuatorId, 'actuator')
    const timer = this.resolveRef(actuator.timers, payload.timerId ?? payload.timer, 'timer')
    const finishedAtRaw = payload.finishedAt
    const finishedAtMs = typeof finishedAtRaw === 'number' ? finishedAtRaw : typeof finishedAtRaw === 'string' ? new Date(finishedAtRaw).getTime() : NaN
    if (!Number.isFinite(finishedAtMs)) {
      throw new Error('TimerStatus requires payload.finishedAt as an ISO 8601 string or milliseconds since the epoch')
    }
    const status: FRBCTimerStatusConfig = { actuatorId: actuator.id, timerId: timer.id, finishedAt: new Date(finishedAtMs).toISOString() }
    const device = this.getDeviceState()
    device.timers = [...device.timers.filter(t => !(t.actuatorId === status.actuatorId && t.timerId === status.timerId)), status]
    this.setDeviceState(device)
    for (const cemId of targets()) {
      this.sendStatus(cemId, { timerStatuses: [status] })
    }
  }

  /**
   * Handle one input message: CEM messages forwarded from s2-rm (SelectControlType,
   * FRBC.Instruction, RevokeObject, lifecycle events), or one of the flow topics.
   */
  handleInput (msg: NodeMessage, done: DoneFunction): void {
    const cemId = msg.cemId as string | undefined
    const topic = msg.topic as string | undefined

    // s2-rm emits Connected for every new session - also when a CEM reconnects without a
    // Disconnect first, which replaces its session: FRBC is then not selected until the CEM
    // selects it again, exactly as after a Disconnect.
    if ((topic === 'Disconnected' || topic === 'Connected') && cemId) {
      this.deselect(cemId, { reason: topic === 'Connected' ? 'reconnected' : 'disconnected' }, true)
      done()
      return
    }

    const payload = msg.payload as Record<string, unknown> | undefined
    if (!payload || typeof payload !== 'object') {
      done()
      return
    }

    if (topic && FLOW_TOPICS.includes(topic)) {
      try {
        const targets = (): string[] => this.targetCemIds(msg.cemId)
        if (topic === 'StorageStatus') this.handleStorageStatus(payload, targets)
        else if (topic === 'ActuatorConfirmation') this.handleActuatorConfirmation(payload, targets)
        else if (topic === 'UsageForecast' || topic === 'FillLevelTargetProfile') this.handleProfile(topic, payload, targets)
        else this.handleTimerStatus(payload, targets)
      } catch (err) {
        done(err as Error)
        return
      }
      done()
      return
    }

    switch (payload.message_type) {
      case MessageType.SELECT_CONTROL_TYPE:
        this.handleSelectControlType(msg)
        break
      case MessageType.FRBC_INSTRUCTION:
        this.handleInstruction(msg)
        break
      case MessageType.REVOKE_OBJECT:
        this.handleRevoke(msg)
        break
      case undefined:
        // Not an S2 message from s2-rm and not one of the flow topics - most likely a topic typo,
        // or an ActuatorInstruction wired back without setting msg.topic to ActuatorConfirmation.
        this.opts.onWarn(`Ignored input with msg.topic ${topic === undefined ? '(none)' : `"${String(topic)}"`}: expected one of ${FLOW_TOPICS.join(', ')}${topic === 'ActuatorInstruction' ? ' - to confirm an instruction, send its payload with msg.topic "ActuatorConfirmation"' : ''}`)
        break
      default:
        // Other control types' instructions and other CEM messages: not ours, ignore silently.
        break
    }
    done()
  }
}
