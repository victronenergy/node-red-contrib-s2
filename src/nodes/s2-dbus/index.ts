import { NodeRedApp, NodeConfig, NodeRedNode } from '../../types/node-red'
import { S2DbusConfigNode } from '../../types/config-nodes'
import { S2DbusTransport } from '../../lib/transport/dbus'
import { PowerMeasurementCache } from '../../lib/s2/power-measurement-cache'
import { publishToDebugSidebar, parseForDebugSidebar } from '../../lib/node-red-debug-sidebar'

const KNOWN_DEVICE_TYPES = ['acload', 'heatpump']

interface S2DbusNodeConfig extends NodeConfig {
  dbusConfig: string
  debug?: boolean
}

/**
 * s2-dbus node - Venus OS D-Bus transport for S2
 *
 * Registers a com.victronenergy.<deviceType>.virtual_s2_<nodeId> D-Bus service (nodeId: this
 * node's own id, not the S2 resourceId - short and already unique, matching how
 * node-red-contrib-victron names its own virtual-device services) exposing /S2/0/Rm, via
 * dbus-victron-virtual's built-in S2 support (src/lib/transport/dbus.ts). Produces the exact
 * same message shapes s2-websocket does, so s2-rm requires no changes to use either transport
 * interchangeably.
 *
 * Wiring:
 *   [s2-rm port 1]      -> [s2-dbus input]   (s2Signal messages to send to CEM)
 *   [s2-dbus output]    -> [s2-rm input]     (commands from CEM)
 *
 * Input (from s2-rm port 1):
 *   { payload: { s2Signal: 'Message', message: <S2 object> }, cemId }
 *   { payload: { s2Signal: 'PowerMeasurementStart', ... }, cemId }
 *   { payload: { s2Signal: 'PowerMeasurementStop' }, cemId }
 *   { payload: { 'S2/0/Active': 1 | 0 } }
 *   Also accepts a power-measurement value update at any time, cached, exposed as a real D-Bus
 *   BusItem property, and (while active) relayed to the CEM - two independent, always-both-checked
 *   input shapes:
 *   { payload: { 'Ac/Power': 1500 } }  (or Ac/L1/Power, Ac/L2/Power, Ac/L3/Power, per configured measurementType)
 *   { payload: { values: 1500 } }  (or values: [1500, 200, 300] for per-phase/3-phase-symmetric -
 *   meaning depends on measurementType/nrOfPhases/phaseSetting, see power-measurement-cache.ts)
 *
 * Output (to s2-rm input):
 *   { payload: { command: 'Connect',           cemId: 'cem', keepAliveInterval } }
 *   { payload: { command: 'Message',           cemId: 'cem', message: '<raw JSON>' } }
 *   { payload: { command: 'Disconnect',         cemId: 'cem' } }
 *   { payload: { command: 'PowerMeasurement',   cemId: 'cem', values } }
 */
