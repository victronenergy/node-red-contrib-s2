import { NodeRedApp, NodeConfig, NodeRedNode } from '../../types/node-red'
import { S2Session, State } from '../../lib/s2/session'
import { generateId, makePowerMeasurement, MessageType, PowerMeasurementValue } from '../../lib/s2/messages'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface S2RmConfig extends NodeConfig {
  resourceId?: string
  rmName?: string
  controlTypes?: string
  controlTypeConfig?: string
  manufacturer?: string
  model?: string
  firmwareVersion?: string
}

/**
 * s2-rm node (S2 Resource Manager)
 *
 * Manages S2 protocol sessions for all connected CEMs. Sits between
 * the transport node (victron-virtual acload, s2-websocket, etc.) and the
 * rest of the flow.
 *
 * Wiring:
 *   [acload port 2] -> [s2-rm input]
 *   [s2-rm port 1]  -> [acload input]
 *
 * Input msg.payload from acload port 2:
 *   { command: 'Connect',    cemId, keepAliveInterval }
 *   { command: 'Message',    cemId, message }   <- message is a raw S2 JSON string
 *   { command: 'KeepAlive',  cemId }
 *   { command: 'Disconnect', cemId }
 *
 * Output port 1 - messages to send to the CEM (via acload input):
 *   { payload: { s2Signal: 'Message', message: <S2 message object> } }
 *
 * Output port 2 - S2 messages received from CEM, forwarded for downstream processing:
 *   { payload: <S2 message object>, cemId: <string> }
 */
export = function (RED: NodeRedApp): void {
  function S2RmNode (this: NodeRedNode, config: S2RmConfig): void {
    RED.nodes.createNode(this, config)
    const node = this

    const rmDetails = {
      resourceId: (config.resourceId && UUID_RE.test(config.resourceId)) ? config.resourceId : generateId(),
      name: config.rmName || 'RM: Virtual AC Load',
      roles: [{ role: 'ENERGY_CONSUMER', commodity: 'ELECTRICITY' }],
      availableControlTypes: (config.controlTypes || 'OPERATION_MODE_BASED_CONTROL').split(',').map((s: string) => s.trim()).filter(Boolean),
      providesForecast: false,
      // S2 spec requires at least one entry in provides_power_measurement_types
      providesPowerMeasurementTypes: ['ELECTRIC.POWER.3_PHASE_SYMMETRIC'],
      instructionProcessingDelay: 0,
      manufacturer: config.manufacturer || 'Victron Energy',
      model: config.model || 'Virtual AC Load',
      serialNumber: node.id,
      firmwareVersion: config.firmwareVersion || '1.0.0'
    }

    let controlTypeConfig = {}
    if (config.controlTypeConfig) {
      try {
        controlTypeConfig = JSON.parse(config.controlTypeConfig) as Record<string, unknown>
      } catch (e) {
        node.error('Invalid Control Type Config JSON: ' + (e as Error).message)
      }
    }

    // One session per connected CEM
    const sessions = new Map<string, S2Session>()

    node.status({ fill: 'grey', shape: 'ring', text: 'no CEMs connected' })

    function updateStatus (): void {
      const count = sessions.size
      if (count === 0) {
        node.status({ fill: 'grey', shape: 'ring', text: 'no CEMs connected' })
      } else {
        node.status({ fill: 'green', shape: 'dot', text: `${count} CEM${count > 1 ? 's' : ''} connected` })
      }
    }

    function createSession (cemId: string): S2Session {
      const session = new S2Session({
        cemId,
        rmDetails,
        controlTypeConfig,

        onSend: (msg) => {
          node.send([{ payload: { s2Signal: 'Message', message: msg }, cemId }, null, null])
        },

        onStateChange: (state) => {
          if (state === State.CONNECTED) {
            node.log(`CEM ${cemId} handshake complete`)
          }
          updateStatus()
        },

        onMessage: (msg) => {
          node.send([null, { payload: msg, cemId }, null])
          // When any control type is selected, ask transport to start providing power measurements
          if (msg.message_type === MessageType.SELECT_CONTROL_TYPE &&
              rmDetails.providesPowerMeasurementTypes.length > 0) {
            node.send([{
              payload: {
                s2Signal: 'PowerMeasurementStart',
                commodityQuantities: rmDetails.providesPowerMeasurementTypes
              },
              cemId
            }, null, null])
          }
        },

        onInstruction: (msg) => {
          node.send([null, null, { payload: msg, cemId }])
        },

        onError: (err) => {
          node.error(`S2 session error for CEM ${cemId}: ${err.message}`)
        }
      })
      sessions.set(cemId, session)
      return session
    }

    node.on('input', (msg, send, done) => {
      if (!msg.payload || typeof msg.payload !== 'object') {
        done(new Error('msg.payload must be an object'))
        return
      }

      const { command, cemId, message, keepAliveInterval } = msg.payload as {
        command?: string
        cemId?: string
        message?: unknown
        keepAliveInterval?: number
      }

      if (!command) {
        done(new Error("msg.payload must have a 'command' field"))
        return
      }

      if (!cemId) {
        done(new Error("msg.payload must have a 'cemId' field"))
        return
      }

      switch (command) {
        case 'Connect': {
          if (sessions.has(cemId)) {
            node.warn(`CEM ${cemId} connected again without prior Disconnect - replacing session`)
            sessions.delete(cemId)
          }
          const session = createSession(cemId)
          session.start()
          node.log(`CEM ${cemId} connected (keepAliveInterval: ${keepAliveInterval}s)`)
          updateStatus()
          done()
          break
        }

        case 'Message': {
          const session = sessions.get(cemId)
          if (!session) {
            done(new Error(`No session for CEM ${cemId} - missing Connect?`))
            return
          }
          if (message === undefined || message === null) {
            done(new Error(`message is missing for CEM ${cemId}`))
            return
          }
          session.handleMessage(message as string)
          done()
          break
        }

        case 'KeepAlive': {
          const kaSession = sessions.get(cemId)
          if (!kaSession) {
            node.warn(`KeepAlive for unknown CEM ${cemId}`)
          } else {
            kaSession.keepAlive()
          }
          done()
          break
        }

        case 'PowerMeasurement': {
          const pmSession = sessions.get(cemId)
          if (!pmSession) {
            node.warn(`PowerMeasurement for unknown CEM ${cemId} - ignoring`)
            done()
            return
          }
          const { values } = msg.payload as { values?: unknown[] }
          if (!Array.isArray(values) || values.length === 0) {
            done(new Error(`PowerMeasurement requires a non-empty values array for CEM ${cemId}`))
            return
          }
          pmSession.send(makePowerMeasurement(values as PowerMeasurementValue[]))
          done()
          break
        }

        case 'Disconnect': {
          sessions.delete(cemId)
          node.log(`CEM ${cemId} disconnected`)
          updateStatus()
          done()
          break
        }

        default:
          done(new Error(`Unknown command: ${command}`))
      }
    })

    node.on('close', (done) => {
      sessions.clear()
      node.status({})
      done()
    })
  }

  RED.nodes.registerType('s2-rm', S2RmNode)
}
