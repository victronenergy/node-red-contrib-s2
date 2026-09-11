import { NodeRedApp, NodeConfig, NodeRedNode, NodeMessage } from '../../types/node-red'
import { S2CemConfigNode, S2DbusConfigNode } from '../../types/config-nodes'
import { S2ResourceManager } from '../../lib/s2/resource-manager'
import { OMBCController } from '../../lib/s2/ombc-controller'
import { S2WebSocketTransport } from '../../lib/transport/websocket'
import { S2DbusTransport } from '../../lib/transport/dbus'
import { PowerMeasurementCache } from '../../lib/s2/power-measurement-cache'
import { RmDetails, generateId, OMBCSystemDescriptionConfig } from '../../lib/s2/messages'
import { publishToDebugSidebar, parseForDebugSidebar } from '../../lib/node-red-debug-sidebar'

const KNOWN_DBUS_DEVICE_TYPES = ['acload', 'heatpump']

type Transport = 'websocket' | 'dbus' | 'external'
type ControlTypeSetting = 'ombc' | 'none'

interface S2ResourceConfig extends NodeConfig {
  rmName: string
  resourceId: string
  roles: string
  controlTypes: string
  providesPowerMeasurement: string
  providesForecast: boolean
  manufacturer: string
  model: string
  serialNumber: string
  firmwareVersion: string
  instructionPollIntervalMs: number
  skipInstructionStatus: boolean

  transport: Transport
  cem?: string
  reconnectInterval?: number
  dbusConfig?: string
  debug?: boolean

  controlType: ControlTypeSetting
  systemDescription?: string
  defaultOperationModeId?: string
  autoConfirmInstructions?: boolean
}

/**
 * s2-resource node - composite S2 Resource Manager
 *
 * Combines s2-rm's session state machine, a built-in transport (WebSocket,
 * D-Bus, or none for external wiring), and a built-in control type (OMBC, or
 * none for external wiring) behind one tabbed edit dialog. See
 * openspec/changes/2026-09-07-s2-resource-composite-node.
 *
 * The D-Bus transport reproduces s2-dbus's core session contract
 * (Connect/Message/Disconnect, S2/0/Active) via the same S2DbusTransport
 * class, plus its power-measurement relay via the same PowerMeasurementCache
 * class - see src/lib/transport/dbus.ts and src/lib/s2/power-measurement-cache.ts.
 *
 * Port layout (input is always present; outputs depend on Transport/Control type):
 *   Input (always 1): commands from an external transport and/or external
 *     control-type node, in the exact shapes s2-rm's single input accepts
 *     today, PLUS ModeConfirmation messages for a built-in OMBC control type
 *     (matching s2-ombc's input contract), PLUS - when Transport: D-Bus - a
 *     power-measurement value update at any time (e.g. `{ payload: { 'Ac/Power': 1500 } }`,
 *     matching s2-dbus's own input contract). Messages with a `command` field always go
 *     to the RM; a recognized measurement-value update is cached (and relayed if active);
 *     everything else goes to the built-in OMBC controller, if any.
 *   Output "to transport" (present only when Transport: External): identical
 *     to s2-rm's port 1.
 *   Output "downstream" (always present, last output): raw "from CEM"
 *     messages (identical to s2-rm's port 2) when Control type: None, or
 *     resolved OMBC instructions (identical to s2-ombc's port 1) when
 *     Control type: OMBC.
 *
 * With Transport: External and Control type: None, this is an exact drop-in
 * replacement for s2-rm (1 input, 2 outputs, identical message shapes).
 */
