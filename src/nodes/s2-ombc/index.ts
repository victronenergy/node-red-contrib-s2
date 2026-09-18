import { NodeRedApp, NodeConfig, NodeRedNode } from '../../types/node-red'
import { S2OmbcConfigNode } from '../../types/config-nodes'
import { OMBCController } from '../../lib/s2/ombc-controller'
import { OMBCSystemDescriptionConfig } from '../../lib/s2/messages'

interface S2OmbcNodeConfig extends NodeConfig {
  ombcConfig: string
}

/**
 * s2-ombc node
 *
 * Owns OMBC-specific S2 protocol behavior: declares the OMBC system description,
 * resolves OMBC instructions into actionable output, and confirms operation mode
 * changes back to the CEM once told the hardware state is confirmed.
 *
 * This is a thin Node-RED wrapper around OMBCController
 * (src/lib/s2/ombc-controller.ts), which owns the actual protocol
 * behavior and is also constructed directly by the s2-resource node's
 * built-in OMBC control type.
 *
 * Wiring:
 *   [s2-rm output 2 (from CEM)]    -> [s2-ombc input]  (all CEM messages incl. instructions)
 *   [confirm-mode message]          -> [s2-ombc input]  (see Input below)
 *   [s2-ombc output 1]  -> downstream flow (resolved OMBC instructions)
 *   [s2-ombc output 2]  -> [s2-rm input]  (SystemDescription / UpdateStatus commands)
 *
 * Input:
 *   S2 "from CEM" messages, including instructions, forwarded from s2-rm as-is.
 *   ModeConfirmation (from your own flow, once hardware state is confirmed):
 *     { topic: 'ModeConfirmation', payload: { <mode ref>, factor? }, cemId?: <string> }
 *   where <mode ref> is any of, resolved in this priority order when more than one is given:
 *     id: <string>       - exact operation mode id (wins over index/label)
 *     index: <number>    - 0-based index into the configured operation modes (wins over label)
 *     label: <string>    - matches a mode's diagnostic_label (must be unique)
 *   at least one of id/index/label is required; any other field is ignored - so a
 *   previously-emitted ModeInstruction payload (below) can be wired straight back in as-is.
 *   factor is optional and defaults to 1.
 *   cemId is optional: if omitted, it resolves to the one CEM currently with OMBC selected (an
 *   error if more than one), or - if none - the confirm is stored as a default status applied to
 *   whichever CEM next selects OMBC with no persisted status of its own.
 *   Legacy format (confirmedOperationModeId/Index/Label/operationModeFactor) is still accepted.
 *
 * Output port 1 - instructions:
 *   ModeInstruction: { topic: 'ModeInstruction', payload: { id, index, label, factor, commodityPower, values }, cemId, rawS2Message }
 *     commodityPower: S2-shaped { commodity_quantity, value } pairs derived from the mode's
 *     power_ranges and factor. Symmetric power uses ELECTRIC.POWER.3_PHASE_SYMMETRIC; per-phase
 *     power uses one ELECTRIC.POWER.L1/L2/L3 pair for each phase. The built-in D-Bus path on
 *     s2-resource further constrains this to its configured Power Meas./Phases shape.
 *     values: the same requested power in the convenience shape PowerMeasurement input accepts
 *     (a plain number for a 3-phase-symmetric mode, or an array whose length matches the
 *     configured per-phase count) - feed it straight into a PowerMeasurement input.
 *   Non-OMBC instructions: ignored silently.
 *   ModeRequest: { topic: 'ModeRequest', payload: null, cemId }
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

    const controller = new OMBCController({
      systemDescription,
      onEmitInstruction: (msg) => node.send([msg, null]),
      onSendCommand: (msg) => node.send([null, msg]),
      onStatus: (status) => node.status(status),
      onWarn: (message) => node.warn(message),
      getContextValue: (key) => node.context().get(key),
      setContextValue: (key, value) => node.context().set(key, value)
    })

    node.on('input', (msg, _send, done) => {
      controller.handleInput(msg, done)
    })
  }

  RED.nodes.registerType('s2-ombc', S2OmbcNode)
}
