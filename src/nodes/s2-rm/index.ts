import { NodeRedApp, NodeConfig, NodeRedNode } from '../../types/node-red'
import { S2RmConfigNode, S2CemConfigNode } from '../../types/config-nodes'
import { S2Session, State, StatusPayload, SystemDescriptionPayload } from '../../lib/s2/session'
import { generateId, makePowerForecast, makePowerMeasurement, MessageType, ControlType, ReceptionStatusResult, InstructionStatus, InstructionStatusValue, PEBCPowerConstraintsInput, PowerForecastInput, PowerMeasurementValue } from '../../lib/s2/messages'

interface S2RmConfig extends NodeConfig {
  rmConfig: string
  cem?: string // optional reference to s2-cem-config for CEM REST API access
}

interface PendingInstruction {
  messageId: string
  instructionId: string | undefined
  instruction: Record<string, unknown>
  cemId: string
  executionTimeMs: number
}

const PENDING_INSTRUCTIONS_KEY = 's2PendingInstructions'
const PRUNE_GRACE_MS = 3_600_000 // 1 hour grace before an instruction is pruned

/**
 * s2-rm node (S2 Resource Manager)
 *
 * Generic S2 protocol state machine: handshake, control-type selection,
 * generic instruction ack/routing. Control-type-specific behavior (OMBC mode
 * resolution, PEBC schedule dispatch, etc.) lives in dedicated nodes
 * (s2-ombc, s2-pebc, ...) wired downstream/alongside this node.
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

    // One session per connected CEM
    const sessions = new Map<string, S2Session>()

    let pendingPEBCConstraints: PEBCPowerConstraintsInput | null = null

    let statusTimer: ReturnType<typeof setTimeout> | null = null

    function getPending (): PendingInstruction[] {
      return (node.context().flow.get(PENDING_INSTRUCTIONS_KEY) as PendingInstruction[] | undefined) || []
    }

    function setPending (pending: PendingInstruction[]): void {
      node.context().flow.set(PENDING_INSTRUCTIONS_KEY, pending)
    }

    function addToPending (item: PendingInstruction): void {
      const pending = getPending()
      const idx = pending.findIndex(p => p.messageId === item.messageId)
      if (idx >= 0) {
        pending[idx] = item
      } else {
        pending.push(item)
      }
      setPending(pending)
    }

    const pollIntervalMs = rmConfigNode.instructionPollIntervalMs || 2000
    const isSkipInstructionStatus = rmConfigNode.skipInstructionStatus === true

    // Poll at the configured interval: dispatch due non-PEBC instructions, prune expired entries.
    // PEBC instructions bypass this queue entirely (see onInstruction) - their timing is owned by s2-pebc.
    const pollTimer = setInterval(() => {
      const pending = getPending()
      if (pending.length === 0) return
      const now = Date.now()
      let changed = false
      const remaining: PendingInstruction[] = []
      for (const item of pending) {
        const expired = item.executionTimeMs + PRUNE_GRACE_MS < now
        if (expired) { changed = true; continue }
        if (item.executionTimeMs <= now) {
          const session = sessions.get(item.cemId)
          if (session && item.instructionId && !isSkipInstructionStatus) {
            session.sendInstructionStatus(item.instructionId, InstructionStatus.STARTED)
          }
          node.send([null, { payload: item.instruction, cemId: item.cemId, topic: item.instruction.message_type as string }, null])
          changed = true
          continue
        }
        remaining.push(item)
      }
      if (changed) setPending(remaining)
    }, pollIntervalMs).unref()

    node.status({ fill: 'grey', shape: 'ring', text: 'waiting for CEM' })

    // S2 is a 1:1 CEM<->RM relationship, so the common case (one session) gets a
    // singular status naming the connected CEM. Multiple concurrent sessions are
    // technically possible (the map is keyed by cemId), so that case still shows a count.
    function updateStatus (): void {
      const count = sessions.size
      if (count === 0) {
        node.status({ fill: 'grey', shape: 'ring', text: 'waiting for CEM' })
      } else if (count === 1) {
        const [cemId] = sessions.keys()
        node.status({ fill: 'green', shape: 'dot', text: `CEM connected (${cemId})` })
      } else {
        node.status({ fill: 'green', shape: 'dot', text: `${count} CEMs connected` })
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

        onSend: (msg) => {
          const m = msg as Record<string, unknown>
          if (m.message_type === MessageType.PEBC_POWER_CONSTRAINTS && typeof m.id === 'string') {
            node.context().flow.set('pebcConstraintsId', m.id)
          }
          node.send([{ payload: { s2Signal: 'Message', message: msg }, cemId }, null])
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
            if (statusTimer) clearTimeout(statusTimer)
            node.status({ fill: 'yellow', shape: 'dot', text: `CEM rejection: ${msg.status}` })
            statusTimer = setTimeout(() => { statusTimer = null; updateStatus() }, 5000)
          }
          if (msg.message_type === MessageType.REVOKE_OBJECT) {
            const revokedId = (msg as { object_id?: string }).object_id
            const revokedObjectType = (msg as { object_type?: string }).object_type
            if (revokedId && revokedObjectType && revokedObjectType.endsWith('.Instruction')) {
              const pending = getPending()
              const revokedItem = pending.find(p => p.instructionId === revokedId)
              if (revokedItem) {
                setPending(pending.filter(p => p.instructionId !== revokedId))
                if (!isSkipInstructionStatus) {
                  const sess = sessions.get(cemId)
                  if (sess) sess.sendInstructionStatus(revokedId, InstructionStatus.REVOKED)
                }
              }
            }
          }
          node.send([null, { payload: msg, cemId, topic: msg.message_type }])
          if (msg.message_type === MessageType.SELECT_CONTROL_TYPE) {
            const controlType = (msg.control_type as string) || ControlType.NO_SELECTION
            const isActive = controlType !== ControlType.NO_SELECTION && controlType !== ControlType.NOT_CONTROLABLE
            node.send([{ payload: { 'S2/0/Active': isActive ? 1 : 0 } }, null])
            if (rmDetails.providesPowerMeasurementTypes.length > 0) {
              node.send([{
                payload: {
                  s2Signal: 'PowerMeasurementStart',
                  commodityQuantities: rmDetails.providesPowerMeasurementTypes
                },
                cemId
              }, null])
            }
          }
        },

        onInstruction: (msg) => {
          const rawMsg = msg as Record<string, unknown>
          const messageId = rawMsg.message_id as string | undefined
          const instructionId = rawMsg.id as string | undefined
          const executionTimeStr = rawMsg.execution_time as string | undefined
          const executionTimeMs = executionTimeStr ? new Date(executionTimeStr).getTime() : Date.now()

          if (msg.message_type === MessageType.PEBC_INSTRUCTION) {
            // PEBC schedule accumulation and per-element dispatch timing is owned by s2-pebc -
            // deliver the raw instruction immediately so it can build/dispatch with its own timers.
            node.send([null, { payload: msg, cemId, topic: msg.message_type }])
            return
          }

          const now = Date.now()
          if (executionTimeMs <= now) {
            const session = sessions.get(cemId)
            if (session && instructionId && !isSkipInstructionStatus) {
              session.sendInstructionStatus(instructionId, InstructionStatus.STARTED)
            }
            node.send([null, { payload: msg, cemId, topic: msg.message_type }])
          } else {
            if (messageId) {
              addToPending({
                messageId,
                instructionId,
                instruction: rawMsg,
                cemId,
                executionTimeMs
              })
            }
          }
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

      // PowerConstraints applies globally (all current + future sessions), so unlike every
      // other command it does not require a cemId - a control-type node can push a default
      // at deploy time, before any CEM has connected.
      if (command === 'PowerConstraints') {
        const { constraints } = msg.payload as { constraints?: PEBCPowerConstraintsInput }
        if (!constraints || typeof constraints !== 'object') {
          done(new Error('PowerConstraints requires a constraints object'))
          return
        }
        pendingPEBCConstraints = constraints
        for (const session of sessions.values()) {
          session.setPEBCPowerConstraints(constraints)
        }
        done()
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
            sessions.get(cemId)!.dispose()
            sessions.delete(cemId)
          }
          const session = createSession(cemId)
          session.start()
          node.send([null, { topic: 'Connected', cemId }])
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
          sessions.get(cemId)?.dispose()
          sessions.delete(cemId)
          node.send([null, { topic: 'Disconnected', cemId, reason: 'cem_initiated' }])
          node.log(`CEM ${cemId} disconnected`)
          updateStatus()
          done()
          break
        }

        case 'InstructionStatus': {
          const { instructionId, status } = msg.payload as { instructionId?: string, status?: string }
          if (!instructionId || typeof instructionId !== 'string') {
            done(new Error('InstructionStatus requires an instructionId string'))
            return
          }
          if (!status || !Object.values(InstructionStatus).includes(status as InstructionStatusValue)) {
            done(new Error(`InstructionStatus requires a valid status: ${Object.values(InstructionStatus).join(', ')}`))
            return
          }
          const isSession = sessions.get(cemId)
          if (!isSession) {
            node.warn(`InstructionStatus for unknown CEM ${cemId} - ignoring`)
            done()
            return
          }
          isSession.sendInstructionStatus(instructionId, status as InstructionStatusValue)
          done()
          break
        }

        case 'UpdateStatus': {
          const { controlType, ...payload } = msg.payload as { controlType?: string, [key: string]: unknown }
          if (!controlType || typeof controlType !== 'string') {
            done(new Error('UpdateStatus requires a controlType string'))
            return
          }
          const usSession = sessions.get(cemId)
          if (!usSession) {
            node.warn(`UpdateStatus for unknown CEM ${cemId} - ignoring`)
            done()
            return
          }
          usSession.updateStatus(controlType, payload as StatusPayload)
          done()
          break
        }

        case 'SystemDescription': {
          const { controlType, ...payload } = msg.payload as { controlType?: string, [key: string]: unknown }
          if (!controlType || typeof controlType !== 'string') {
            done(new Error('SystemDescription requires a controlType string'))
            return
          }
          const sdSession = sessions.get(cemId)
          if (!sdSession) {
            node.warn(`SystemDescription for unknown CEM ${cemId} - ignoring`)
            done()
            return
          }
          sdSession.sendSystemDescription(controlType, payload as SystemDescriptionPayload)
          done()
          break
        }

        default:
          done(new Error(`Unknown command: ${command}`))
      }
    })

    node.on('close', (done) => {
      if (statusTimer) {
        clearTimeout(statusTimer)
        statusTimer = null
      }
      clearInterval(pollTimer)
      for (const session of sessions.values()) {
        session.dispose()
      }
      sessions.clear()
      node.status({})
      done()
    })
  }

  RED.nodes.registerType('s2-rm', S2RmNode)
}
