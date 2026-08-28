import { NodeRedApp, NodeConfig, NodeRedNode, NodeMessage, DoneFunction } from '../../types/node-red'
import { S2OmbcConfigNode } from '../../types/config-nodes'
import { ControlType, MessageType, OMBCStatusConfig, OMBCSystemDescriptionConfig } from '../../lib/s2/messages'

interface S2OmbcNodeConfig extends NodeConfig {
  ombcConfig: string
}

interface CemState {
  selectedControlType: string | null
}

type ResolvedOMBCMode = { id: string, index: number, label: string, factor: number, powerRanges: unknown[] }

const PERSISTED_STATUS_KEY_PREFIX = 's2OmbcStatus:'
const DEFAULT_STATUS_KEY = 's2OmbcDefaultStatus'

type ModeIdResolution = { id: string } | { error: string }

/**
 * s2-ombc node
 *
 * Owns OMBC-specific S2 protocol behavior: declares the OMBC system description,
 * resolves OMBC instructions into actionable output, and confirms operation mode
 * changes back to the CEM once told the hardware state is confirmed.
 *
 * Wiring:
 *   [s2-rm output 2 (from CEM)]    -> [s2-ombc input]  (to observe SelectControlType)
 *   [s2-rm output 3 (instructions)] -> [s2-ombc input]  (to resolve OMBC instructions)
 *   [confirm-mode message]          -> [s2-ombc input]  (see Input below)
 *   [s2-ombc output 1]  -> downstream flow (resolved/pass-through instructions)
 *   [s2-ombc output 2]  -> [s2-rm input]  (SystemDescription / UpdateStatus commands)
 *
 * Input:
 *   S2 "from CEM" messages and enriched instructions forwarded from s2-rm, as-is.
 *   Confirm-mode message (from your own flow, once hardware state is confirmed):
 *     { payload: { <mode identifier>, operationModeFactor?: <number> }, cemId?: <string> }
 *   where <mode identifier> is exactly one of:
 *     confirmedOperationModeId: <id>          - exact operation mode id
 *     confirmedOperationModeIndex: <number>   - 0-based index into the configured operation modes
 *     confirmedOperationModeLabel: <string>   - matches a mode's diagnostic_label (must be unique)
 *   cemId is optional: if omitted, it resolves to the one CEM currently with OMBC selected (an
 *   error if more than one), or - if none - the confirm is stored as a default status applied to
 *   whichever CEM next selects OMBC with no persisted status of its own.
 *
 * Output port 1 - instructions:
 *   OMBC instructions resolved: { payload, cemId, controlType, topic: <mode label>, ombc: { operationMode: {...}, ... } }
 *   Non-OMBC instructions: passed through unchanged (node status shows a warning).
 *   StatusRequest notification - sent after SystemDescription when a newly OMBC-selecting CEM has
 *   neither a persisted status nor a default available: { topic: 'StatusRequest', cemId }
 *
 * Output port 2 - commands to s2-rm:
 *   { payload: { command: 'SystemDescription', cemId, controlType, ombc } }
 *   { payload: { command: 'UpdateStatus', cemId, controlType, ombc } }
 */