export = function (RED: NodeRedApp): void {
  function S2DbusNode (this: NodeRedNode, config: S2DbusNodeConfig): void {
    RED.nodes.createNode(this, config)
    const node = this

    const dbusConfig = RED.nodes.getNode(config.dbusConfig) as S2DbusConfigNode | null
    if (!dbusConfig) {
      node.status({ fill: 'red', shape: 'dot', text: 'D-Bus config missing' })
      return
    }

    if (!KNOWN_DEVICE_TYPES.includes(dbusConfig.deviceType)) {
      node.error(`s2-dbus: unrecognized deviceType "${dbusConfig.deviceType}" - expected one of ${KNOWN_DEVICE_TYPES.join(', ')}`)
      node.status({ fill: 'red', shape: 'dot', text: `invalid deviceType: ${dbusConfig.deviceType}` })
      return
    }

    const CEM_ID = 'cem'
    const measurementCache = new PowerMeasurementCache(dbusConfig.measurementType, dbusConfig.nrOfPhases, dbusConfig.phaseSetting)
    // The RM's own session is always keyed by the fixed CEM_ID above (this node supports one CEM
    // at a time) - this tracks the real D-Bus-supplied cemId separately, purely so outbound debug
    // sidebar entries can show which physical CEM a message is actually going to.
    let currentDbusCemId: string | undefined

    const transport = new S2DbusTransport({
      connectionMode: dbusConfig.connectionMode,
      tcpAddress: dbusConfig.tcpAddress,
      deviceType: dbusConfig.deviceType,
      nodeId: node.id,
      measurementType: dbusConfig.measurementType,
      nrOfPhases: dbusConfig.nrOfPhases,
      position: dbusConfig.position,
      phaseSetting: dbusConfig.phaseSetting,
      autoCalculateEnergy: dbusConfig.autoCalculateEnergy
    })

    node.status({ fill: 'yellow', shape: 'ring', text: 'registering...' })

    transport.on('open', () => {
      node.log(`[s2-dbus] service registered (deviceType: ${dbusConfig.deviceType}, nodeId: ${node.id})`)
      node.status({ fill: 'green', shape: 'ring', text: 'waiting for CEM' })
    })

    transport.on('connect', (dbusCemId: string, keepAliveInterval: number) => {
      currentDbusCemId = dbusCemId
      node.log(`[s2-dbus] CEM ${dbusCemId} connected (keepAliveInterval: ${keepAliveInterval}s)`)
      if (config.debug) publishToDebugSidebar(RED, node, `<- from CEM ${dbusCemId} (Connect)`, { cemId: dbusCemId, keepAliveInterval })
      node.status({ fill: 'green', shape: 'dot', text: 'CEM connected' })
      node.send({ payload: { command: 'Connect', cemId: CEM_ID, keepAliveInterval } })
    })

    transport.on('disconnect', (dbusCemId: string) => {
      node.log(`[s2-dbus] CEM ${dbusCemId} disconnected`)
      if (config.debug) publishToDebugSidebar(RED, node, `<- from CEM ${dbusCemId} (Disconnect)`, { cemId: dbusCemId })
      currentDbusCemId = undefined
      measurementCache.stop()
      node.status({ fill: 'green', shape: 'ring', text: 'waiting for CEM' })
      node.send({ payload: { command: 'Disconnect', cemId: CEM_ID } })
    })

    transport.on('message', (dbusCemId: string, raw: string) => {
      if (config.debug) publishToDebugSidebar(RED, node, `<- from CEM ${dbusCemId}`, parseForDebugSidebar(raw))
      node.send({ payload: { command: 'Message', cemId: CEM_ID, message: raw } })
    })

    transport.on('error', (err: Error) => {
      node.error(`[s2-dbus] ${err.message}`)
    })

    transport.connect()

    node.on('input', (msg, _send, done) => {
      if (!msg.payload || typeof msg.payload !== 'object') {
        done()
        return
      }
      const payload = msg.payload as { s2Signal?: string, message?: object, [key: string]: unknown }

      if (payload.s2Signal === 'Message') {
        if (!payload.message) {
          done(new Error('s2Signal Message received without a message object'))
          return
        }
        const raw = JSON.stringify(payload.message)
        if (config.debug) publishToDebugSidebar(RED, node, `-> to CEM ${currentDbusCemId || CEM_ID}`, payload.message)
        transport.send(raw)
        done()
        return
      }

      if (payload.s2Signal === 'PowerMeasurementStart') {
        const values = measurementCache.start()
        if (values) node.send({ payload: { command: 'PowerMeasurement', cemId: CEM_ID, values } })
        done()
        return
      }

      if (payload.s2Signal === 'PowerMeasurementStop') {
        measurementCache.stop()
        done()
        return
      }

      if (payload['S2/0/Active'] === 0 || payload['S2/0/Active'] === 1) {
        transport.setActive(payload['S2/0/Active'] as 0 | 1)
        done()
        return
      }

      const update = measurementCache.update(payload)
      if (update) {
        if (update.warning) node.warn(`[s2-dbus] ${update.warning}`)
        transport.setMeasurementValues(update.raw)
        if (update.s2Values) node.send({ payload: { command: 'PowerMeasurement', cemId: CEM_ID, values: update.s2Values } })
        done()
        return
      }

      done()
    })

    node.on('close', (done) => {
      transport.disconnect()
      node.status({})
      done()
    })
  }

  RED.nodes.registerType('s2-dbus', S2DbusNode)
}
