import { NodeRedApp, NodeConfig, NodeRedNode } from '../../types/node-red'
import { S2FrbcConfigNode } from '../../types/config-nodes'
import { FRBCConfig, FRBCController, parseFRBCConfig, validateFRBCConfig } from '../../lib/s2/frbc-controller'

interface S2FrbcNodeConfig extends NodeConfig {
  frbcConfig: string
}

/**
 * s2-frbc node
 *
 * Owns FRBC-specific S2 protocol behaviour: pushes the FRBC system description (and leakage
 * behaviour) when a CEM selects FILL_RATE_BASED_CONTROL, replays the known device state, resolves
 * FRBC instructions into actionable output, and reports fill level, actuator state, timers and
 * forecasts back to the CEM.
 *
 * This is a thin Node-RED wrapper around FRBCController (src/lib/s2/frbc-controller.ts).
 *
 * Wiring:
 *   [s2-rm output 2 (from CEM)] -> [s2-frbc input]
 *   [your flow]                 -> [s2-frbc input]   (topics below)
 *   [s2-frbc output 1] -> downstream flow (ActuatorInstruction, Selected, Deselected)
 *   [s2-frbc output 2] -> [s2-rm input]  (SystemDescription / UpdateStatus / InstructionStatus commands)
 *
 * Input from the flow ({ topic, payload, cemId? }):
 *   StorageStatus          { fillLevel }
 *   ActuatorConfirmation   { actuator, operationMode, factor? }   (an ActuatorInstruction payload works as-is)
 *   UsageForecast          { startTime?, elements } | { revoke: true }
 *   FillLevelTargetProfile { startTime?, elements } | { revoke: true }
 *   TimerStatus            { actuator, timerId, finishedAt }
 *
 * Output port 1:
 *   { topic: 'ActuatorInstruction', payload: { instructionId, actuatorId, actuatorLabel, actuatorIndex,
 *     operationModeId, operationModeLabel, operationModeIndex, factor, abnormalCondition, fillRate,
 *     commodityPower, values? }, cemId, rawS2Message }
 *   { topic: 'Revoked', payload: { instructionId, actuatorId, operationModeId, factor }, cemId }
 *     (the CEM revoked an instruction this node already emitted; reported to the CEM as REVOKED)
 *   { topic: 'Selected' | 'Deselected', payload: { ... }, cemId }
 *
 * Every instruction this node emits ends in a final InstructionStatus: SUCCEEDED on a matching
 * ActuatorConfirmation, ABORTED when overtaken (see FRBCController), REVOKED on a revoke.
 *
 * Output port 2 - commands to s2-rm:
 *   { payload: { command: 'SystemDescription', cemId, controlType, frbc } }
 *   { payload: { command: 'UpdateStatus', cemId, controlType, frbc } }
 *   { payload: { command: 'InstructionStatus', cemId, instructionId, status } }
 *   { payload: { command: 'ReplaySelection', controlType } }   (once, right after the node starts)
 */
export = function (RED: NodeRedApp): void {
  function S2FrbcNode (this: NodeRedNode, config: S2FrbcNodeConfig): void {
    RED.nodes.createNode(this, config)
    const node = this

    const frbcConfigNode = RED.nodes.getNode(config.frbcConfig) as S2FrbcConfigNode | null
    if (!frbcConfigNode) {
      node.error('s2-frbc-config node is missing - please configure an FRBC System Description')
      node.status({ fill: 'red', shape: 'dot', text: 'config missing' })
      return
    }

    let frbcConfig: FRBCConfig
    try {
      frbcConfig = parseFRBCConfig(frbcConfigNode.systemDescription, frbcConfigNode.leakageBehaviour)
    } catch (err) {
      node.error(`Invalid FRBC configuration: ${(err as Error).message}`)
      node.status({ fill: 'red', shape: 'dot', text: 'invalid config' })
      return
    }
    const problems = validateFRBCConfig(frbcConfig)
    if (problems.length > 0) {
      node.error(`Invalid FRBC configuration: ${problems.join('; ')}`)
      node.status({ fill: 'red', shape: 'dot', text: 'invalid config' })
      return
    }

    const controller = new FRBCController({
      config: frbcConfig,
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

    // After a modified-nodes deploy s2-rm keeps its sessions while this node starts from scratch,
    // so ask it which CEMs still have FRBC selected (deferred until the deploy has started every
    // node). After a full deploy or a restart s2-rm has no sessions yet and replays nothing.
    const replayTimer = setTimeout(() => controller.requestSelectionReplay(), 0)

    node.on('close', (done) => {
      clearTimeout(replayTimer)
      done()
    })
  }

  RED.nodes.registerType('s2-frbc', S2FrbcNode)
}
