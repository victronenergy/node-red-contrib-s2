import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { NodeRedApp, NodeConfig, NodeRedNode } from '../../types/node-red'
import { S2RmConfigNode, S2CemConfigNode } from '../../types/config-nodes'
import { S2Session, State } from '../../lib/s2/session'
import { generateId, makePowerForecast, makePowerMeasurement, MessageType, ReceptionStatusResult, InstructionStatus, InstructionStatusValue, PEBCPowerConstraintsInput, PowerForecastInput, PowerMeasurementValue, gridConnectionToWatts, OMBCStatusConfig } from '../../lib/s2/messages'
import { parsePebcInstruction, getActiveElement, getNextElementStart, PebcSchedule, ScheduleElement } from '../../lib/s2/schedule'

interface S2RmConfig extends NodeConfig {
  rmConfig: string
  cem?: string // optional reference to s2-cem-config for CEM REST API access
  controlTypeConfig?: string
  providesPowerMeasurement?: string
  providesForecast?: boolean
}

interface PendingInstruction {
  messageId: string
  instructionId: string | undefined
  instruction: Record<string, unknown>
  cemId: string
  executionTimeMs: number
  isPebc: boolean
  scheduleEndMs: number | undefined
}

const PENDING_INSTRUCTIONS_KEY = 's2PendingInstructions'
const OMBC_STATUS_KEY = 's2OmbcStatus'
const PRUNE_GRACE_MS = 3_600_000 // 1 hour grace before a non-PEBC instruction is pruned

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

    // Persist/restore schedule across restarts
    const scheduleDir = path.join(RED.settings?.userDir || path.join(os.homedir(), '.node-red'), '.s2')
    const scheduleFile = path.join(scheduleDir, `${node.id}-schedule.json`)

    function saveSchedule (schedule: PebcSchedule): void {
      try {
        fs.mkdirSync(scheduleDir, { recursive: true })
        fs.writeFileSync(scheduleFile, JSON.stringify(schedule, null, 2))
      } catch (e) {
        node.warn('Failed to persist S2 schedule: ' + (e as Error).message)
      }
    }

    function loadPersistedSchedule (): void {
      try {
        const raw = fs.readFileSync(scheduleFile, 'utf8')
        const schedule = JSON.parse(raw) as PebcSchedule
        const now = Date.now()
        const validElements = schedule.elements.filter(el => el.endMs > now)
        if (validElements.length === 0) return
        applySchedule({ ...schedule, elements: validElements })
        node.log(`Restored S2 schedule for CEM ${schedule.cemId} with ${validElements.length} future element(s)`)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
          node.warn('Failed to load persisted S2 schedule: ' + (e as Error).message)
        }
      }
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

    // Derive default PEBC constraints from the grid connection config
    const defaultMaxPowerW = gridConnectionToWatts(rmConfigNode.gridConnection, rmConfigNode.customMaxPowerW)
    let pendingPEBCConstraints: PEBCPowerConstraintsInput | null = defaultMaxPowerW != null
      ? { commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', minPower: -defaultMaxPowerW, maxPower: defaultMaxPowerW }
      : null

    let statusTimer: ReturnType<typeof setTimeout> | null = null

    // PEBC schedule dispatch
    let scheduleTimer: ReturnType<typeof setTimeout> | null = null
    const SCHEDULE_CONTEXT_KEY = 's2PebcSchedule'
    // Accumulated PEBC slots: keyed by slot start time (ms).
    // Cleared when power_constraints_id changes (new planning period).
    let pebcConstraintsId: string | null = null
    const pebcSlots = new Map<number, { element: ScheduleElement, commodityQuantity: string, cemId: string, instructionId: string }>()

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

    // Poll at the configured interval: dispatch due non-PEBC instructions, prune expired entries.
    const pollTimer = setInterval(() => {
      const pending = getPending()
      if (pending.length === 0) return
      const now = Date.now()
      let changed = false
      const remaining: PendingInstruction[] = []
      for (const item of pending) {
        const expired = item.isPebc
          ? (item.scheduleEndMs !== undefined && item.scheduleEndMs < now)
          : (item.executionTimeMs + PRUNE_GRACE_MS < now)
        if (expired) { changed = true; continue }
        if (!item.isPebc && item.executionTimeMs <= now) {
          const session = sessions.get(item.cemId)
          if (session && item.instructionId) {
            session.sendInstructionStatus(item.instructionId, InstructionStatus.STARTED)
          }
          const rawItem = item.instruction as Record<string, unknown>
          const resolvedItemMode = resolveOMBCMode(rawItem)
          const itemOutMsg: Record<string, unknown> = { payload: item.instruction, cemId: item.cemId }
          if (resolvedItemMode) {
            itemOutMsg.topic = resolvedItemMode.label
            itemOutMsg.operationMode = resolvedItemMode
          }
          node.send([null, null, itemOutMsg, null])
          changed = true
          continue
        }
        remaining.push(item)
      }
      if (changed) setPending(remaining)
    }, pollIntervalMs).unref()

    // Deduplication: track last emitted active element to suppress identical re-emits from the CEM.
    let lastEmittedActive: { startMs: number, lowerBound: number | null, upperBound: number | null, commodityQuantity: string } | null = null
    let duplicateActiveCount = 0

    function emitActiveElement (schedule: PebcSchedule): void {
      const el = getActiveElement(schedule, Date.now())
      if (!el) return

      const isDuplicate = lastEmittedActive !== null &&
        lastEmittedActive.startMs === el.startMs &&
        lastEmittedActive.lowerBound === el.lowerBound &&
        lastEmittedActive.upperBound === el.upperBound &&
        lastEmittedActive.commodityQuantity === schedule.commodityQuantity

      if (isDuplicate) {
        duplicateActiveCount++
        node.debug(`duplicate active element from CEM (${duplicateActiveCount} total) - suppressing port 3 emit`)
        const count = sessions.size
        node.status({ fill: 'yellow', shape: 'ring', text: `${count} CEM${count > 1 ? 's' : ''} connected · ${duplicateActiveCount} dup.` })
        return
      }

      lastEmittedActive = { startMs: el.startMs, lowerBound: el.lowerBound, upperBound: el.upperBound, commodityQuantity: schedule.commodityQuantity }
      duplicateActiveCount = 0
      updateStatus()
      const slot = pebcSlots.get(el.startMs)
      if (slot) {
        const session = sessions.get(slot.cemId)
        if (session) session.sendInstructionStatus(slot.instructionId, InstructionStatus.STARTED)
      }
      node.send([null, null, {
        cemId: schedule.cemId,
        payload: {
          startTime: new Date(el.startMs).toISOString(),
          endTime: new Date(el.endMs).toISOString(),
          duration: el.duration,
          lowerBound: el.lowerBound,
          upperBound: el.upperBound,
          commodityQuantity: schedule.commodityQuantity
        }
      }, null])
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
      saveSchedule(schedule)
      emitActiveElement(schedule)
      scheduleNextDispatch(schedule)
      node.send([null, null, null, {
        cemId: schedule.cemId,
        payload: {
          commodityQuantity: schedule.commodityQuantity,
          elements: schedule.elements.map(el => ({
            startTime: new Date(el.startMs).toISOString(),
            endTime: new Date(el.endMs).toISOString(),
            durationSec: Math.round(el.duration / 1000),
            lowerBound: el.lowerBound,
            upperBound: el.upperBound
          }))
        }
      }])
    }

    type ResolvedOMBCMode = { id: string, index: number, label: string, factor: number, powerRanges: unknown[] }

    function resolveOMBCMode (rawInstr: Record<string, unknown>): ResolvedOMBCMode | null {
      if (rawInstr.message_type !== MessageType.OMBC_INSTRUCTION) return null
      const modeId = (rawInstr.operation_mode_id || rawInstr.operation_mode) as string | undefined
      if (!modeId) return null
      const factor = typeof rawInstr.operation_mode_factor === 'number' ? rawInstr.operation_mode_factor : 1
      const ctc = controlTypeConfig as Record<string, unknown>
      const modes = ((ctc.OMBC as Record<string, unknown> | undefined)
        ?.systemDescription as Record<string, unknown> | undefined)
        ?.operationModes as Array<Record<string, unknown>> | undefined
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

    // Persist the committed OMBC mode to flow context so reconnecting CEMs see the correct status.
    // Called at instruction accept time (in onInstruction, which runs inside _ackAndForward).
    // The session has already updated _currentOMBCStatus and sent OMBC.Status by this point.
    function persistOMBCStatusIfInstruction (session: S2Session, rawInstr: Record<string, unknown>): void {
      if (rawInstr.message_type !== MessageType.OMBC_INSTRUCTION) return
      const status = session.currentOMBCStatus
      if (status) {
        node.context().flow.set(OMBC_STATUS_KEY, status)
      }
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
          const m = msg as Record<string, unknown>
          if (m.message_type === MessageType.PEBC_POWER_CONSTRAINTS && typeof m.id === 'string') {
            node.context().flow.set('pebcConstraintsId', m.id)
          }
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
            if (statusTimer) clearTimeout(statusTimer)
            node.status({ fill: 'yellow', shape: 'dot', text: `CEM rejection: ${msg.status}` })
            statusTimer = setTimeout(() => { statusTimer = null; updateStatus() }, 5000)
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
          const rawMsg = msg as Record<string, unknown>
          const messageId = rawMsg.message_id as string | undefined
          const instructionId = rawMsg.id as string | undefined
          const executionTimeStr = rawMsg.execution_time as string | undefined
          const executionTimeMs = executionTimeStr ? new Date(executionTimeStr).getTime() : Date.now()

          // Persist the OMBC status committed by the session in _ackAndForward.
          // Done at accept time so reconnecting CEMs always see the correct mode,
          // even if the CEM disconnects before the instruction's execution_time.
          const sess = sessions.get(cemId)
          if (sess) {
            persistOMBCStatusIfInstruction(sess, rawMsg)
          }

          if (msg.message_type === MessageType.PEBC_INSTRUCTION) {
            const parsed = parsePebcInstruction(rawMsg, Date.now(), cemId)
            if (parsed && parsed.elements.length > 0) {
              const constraintsId = rawMsg.power_constraints_id as string | undefined
              if (constraintsId && constraintsId !== pebcConstraintsId) {
                pebcSlots.clear()
                pebcConstraintsId = constraintsId
              }
              for (const el of parsed.elements) {
                pebcSlots.set(el.startMs, { element: el, commodityQuantity: parsed.commodityQuantity, cemId, instructionId: parsed.instructionId })
              }
              const sorted = [...pebcSlots.values()].sort((a, b) => a.element.startMs - b.element.startMs)
              const combined: PebcSchedule = {
                receivedAt: Date.now(),
                cemId: sorted[0].cemId,
                instructionId: parsed.instructionId,
                commodityQuantity: sorted[0].commodityQuantity,
                elements: sorted.map(s => s.element)
              }
              if (messageId) {
                addToPending({
                  messageId,
                  instructionId,
                  instruction: rawMsg,
                  cemId,
                  executionTimeMs,
                  isPebc: true,
                  scheduleEndMs: combined.elements[combined.elements.length - 1].endMs
                })
              }
              applySchedule(combined)
              return
            }
          }

          // Non-PEBC (or PEBC with no valid schedule): dispatch immediately or queue.
          const now = Date.now()
          if (executionTimeMs <= now) {
            const session = sessions.get(cemId)
            if (session && instructionId) {
              session.sendInstructionStatus(instructionId, InstructionStatus.STARTED)
            }
            const resolvedMode = resolveOMBCMode(rawMsg)
            const outMsg: Record<string, unknown> = { payload: msg, cemId }
            if (resolvedMode) {
              outMsg.topic = resolvedMode.label
              outMsg.operationMode = resolvedMode
            }
            node.send([null, null, outMsg, null])
          } else {
            if (messageId) {
              addToPending({
                messageId,
                instructionId,
                instruction: rawMsg,
                cemId,
                executionTimeMs,
                isPebc: false,
                scheduleEndMs: undefined
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
          // Restore persisted OMBC status so this session reports the last known mode
          // when SELECT_CONTROL_TYPE(OMBC) is received. Falls back to the static config.
          const savedOmbcStatus = node.context().flow.get(OMBC_STATUS_KEY) as OMBCStatusConfig | undefined
          if (savedOmbcStatus) {
            session.updateOMBCStatus(savedOmbcStatus)
          }
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
          sessions.get(cemId)?.dispose()
          sessions.delete(cemId)
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
      if (scheduleTimer) {
        clearTimeout(scheduleTimer)
        scheduleTimer = null
      }
      for (const session of sessions.values()) {
        session.dispose()
      }
      sessions.clear()
      node.status({})
      done()
    })

    loadPersistedSchedule()
  }

  RED.nodes.registerType('s2-rm', S2RmNode)
}
