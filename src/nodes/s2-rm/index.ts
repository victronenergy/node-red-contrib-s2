import { NodeRedApp, NodeConfig, NodeRedNode } from '../../types/node-red'
import { S2RmConfigNode } from '../../types/config-nodes'
import { S2Session, State } from '../../lib/s2/session'
import { generateId, makePowerForecast, makePowerMeasurement, MessageType, ReceptionStatusResult, PEBCPowerConstraintsInput, PowerForecastInput, PowerMeasurementValue } from '../../lib/s2/messages'
import { parsePebcInstruction, getActiveElement, getNextElementStart, PebcSchedule } from '../../lib/s2/schedule'

interface S2RmConfig extends NodeConfig {
  rmConfig: string
  controlTypeConfig?: string
  providesPowerMeasurement?: string
  providesForecast?: boolean
}

/**
 * s2-rm node (S2 Resource Manager)
 *
 * Manages S2 protocol sessions for all connected CEMs. Sits between
 * the transport node (victron-virtual acload, s2-websocket, etc.) and the
 * rest of the flow.
 *
 * Wiring:
 *   [transport port 2] -> [s2-rm input]
 *   [s2-rm port 1]     -> [transport input]
 *
 * Input msg.payload from transport:
 *   { command: 'Connect',          cemId, keepAliveInterval }
 *   { command: 'Message',          cemId, message }   <- message is a raw S2 JSON string
 *   { command: 'KeepAlive',        cemId }
 *   { command: 'PowerMeasurement', cemId, values }
 *   { command: 'Disconnect',       cemId }
 *
 * Output port 1 - messages to send to the CEM (via transport input):
 *   { payload: { s2Signal: 'Message', message: <S2 message object> }, cemId }
 *   { payload: { s2Signal: 'PowerMeasurementStart', commodityQuantities: [...] }, cemId }
 *
 * Output port 2 - S2 messages received from CEM, forwarded for downstream processing:
 *   { payload: <S2 message object>, cemId: <string> }
 *
 * Output port 3 - S2 instructions from CEM:
 *   { payload: <S2 instruction object>, cemId: <string> }
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

    // Resolve {{global.xxx}} and {{flow.xxx}} context variable templates
    function resolveTemplate (template: string): string {
      return template.replace(/\{\{(global|flow)\.([^}]+)\}\}/g, (_match, scope, key) => {
        const val = node.context()[scope as 'global' | 'flow'].get(key)
        return val != null ? String(val) : ''
      })
    }

    const rmDetails = {
      resourceId: rmConfigNode.resourceId || generateId(),
      name: rmConfigNode.rmName || 'RM: Virtual',
      roles: (rmConfigNode.roles || 'ENERGY_CONSUMER')
        .split(',').map((s: string) => s.trim()).filter(Boolean)
        .map((role: string) => ({ role, commodity: 'ELECTRICITY' })),
      availableControlTypes: (rmConfigNode.controlTypes || 'OPERATION_MODE_BASED_CONTROL')
        .split(',').map((s: string) => s.trim()).filter(Boolean),
      providesForecast: config.providesForecast === true,
      providesPowerMeasurementTypes: parsePowerMeasurementTypes(config.providesPowerMeasurement),
      instructionProcessingDelay: 0,
      manufacturer: rmConfigNode.manufacturer || 'Victron Energy',
      model: rmConfigNode.model || 'Virtual RM',
      serialNumber: rmConfigNode.serialNumber || node.id,
      firmwareVersion: rmConfigNode.firmwareVersion || '1.0.0'
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
    // Stored at node level so they persist across reconnects and can be set before any CEM connects
    let pendingPEBCConstraints: PEBCPowerConstraintsInput | null = null

    // PEBC schedule dispatch
    let scheduleTimer: ReturnType<typeof setTimeout> | null = null
    const SCHEDULE_CONTEXT_KEY = 's2PebcSchedule'

    function emitActiveElement (schedule: PebcSchedule): void {
      const el = getActiveElement(schedule, Date.now())
      if (!el) return
      node.send([null, null, {
        cemId: schedule.cemId,
        payload: {
          startTime: new Date(el.startMs).toISOString(),
          endTime: new Date(el.endMs).toISOString(),
          duration: el.duration,
          lowerBound: el.lowerBound,
          upperBound: el.upperBound
        }
      }])
    }

    function scheduleNextDispatch (schedule: PebcSchedule): void {
      if (scheduleTimer) {
        clearTimeout(scheduleTimer)
        scheduleTimer = null
      }
      const nextStart = getNextElementStart(schedule, Date.now())
      if (nextStart === null) return
      const delay = Math.max(0, nextStart - Date.now())
      scheduleTimer = setTimeout(() => {
        scheduleTimer = null
        emitActiveElement(schedule)
        scheduleNextDispatch(schedule)
      }, delay)
    }

    function applySchedule (schedule: PebcSchedule): void {
      node.context().flow.set(SCHEDULE_CONTEXT_KEY, schedule)
      emitActiveElement(schedule)
      scheduleNextDispatch(schedule)
    }

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
      // Resolve context variable templates at connect time (not at init)
      const resolvedDetails = rmDetails.serialNumber.includes('{{')
        ? { ...rmDetails, serialNumber: resolveTemplate(rmDetails.serialNumber) || node.id }
        : rmDetails
      const session = new S2Session({
        cemId,
        rmDetails: resolvedDetails,
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
          if (msg.message_type === MessageType.RECEPTION_STATUS &&
              msg.status && msg.status !== ReceptionStatusResult.OK) {
            const diag = msg.diagnostic_label ? `: ${msg.diagnostic_label}` : ''
            node.warn(`CEM ${cemId} rejected message ${msg.subject_message_id || '?'} with ${msg.status}${diag}`)
            node.status({ fill: 'yellow', shape: 'dot', text: `${msg.status}` })
          }
          node.send([null, { payload: msg, cemId }, null])
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
          if (msg.message_type === MessageType.PEBC_INSTRUCTION) {
            const schedule = parsePebcInstruction(msg as Record<string, unknown>, Date.now(), cemId)
            if (schedule) {
              applySchedule(schedule)
              return
            }
          }
          node.send([null, null, { payload: msg, cemId }])
        },

        onError: (err) => {
          node.error(`S2 session error for CEM ${cemId}: ${err.message}`)
        }
      })
      sessions.set(cemId, session)
      if (pendingPEBCConstraints) {
        session.setPEBCPowerConstraints(pendingPEBCConstraints)
      }
      return session
    }

    node.on('input', (msg, _send, done) => {
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

        case 'PowerConstraints': {
          const { constraints } = msg.payload as { constraints?: PEBCPowerConstraintsInput }
          if (!constraints || typeof constraints !== 'object') {
            done(new Error('PowerConstraints requires a constraints object'))
            return
          }
          pendingPEBCConstraints = constraints
          // Apply to all currently connected sessions
          for (const session of sessions.values()) {
            session.setPEBCPowerConstraints(constraints)
          }
          done()
          break
        }

        case 'Forecast': {
          const { forecast } = msg.payload as { forecast?: PowerForecastInput }
          if (!forecast || !forecast.startTime || !Array.isArray(forecast.elements)) {
            done(new Error('Forecast requires a forecast object with startTime and elements'))
            return
          }
          const fcSession = sessions.get(cemId)
          if (!fcSession) {
            node.warn(`Forecast for unknown CEM ${cemId} - ignoring`)
            done()
            return
          }
          fcSession.send(makePowerForecast(forecast))
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
      if (scheduleTimer) {
        clearTimeout(scheduleTimer)
        scheduleTimer = null
      }
      sessions.clear()
      node.status({})
      done()
    })
  }

  RED.nodes.registerType('s2-rm', S2RmNode)
}
