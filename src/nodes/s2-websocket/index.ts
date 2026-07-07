import { NodeRedApp, NodeConfig, NodeRedNode } from '../../types/node-red'
import { S2CemConfigNode, S2RmConfigNode } from '../../types/config-nodes'
import { S2WebSocketTransport } from '../../lib/transport/websocket'

interface S2WebSocketConfig extends NodeConfig {
  cem: string      // reference to s2-cem-config node
  rmConfig: string // reference to s2-rm-config node
  reconnectInterval?: number
  debug?: boolean
}

/**
 * s2-websocket node - WebSocket transport for S2 protocol
 *
 * Acts as a drop-in transport replacement for the victron-virtual acload node.
 * The RM dials out to a CEM via WebSocket; the s2-rm node handles the S2 protocol.
 *
 * Wiring:
 *   [s2-rm port 1]     -> [s2-websocket input]   (s2Signal messages to send to CEM)
 *   [s2-websocket output] -> [s2-rm input]        (commands from CEM)
 *
 * Input (from s2-rm port 1):
 *   { payload: { s2Signal: 'Message', message: <S2 object> }, cemId }
 *   { payload: { s2Signal: 'PowerMeasurementStart', ... }, cemId }   (acknowledged, no WS action)
 *
 * Output (to s2-rm input):
 *   { payload: { command: 'Connect',    cemId: 'cem', keepAliveInterval: 0 } }
 *   { payload: { command: 'Message',    cemId: 'cem', message: '<raw JSON>' } }
 *   { payload: { command: 'Disconnect', cemId: 'cem' } }
 */
export = function (RED: NodeRedApp): void {
  function S2WebSocketNode (this: NodeRedNode, config: S2WebSocketConfig): void {
    RED.nodes.createNode(this, config)
    const node = this

    const cemConfig = RED.nodes.getNode(config.cem) as S2CemConfigNode | null
    if (!cemConfig) {
      node.status({ fill: 'red', shape: 'dot', text: 'CEM config missing' })
      return
    }

    const rmConfig = RED.nodes.getNode(config.rmConfig) as S2RmConfigNode | null
    if (!rmConfig) {
      node.status({ fill: 'red', shape: 'dot', text: 'RM config missing' })
      return
    }

    // Substitute {resourceId} in the URL template, or append the UUID if no placeholder is present
    const resourceId = rmConfig.resourceId || ''
    const url = cemConfig.url.includes('{resourceId}')
      ? cemConfig.url.replace('{resourceId}', resourceId)
      : (cemConfig.url.endsWith('/') ? cemConfig.url : cemConfig.url + '/') + resourceId

    // Build Basic auth header if credentials are configured
    const { username, password } = cemConfig.credentials || {}
    const headers: Record<string, string> | undefined = (username || password)
      ? { Authorization: 'Basic ' + Buffer.from(`${username || ''}:${password || ''}`).toString('base64') }
      : undefined

    const reconnectIntervalMs = (config.reconnectInterval || 5) * 1000
    const transport = new S2WebSocketTransport({ url, reconnectInterval: reconnectIntervalMs, headers })

    // cemId used in all commands emitted to s2-rm (fixed; only one CEM per node)
    const CEM_ID = 'cem'
    let hasConnected = false

    node.log(`[s2-websocket] connecting to ${url} (auth: ${headers ? 'Basic' : 'none'}, resourceId: ${resourceId || '(empty)'})`)
    node.status({ fill: 'yellow', shape: 'ring', text: 'connecting...' })

    transport.on('open', () => {
      hasConnected = true
      node.log(`[s2-websocket] connected to ${url}`)
      node.status({ fill: 'green', shape: 'ring', text: 'connected' })
      node.send({ payload: { command: 'Connect', cemId: CEM_ID, keepAliveInterval: 0 } })
    })

    transport.on('activity', (lastContact: Date) => {
      const timeStr = lastContact.toLocaleTimeString()
      node.status({ fill: 'green', shape: 'dot', text: `connected (${timeStr})` })
    })

    transport.on('message', (raw: string) => {
      if (config.debug) node.log(`[s2-websocket] <- ${raw}`)
      node.send({ payload: { command: 'Message', cemId: CEM_ID, message: raw } })
    })

    transport.on('close', () => {
      node.send({ payload: { command: 'Disconnect', cemId: CEM_ID } })
      const reconnectSec = (config.reconnectInterval || 5)
      if (hasConnected) {
        node.log(`[s2-websocket] disconnected - reconnecting in ${reconnectSec}s`)
        node.status({ fill: 'yellow', shape: 'ring', text: 'reconnecting...' })
      } else {
        node.status({ fill: 'red', shape: 'ring', text: 'disconnected' })
      }
    })

    transport.on('error', (err: Error) => {
      node.error(`[s2-websocket] WebSocket error: ${err.message} (url: ${url})`)
    })

    node.on('input', (msg, _send, done) => {
      // Lifecycle control via msg.connection
      if (msg.connection === 'Reconnect') {
        node.log('[s2-websocket] manual reconnect triggered')
        transport.disconnect()
        transport.connect()
        done()
        return
      } else if (msg.connection === 'Disconnect') {
        node.log('[s2-websocket] manual disconnect triggered')
        transport.disconnect()
        done()
        return
      } else if (msg.connection === 'Connect') {
        node.log('[s2-websocket] manual connect triggered')
        transport.connect()
        done()
        return
      }

      if (!msg.payload || typeof msg.payload !== 'object') {
        done()
        return
      }

      const { s2Signal, message } = msg.payload as { s2Signal?: string, message?: object }

      switch (s2Signal) {
        case 'Message': {
          if (!message) {
            done(new Error('s2Signal Message received without a message object'))
            return
          }
          const raw = JSON.stringify(message)
          if (config.debug) node.log(`[s2-websocket] -> ${raw}`)
          try {
            transport.send(raw)
          } catch (err) {
            node.warn(`[s2-websocket] send failed (not connected?): ${(err as Error).message}`)
          }
          done()
          break
        }

        case 'PowerMeasurementStart':
          // No WebSocket action - s2-rm will send measurements via Message signals
          if (config.debug) node.log('[s2-websocket] PowerMeasurementStart acknowledged')
          done()
          break

        default:
          // Unknown or missing signal - pass through silently
          done()
      }
    })

    transport.connect()

    node.on('close', (done) => {
      transport.disconnect()
      node.status({})
      done()
    })
  }

  RED.nodes.registerType('s2-websocket', S2WebSocketNode)
}