export = function (RED: NodeRedApp): void {
  function S2OmbcNode (this: NodeRedNode, config: S2OmbcNodeConfig): void {
    RED.nodes.createNode(this, config)
    const node = this

    const ombcConfigNode = RED.nodes.getNode(config.ombcConfig) as S2OmbcConfigNode | null
    if (!ombcConfigNode) {
      node.error('s2-ombc-config node is missing - please configure an OMBC System Description')
      node.status({ fill: 'red', shape: 'dot', text: 'config missing' })
      return
    }

    let systemDescription: OMBCSystemDescriptionConfig = { operationModes: [], transitions: [], timers: [] }
    if (ombcConfigNode.systemDescription) {
      try {
        systemDescription = JSON.parse(ombcConfigNode.systemDescription) as OMBCSystemDescriptionConfig
      } catch (e) {
        node.error('Invalid OMBC System Description JSON: ' + (e as Error).message)
      }
    }

    const cemStates = new Map<string, CemState>()

    function getOrCreateState (cemId: string): CemState {
      let state = cemStates.get(cemId)
      if (!state) {
        state = { selectedControlType: null }
        cemStates.set(cemId, state)
      }
      return state
    }

    function getPersistedStatus (cemId: string): OMBCStatusConfig | null {
      return (node.context().get(PERSISTED_STATUS_KEY_PREFIX + cemId) as OMBCStatusConfig | undefined) || null
    }

    function setPersistedStatus (cemId: string, status: OMBCStatusConfig): void {
      node.context().set(PERSISTED_STATUS_KEY_PREFIX + cemId, status)
    }

    function getDefaultStatus (): OMBCStatusConfig | null {
      return (node.context().get(DEFAULT_STATUS_KEY) as OMBCStatusConfig | undefined) || null
    }

    function setDefaultStatus (status: OMBCStatusConfig): void {
      node.context().set(DEFAULT_STATUS_KEY, status)
    }

    // Resolves a confirm message's mode identifier - exactly one of confirmedOperationModeId /
    // confirmedOperationModeIndex / confirmedOperationModeLabel - down to a configured mode's
    // canonical id. All three are validated against systemDescription.operationModes: an id must
    // match a configured mode, an index must be in range, and a label must match exactly one mode
    // (diagnostic_label is optional and not declared unique by the S2 schema).
    function resolveModeIdentifier (payload: Record<string, unknown>): ModeIdResolution {
      const idField = payload.confirmedOperationModeId
      const indexField = payload.confirmedOperationModeIndex
      const labelField = payload.confirmedOperationModeLabel
      const providedCount = [idField, indexField, labelField].filter(v => v !== undefined).length

      if (providedCount !== 1) {
        return { error: 'Confirm message requires exactly one of confirmedOperationModeId, confirmedOperationModeIndex, or confirmedOperationModeLabel' }
      }

      const modes = (systemDescription.operationModes || []) as Array<Record<string, unknown>>

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

    function resolveMode (rawInstr: Record<string, unknown>): ResolvedOMBCMode | null {
      const modeId = (rawInstr.operation_mode_id || rawInstr.operation_mode) as string | undefined
      if (!modeId) return null
      const factor = typeof rawInstr.operation_mode_factor === 'number' ? rawInstr.operation_mode_factor : 1
      const modes = systemDescription.operationModes as Array<Record<string, unknown>> | undefined
      const modeIndex = modes?.findIndex(m => m.id === modeId) ?? -1
      const mode = modeIndex >= 0 ? modes![modeIndex] : undefined
      return {
        id: modeId,
        index: modeIndex,
        label: (mode?.diagnostic_label as string | undefined) || modeId,
        factor,
        powerRanges: (mode?.power_ranges as unknown[] | undefined) || []
      }
    }

    function handleInstruction (msg: NodeMessage): void {
      if (msg.controlType !== ControlType.OMBC) {
        node.status({ fill: 'yellow', shape: 'ring', text: `ignoring ${String(msg.controlType)} instruction` })
        node.send([msg, null])
        return
      }
      const rawInstr = (msg.ombc || msg.payload) as Record<string, unknown>
      const resolved = resolveMode(rawInstr)
      const outMsg: NodeMessage = { ...msg }
      if (resolved) {
        outMsg.topic = resolved.label
        outMsg.ombc = { ...(msg.ombc as object || {}), operationMode: resolved }
        node.status({ fill: 'green', shape: 'dot', text: resolved.label })
      }
      node.send([outMsg, null])
    }

    function handleSelectControlType (msg: NodeMessage): void {
      const cemId = msg.cemId
      if (!cemId) return
      const payload = msg.payload as Record<string, unknown>
      const controlType = payload.control_type as string
      getOrCreateState(cemId).selectedControlType = controlType
      if (controlType !== ControlType.OMBC) return

      node.send([null, { payload: { command: 'SystemDescription', cemId, controlType: ControlType.OMBC, ombc: systemDescription } }])

      let status = getPersistedStatus(cemId)
      if (!status) {
        const defaultStatus = getDefaultStatus()
        if (defaultStatus) {
          setPersistedStatus(cemId, defaultStatus)
          status = defaultStatus
        }
      }

      if (status) {
        node.send([null, { payload: { command: 'UpdateStatus', cemId, controlType: ControlType.OMBC, ombc: status } }])
      } else {
        node.send([{ topic: 'StatusRequest', cemId }, null])
      }
    }

    function handleConfirm (msg: NodeMessage, done: DoneFunction): void {
      const payload = msg.payload as Record<string, unknown>

      const resolution = resolveModeIdentifier(payload)
      if ('error' in resolution) {
        done(new Error(resolution.error))
        return
      }
      const modeId = resolution.id

      let cemId = msg.cemId as string | undefined
      if (!cemId) {
        const ombcCemIds = Array.from(cemStates.entries())
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

      const factor = payload.operationModeFactor
      const operationModeFactor = typeof factor === 'number' ? factor : 1

      if (!cemId) {
        // No CEM currently has OMBC selected (pre-connection, or after a disconnect) - store as
        // the default status for whichever CEM next selects OMBC, per "Pre-connection default
        // status" in the spec.
        setDefaultStatus({ activeOperationModeId: modeId, operationModeFactor })
        node.status({ fill: 'blue', shape: 'dot', text: `default: ${modeId}` })
        done()
        return
      }

      const state = getOrCreateState(cemId)
      if (state.selectedControlType !== ControlType.OMBC) {
        node.status({ fill: 'yellow', shape: 'ring', text: 'OMBC not selected - confirm ignored' })
        done()
        return
      }

      const previous = getPersistedStatus(cemId)
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
      setPersistedStatus(cemId, status)
      node.status({ fill: 'green', shape: 'dot', text: `confirmed: ${modeId}` })
      node.send([null, { payload: { command: 'UpdateStatus', cemId, controlType: ControlType.OMBC, ombc: status } }])
      done()
    }

    node.status({ fill: 'grey', shape: 'ring', text: 'idle' })

    node.on('input', (msg, _send, done) => {
      const cemId = msg.cemId
      const topic = msg.topic

      if (topic === 'Disconnected' && cemId) {
        const state = cemStates.get(cemId)
        if (state) state.selectedControlType = null
        done()
        return
      }

      const payload = msg.payload as Record<string, unknown> | undefined
      if (!payload || typeof payload !== 'object') {
        done()
        return
      }

      if ('confirmedOperationModeId' in payload || 'confirmedOperationModeIndex' in payload || 'confirmedOperationModeLabel' in payload) {
        handleConfirm(msg, done)
        return
      }

      if ('controlType' in msg) {
        handleInstruction(msg)
        done()
        return
      }

      if (payload.message_type === MessageType.SELECT_CONTROL_TYPE) {
        handleSelectControlType(msg)
        done()
        return
      }

      done()
    })
  }

  RED.nodes.registerType('s2-ombc', S2OmbcNode)
}
