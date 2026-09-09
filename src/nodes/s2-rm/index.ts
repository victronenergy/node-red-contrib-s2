import { NodeRedApp, NodeConfig, NodeRedNode, NodeMessage } from '../../types/node-red'
import { S2RmConfigNode, S2CemConfigNode } from '../../types/config-nodes'
import { S2ResourceManager } from '../../lib/s2/resource-manager'
import { RmDetails, generateId } from '../../lib/s2/messages'

interface S2RmConfig extends NodeConfig {
  rmConfig: string
  cem?: string // optional reference to s2-cem-config for CEM REST API access
}

/**
 * s2-rm node (S2 Resource Manager)
 *
 * Generic S2 protocol state machine: handshake, control-type selection,
 * generic instruction ack/routing. Control-type-specific behavior (OMBC mode
 * resolution, PEBC schedule dispatch, etc.) lives in dedicated nodes
 * (s2-ombc, s2-pebc, ...) wired downstream/alongside this node.
 *
 * This is a thin Node-RED wrapper around S2ResourceManager
 * (src/lib/s2/resource-manager.ts), which owns the actual protocol
 * behavior and is also constructed directly by the s2-resource node.
 *
 * Wiring:
 *   [transport port 2] -> [s2-rm input]
 *   [s2-rm port 1]     -> [transport input]
 *   [s2-rm port 2]     -> [control-type node input]  (all CEM messages incl. instructions)
 *   [control-type node command output] -> [s2-rm input]  (UpdateStatus/SystemDescription/PowerConstraints/InstructionStatus)
 *
 * Input msg.payload from transport or a control-type node:
 *   { command: 'Connect',           cemId, keepAliveInterval }
 *   { command: 'Message',           cemId, message }   <- message is a raw S2 JSON string
 *   { command: 'KeepAlive',         cemId }
 *   { command: 'PowerMeasurement',  cemId, values }
 *   { command: 'PowerConstraints',  constraints }
 *   { command: 'Forecast',          cemId, forecast }
 *   { command: 'Disconnect',        cemId }
 *   { command: 'InstructionStatus', cemId, instructionId, status }
 *   { command: 'UpdateStatus',         cemId, controlType, <namespaced status payload, e.g. ombc: {...}> }
 *   { command: 'SystemDescription',    cemId, controlType, <namespaced system description payload, e.g. ombc: {...}> }
 *
 * Output port 1 - messages to send to the CEM (via transport input):
 *   { payload: { s2Signal: 'Message', message: <S2 message object> }, cemId }
 *   { payload: { s2Signal: 'PowerMeasurementStart', commodityQuantities: [...] }, cemId }
 *   { payload: { 'S2/0/Active': 1 | 0 } }  <- on every SelectControlType, reflects whether the
 *                                             selected control type is other than NO_SELECTION/NOT_CONTROLABLE
 *
 * Output port 2 - all S2 messages from CEM (incl. instructions), forwarded for downstream processing:
 *   { payload: <S2 message object>, cemId: <string>, topic: <message_type string> }
 *   Also emits lifecycle events (route via Switch node on msg.topic):
 *   { topic: 'Connected',    cemId: <string> }
 *   { topic: 'Disconnected', cemId: <string>, reason: 'cem_initiated' | 'keepalive_timeout' }
 */
export = function (RED: NodeRedApp): void {
  function S2RmNode (this: NodeRedNode, config: S2RmConfig): void {
    RED.nodes.createNode(this, config)
    const node = this

    const rmConfigNode = RED.nodes.getNode(config.rmConfig) as S2RmConfigNode | null
    if (!rmConfigNode) {
      node.error('s2-rm-config node is missing - please configure a Resource Manager config')
      node.status({ fill: 'red', shape: 'dot', text: 'config missing' })
      return
    }

    // Map providesPowerMeasurement config to commodity quantity list
    // Supports legacy boolean (true -> 3_PHASE_SYMMETRIC) and new string values
    function parsePowerMeasurementTypes (value: unknown): string[] {
      if (value === true || value === '3_PHASE_SYMMETRIC') return ['ELECTRIC.POWER.3_PHASE_SYMMETRIC']
      if (value === 'L1_L2_L3') return ['ELECTRIC.POWER.L1', 'ELECTRIC.POWER.L2', 'ELECTRIC.POWER.L3']
      return []
    }

    const rmDetails: RmDetails = {
      resourceId: rmConfigNode.resourceId || generateId(),
      name: rmConfigNode.rmName || 'RM: Virtual',
      roles: (rmConfigNode.roles || 'ENERGY_CONSUMER')
        .split(',').map((s: string) => s.trim()).filter(Boolean)
        .map((role: string) => ({ role, commodity: 'ELECTRICITY' })),
      availableControlTypes: (rmConfigNode.controlTypes || 'OPERATION_MODE_BASED_CONTROL')
        .split(',').map((s: string) => s.trim()).filter(Boolean),
      providesForecast: rmConfigNode.providesForecast === true,
      providesPowerMeasurementTypes: parsePowerMeasurementTypes(rmConfigNode.providesPowerMeasurement),
      instructionProcessingDelay: 0,
      manufacturer: rmConfigNode.manufacturer || 'Victron Energy',
      model: rmConfigNode.model || 'Virtual RM',
      serialNumber: rmConfigNode.serialNumber || node.id,
      firmwareVersion: rmConfigNode.firmwareVersion || '1.0.0'
    }

    // Publish CEM REST API endpoint and auth header to flow context for use in downstream function nodes.
    // Derived from the optional s2-cem-config reference: strips the WebSocket path and converts
    // the protocol (wss->https, ws->http) to get the REST API base URL.
    if (config.cem) {
      const cemConfig = RED.nodes.getNode(config.cem) as S2CemConfigNode | null
      if (cemConfig && cemConfig.url) {
        const wsUrl = new URL(cemConfig.url)
        const restProtocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:'
        const apiPrefix = cemConfig.apiPrefix || ''
        const baseUrl = `${restProtocol}//${wsUrl.host}${apiPrefix}`
        node.context().flow.set('cemFlexInstructionUrl', `${baseUrl}/resource_managers/${rmDetails.resourceId}/flex_instructions`)
        const { username, password } = cemConfig.credentials || {}
        if (username) {
          const encoded = Buffer.from(`${username}:${password || ''}`).toString('base64')
          node.context().flow.set('cemApiAuth', `Basic ${encoded}`)
        }
      }
    }

    const rm = new S2ResourceManager({
      rmDetails,
      nodeId: node.id,
      pollIntervalMs: rmConfigNode.instructionPollIntervalMs || 2000,
      skipInstructionStatus: rmConfigNode.skipInstructionStatus === true,
      onSendToTransport: (msg) => node.send([msg, null]),
      onEmitToCem: (msg) => node.send([null, msg]),
      onStatus: (status) => node.status(status),
      onLog: (msg) => node.log(msg),
      onWarn: (msg) => node.warn(msg),
      onError: (msg) => node.error(msg),
      getContextValue: (key) => node.context().flow.get(key),
      setContextValue: (key, value) => node.context().flow.set(key, value),
      resolveContextTemplate: (template) => template.replace(/\{\{(global|flow)\.([^}]+)\}\}/g, (_match, scope, key) => {
        const val = node.context()[scope as 'global' | 'flow'].get(key)
        return val != null ? String(val) : ''
      })
    })

    node.on('input', (msg: NodeMessage, _send, done) => {
      rm.handleInput(msg, done)
    })

    node.on('close', (done) => {
      rm.close()
      node.status({})
      done()
    })
  }

  RED.nodes.registerType('s2-rm', S2RmNode)
}