export = function (RED: NodeRedApp): void {
  function S2ResourceNode (this: NodeRedNode, config: S2ResourceConfig): void {
    RED.nodes.createNode(this, config)
    const node = this

    function parsePowerMeasurementTypes (value: unknown): string[] {
      if (value === true || value === '3_PHASE_SYMMETRIC') return ['ELECTRIC.POWER.3_PHASE_SYMMETRIC']
      if (value === 'L1_L2_L3') return ['ELECTRIC.POWER.L1', 'ELECTRIC.POWER.L2', 'ELECTRIC.POWER.L3']
      return []
    }

    const transportMode: Transport = config.transport || 'dbus'
    const isWebSocketTransport = transportMode === 'websocket'
    const isDbusTransport = transportMode === 'dbus'
    const isOmbcBuiltIn = config.controlType !== 'none'

    // Resolved early (rather than inside the Transport: D-Bus setup block below) because its
    // measurementType is also the RM's advertised power-measurement capability when Transport:
    // D-Bus is active - single source of truth, so the RM tab's own Power Meas. field (which
    // only matters for WebSocket/External) can't drift out of sync with what's actually
    // declared/relayed on D-Bus. See design.md.
    const dbusConfig = isDbusTransport ? (RED.nodes.getNode(config.dbusConfig || '') as S2DbusConfigNode | null) : null

    const rmDetails: RmDetails = {
      resourceId: config.resourceId || generateId(),
      name: config.rmName || 'RM: Virtual',
      roles: (config.roles || 'ENERGY_CONSUMER')
        .split(',').map((s: string) => s.trim()).filter(Boolean)
        .map((role: string) => ({ role, commodity: 'ELECTRICITY' })),
      availableControlTypes: (config.controlTypes || 'OPERATION_MODE_BASED_CONTROL')
        .split(',').map((s: string) => s.trim()).filter(Boolean),
      providesForecast: config.providesForecast === true,
      providesPowerMeasurementTypes: isDbusTransport
        ? parsePowerMeasurementTypes(dbusConfig?.measurementType)
        : parsePowerMeasurementTypes(config.providesPowerMeasurement),
      instructionProcessingDelay: 0,
      manufacturer: config.manufacturer || 'Custom (Node-RED)',
      model: config.model || '',
      serialNumber: config.serialNumber || node.id,
      firmwareVersion: config.firmwareVersion || ''
    }

    // Output layout: "to transport" (only when Transport: External) followed by
    // "downstream" (always present - see class doc comment above).
    const hasTransportOutput = transportMode === 'external'
    const downstreamIdx = hasTransportOutput ? 1 : 0
    const outputCount = hasTransportOutput ? 2 : 1

    function sendDownstream (msg: NodeMessage): void {
      const arr: (NodeMessage | null)[] = new Array(outputCount).fill(null)
      arr[downstreamIdx] = msg
      node.send(arr)
    }

    function sendToTransportPort (msg: NodeMessage): void {
      if (!hasTransportOutput) return
      const arr: (NodeMessage | null)[] = new Array(outputCount).fill(null)
      arr[0] = msg
      node.send(arr)
    }

    // Fixed cemId used in commands emitted toward the RM for either built-in transport
    // (only one CEM per node, matching s2-websocket's and s2-dbus's own convention).
    const TRANSPORT_CEM_ID = 'cem'

    // -- built-in WebSocket transport (Transport: WebSocket) --

    let wsTransport: S2WebSocketTransport | undefined

    function routeToWebSocketTransport (msg: NodeMessage): void {
      if (!wsTransport) return
      const payload = msg.payload as { s2Signal?: string, message?: object } | undefined
      if (!payload) return
      switch (payload.s2Signal) {
        case 'Message': {
          if (!payload.message) return
          const raw = JSON.stringify(payload.message)
          if (config.debug) publishToDebugSidebar(RED, node, `-> to CEM ${msg.cemId || TRANSPORT_CEM_ID}`, payload.message)
          try {
            wsTransport.send(raw)
          } catch (err) {
            node.warn(`[s2-resource] send failed (not connected?): ${(err as Error).message}`)
          }
          break
        }
        case 'PowerMeasurementStart':
          if (config.debug) node.log('[s2-resource] PowerMeasurementStart acknowledged')
          break
        default:
          // Includes the transport-agnostic S2/0/Active signal - no WebSocket action,
          // matching s2-websocket's own default case (that signal is meaningful only
          // for a D-Bus-style transport with a BusItem to update).
          break
      }
    }

    // -- built-in D-Bus transport (Transport: D-Bus) --

    let dbusTransport: S2DbusTransport | undefined
    let measurementCache: PowerMeasurementCache | undefined
    // The RM's own session is always keyed by TRANSPORT_CEM_ID (this node supports one CEM at a
    // time) - this tracks the real D-Bus-supplied cemId separately, purely so outbound debug
    // sidebar entries can show which physical CEM a message is actually going to.
    let currentDbusCemId: string | undefined

    function routeToDbusTransport (msg: NodeMessage): void {
      if (!dbusTransport) return
      const payload = msg.payload as { s2Signal?: string, message?: object, [key: string]: unknown } | undefined
      if (!payload) return
      if (payload.s2Signal === 'Message') {
        if (!payload.message) return
        const raw = JSON.stringify(payload.message)
        if (config.debug) publishToDebugSidebar(RED, node, `-> to CEM ${currentDbusCemId || TRANSPORT_CEM_ID}`, payload.message)
        dbusTransport.send(raw)
        return
      }
      if (payload['S2/0/Active'] === 0 || payload['S2/0/Active'] === 1) {
        dbusTransport.setActive(payload['S2/0/Active'] as 0 | 1)
        return
      }
      if (payload.s2Signal === 'PowerMeasurementStart') {
        const values = measurementCache?.start()
        if (values) rm.handleInput({ payload: { command: 'PowerMeasurement', cemId: TRANSPORT_CEM_ID, values } }, () => {})
        return
      }
      if (payload.s2Signal === 'PowerMeasurementStop') {
        measurementCache?.stop()
      }
    }

    // -- built-in OMBC control type (Control type: OMBC) --

    let ombcController: OMBCController | undefined

    // Tracks whether the built-in transport is actually registered/connected (WebSocket) or
    // registered (D-Bus, which - unlike WebSocket - stays "ready" across individual CEM sessions
    // coming and going). S2ResourceManager's own "waiting for CEM" status is transport-agnostic
    // grey; for a built-in transport we know more, so its onStatus wrapper below upgrades that
    // specific status to green once the transport is actually up - otherwise every CEM disconnect
    // would reset a working, listening service back to the same grey "not yet even registered"
    // color the node starts in before anything has happened.
    let transportReady = false

    // -- resource manager (always present) --

    const rm = new S2ResourceManager({
      rmDetails,
      nodeId: node.id,
      pollIntervalMs: config.instructionPollIntervalMs || 2000,
      skipInstructionStatus: config.skipInstructionStatus === true,
      onSendToTransport: (msg) => {
        if (!msg) return
        if (wsTransport) {
          routeToWebSocketTransport(msg)
        } else if (dbusTransport) {
          routeToDbusTransport(msg)
        } else {
          sendToTransportPort(msg)
        }
      },
      onEmitToCem: (msg) => {
        if (!msg) return
        if (ombcController) {
          ombcController.handleInput(msg, () => {})
        } else {
          sendDownstream(msg)
        }
      },
      onStatus: (status) => {
        if (transportReady && status.fill === 'grey' && status.text === 'waiting for CEM') {
          node.status({ ...status, fill: 'green' })
        } else {
          node.status(status)
        }
      },
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

    if (isOmbcBuiltIn) {
      let systemDescription: OMBCSystemDescriptionConfig = { operationModes: [], transitions: [], timers: [] }
      if (config.systemDescription) {
        try {
          systemDescription = JSON.parse(config.systemDescription) as OMBCSystemDescriptionConfig
        } catch (e) {
          node.error('Invalid OMBC System Description JSON: ' + (e as Error).message)
        }
      }
      ombcController = new OMBCController({
        systemDescription,
        onEmitInstruction: (msg) => sendDownstream(msg),
        onSendCommand: (msg) => rm.handleInput(msg, () => {}),
        onStatus: (status) => node.status(status),
        getContextValue: (key) => node.context().get(key),
        setContextValue: (key, value) => node.context().set(key, value),
        // Defaults to on: without independent hardware-state feedback wired into this node's
        // input, a resource that never confirms its own instructions leaves the CEM waiting
        // indefinitely for an OMBC.Status that never comes - see design.md.
        autoConfirmInstructions: config.autoConfirmInstructions !== false
      })

      // Seeds the "Pre-connection default status" (see control-type-ombc spec) at deploy
      // time, so a CEM selecting OMBC gets an initial OMBC.Status without the flow author
      // having to wire a separate Inject/Confirm node for the common case of "always start
      // in this mode".
      if (config.defaultOperationModeId) {
        ombcController.handleInput({ payload: { confirmedOperationModeId: config.defaultOperationModeId } }, (err?: Error) => {
          if (err) node.error(`s2-resource: default mode: ${err.message}`)
        })
      }
    }

    if (isWebSocketTransport) {
      const cemConfig = RED.nodes.getNode(config.cem || '') as S2CemConfigNode | null
      if (!cemConfig) {
        node.status({ fill: 'red', shape: 'dot', text: 'CEM config missing' })
      } else {
        const resourceId = rmDetails.resourceId
        const url = cemConfig.url.includes('{resourceId}')
          ? cemConfig.url.replace('{resourceId}', resourceId)
          : (cemConfig.url.endsWith('/') ? cemConfig.url : cemConfig.url + '/') + resourceId

        const { username, password } = cemConfig.credentials || {}
        const headers: Record<string, string> | undefined = (username || password)
          ? { Authorization: 'Basic ' + Buffer.from(`${username || ''}:${password || ''}`).toString('base64') }
          : undefined

        const reconnectIntervalMs = (config.reconnectInterval || 5) * 1000
        wsTransport = new S2WebSocketTransport({ url, reconnectInterval: reconnectIntervalMs, headers })
        let hasConnected = false

        node.log(`[s2-resource] connecting to ${url} (auth: ${headers ? 'Basic' : 'none'}, resourceId: ${resourceId || '(empty)'})`)
        node.status({ fill: 'yellow', shape: 'ring', text: 'connecting...' })

        wsTransport.on('open', () => {
          hasConnected = true
          transportReady = true
          node.log(`[s2-resource] connected to ${url}`)
          if (config.debug) publishToDebugSidebar(RED, node, `<- from CEM ${TRANSPORT_CEM_ID} (Connect)`, { cemId: TRANSPORT_CEM_ID })
          rm.handleInput({ payload: { command: 'Connect', cemId: TRANSPORT_CEM_ID, keepAliveInterval: 0 } }, () => {})
        })

        wsTransport.on('activity', () => {
          // rm.updateStatus() already reflects "connected" via its own status calls
          // triggered by the handshake below - nothing additional needed here.
        })

        wsTransport.on('message', (raw: string) => {
          if (config.debug) publishToDebugSidebar(RED, node, `<- from CEM ${TRANSPORT_CEM_ID}`, parseForDebugSidebar(raw))
          rm.handleInput({ payload: { command: 'Message', cemId: TRANSPORT_CEM_ID, message: raw } }, () => {})
        })

        wsTransport.on('close', () => {
          transportReady = false
          rm.handleInput({ payload: { command: 'Disconnect', cemId: TRANSPORT_CEM_ID } }, () => {})
          const reconnectSec = (config.reconnectInterval || 5)
          if (hasConnected) {
            if (config.debug) publishToDebugSidebar(RED, node, `<- from CEM ${TRANSPORT_CEM_ID} (Disconnect)`, { cemId: TRANSPORT_CEM_ID })
            node.log(`[s2-resource] disconnected - reconnecting in ${reconnectSec}s`)
          } else {
            node.status({ fill: 'red', shape: 'ring', text: 'disconnected' })
          }
        })

        wsTransport.on('error', (err: Error) => {
          node.error(`[s2-resource] WebSocket error: ${err.message} (url: ${url})`)
        })

        wsTransport.connect()
      }
    }

    if (isDbusTransport) {
      if (!dbusConfig) {
        node.status({ fill: 'red', shape: 'dot', text: 'D-Bus config missing' })
      } else if (!KNOWN_DBUS_DEVICE_TYPES.includes(dbusConfig.deviceType)) {
        node.error(`s2-resource: unrecognized deviceType "${dbusConfig.deviceType}" - expected one of ${KNOWN_DBUS_DEVICE_TYPES.join(', ')}`)
        node.status({ fill: 'red', shape: 'dot', text: `invalid deviceType: ${dbusConfig.deviceType}` })
      } else {
        measurementCache = new PowerMeasurementCache(dbusConfig.measurementType)
        dbusTransport = new S2DbusTransport({
          connectionMode: dbusConfig.connectionMode,
          tcpAddress: dbusConfig.tcpAddress,
          deviceType: dbusConfig.deviceType,
          nodeId: node.id,
          measurementType: dbusConfig.measurementType,
          nrOfPhases: dbusConfig.nrOfPhases,
          position: dbusConfig.position,
          phaseSetting: dbusConfig.phaseSetting
        })

        node.status({ fill: 'yellow', shape: 'ring', text: 'registering...' })

        dbusTransport.on('open', () => {
          transportReady = true
          node.status({ fill: 'green', shape: 'ring', text: 'waiting for CEM' })
        })

        dbusTransport.on('connect', (dbusCemId: string, keepAliveInterval: number) => {
          currentDbusCemId = dbusCemId
          node.log(`[s2-resource] CEM ${dbusCemId} connected (keepAliveInterval: ${keepAliveInterval}s)`)
          if (config.debug) publishToDebugSidebar(RED, node, `<- from CEM ${dbusCemId} (Connect)`, { cemId: dbusCemId, keepAliveInterval })
          node.status({ fill: 'green', shape: 'dot', text: 'CEM connected' })
          rm.handleInput({ payload: { command: 'Connect', cemId: TRANSPORT_CEM_ID, keepAliveInterval } }, () => {})
        })

        dbusTransport.on('disconnect', (dbusCemId: string) => {
          node.log(`[s2-resource] CEM ${dbusCemId} disconnected`)
          if (config.debug) publishToDebugSidebar(RED, node, `<- from CEM ${dbusCemId} (Disconnect)`, { cemId: dbusCemId })
          currentDbusCemId = undefined
          measurementCache?.stop()
          node.status({ fill: 'green', shape: 'ring', text: 'waiting for CEM' })
          rm.handleInput({ payload: { command: 'Disconnect', cemId: TRANSPORT_CEM_ID } }, () => {})
        })

        dbusTransport.on('message', (dbusCemId: string, raw: string) => {
          if (config.debug) publishToDebugSidebar(RED, node, `<- from CEM ${dbusCemId}`, parseForDebugSidebar(raw))
          rm.handleInput({ payload: { command: 'Message', cemId: TRANSPORT_CEM_ID, message: raw } }, () => {})
        })

        dbusTransport.on('error', (err: Error) => {
          node.error(`[s2-resource] D-Bus error: ${err.message}`)
        })

        dbusTransport.connect()
      }
    }

    node.on('input', (msg, _send, done) => {
      const payloadObj = (msg.payload && typeof msg.payload === 'object') ? msg.payload as Record<string, unknown> : undefined
      const hasCommand = !!(payloadObj && payloadObj.command)

      if (!hasCommand && measurementCache && payloadObj) {
        const update = measurementCache.update(payloadObj)
        if (update) {
          dbusTransport?.setMeasurementValues(update.raw)
          if (update.s2Values) rm.handleInput({ payload: { command: 'PowerMeasurement', cemId: TRANSPORT_CEM_ID, values: update.s2Values } }, () => {})
          done()
          return
        }
      }

      if (hasCommand || !ombcController) {
        rm.handleInput(msg, done)
      } else {
        ombcController.handleInput(msg, done)
      }
    })

    node.on('close', (done) => {
      rm.close()
      if (wsTransport) wsTransport.disconnect()
      if (dbusTransport) dbusTransport.disconnect()
      node.status({})
      done()
    })
  }

  RED.nodes.registerType('s2-resource', S2ResourceNode)
}
