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
 *     { payload: { confirmedOperationModeId: <id>, operationModeFactor?: <number> }, cemId: <string> }
 *
 * Output port 1 - instructions:
 *   OMBC instructions resolved: { payload, cemId, controlType, topic: <mode label>, ombc: { operationMode: {...}, ... } }
 *   Non-OMBC instructions: passed through unchanged (node status shows a warning).
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

      const persisted = getPersistedStatus(cemId)
      if (persisted) {
        node.send([null, { payload: { command: 'UpdateStatus', cemId, controlType: ControlType.OMBC, ombc: persisted } }])
      }
    }

    function handleConfirm (msg: NodeMessage, done: DoneFunction): void {
      const cemId = msg.cemId
      const payload = msg.payload as Record<string, unknown>
      const modeId = payload.confirmedOperationModeId as string | undefined
      if (!cemId || !modeId) {
        done(new Error('Confirm message requires cemId and payload.confirmedOperationModeId'))
        return
      }

      const state = getOrCreateState(cemId)
      if (state.selectedControlType !== ControlType.OMBC) {
        node.status({ fill: 'yellow', shape: 'ring', text: 'OMBC not selected - confirm ignored' })
        done()
        return
      }

      const factor = payload.operationModeFactor
      const previous = getPersistedStatus(cemId)
      let status: OMBCStatusConfig = {
        activeOperationModeId: modeId,
        operationModeFactor: typeof factor === 'number' ? factor : 1
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

      if ('confirmedOperationModeId' in payload) {
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
