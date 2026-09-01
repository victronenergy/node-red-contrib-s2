import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { NodeRedApp, NodeConfig, NodeRedNode, NodeMessage } from '../../types/node-red'
import { S2PebcConfigNode } from '../../types/config-nodes'
import { InstructionStatus, MessageType, PEBCPowerConstraintsInput, PowerForecastInput, PowerMeasurementValue, gridConnectionToAmpsPerPhase, gridConnectionToWatts } from '../../lib/s2/messages'
import { parsePebcInstruction, getActiveElement, getNextElementStart, capForecastToSchedule, PebcSchedule, ScheduleElement } from '../../lib/s2/schedule'

interface S2PebcNodeConfig extends NodeConfig {
  pebcConfig: string
}

const SCHEDULE_CONTEXT_KEY = 's2PebcSchedule'

/**
 * s2-pebc node
 *
 * Owns Power Envelope Based Control (PEBC) behavior: accumulates power envelope
 * schedules from PEBC instructions and dispatches the currently active bound as
 * it becomes effective. Also pushes a default PowerConstraints range (from
 * s2-pebc-config) on deploy, used until a runtime override is supplied. That same
 * wattage (or null if unconfigured) is published to flow context as
 * `pebcDefaultMaxPowerW`, so downstream flow logic can derive a released-state
 * limit (e.g. amps) from it instead of hardcoding one. For a named grid connection
 * (not 'custom'), its fixed per-phase amp rating is also published as
 * `pebcDefaultMaxAmpsPerPhase` (null for 'custom' or unset) - prefer this over dividing
 * `pebcDefaultMaxPowerW` by a live voltage reading, which drifts below the configured
 * rating whenever actual voltage exceeds the 230V nominal used to derive the wattage.
 *
 * Wiring:
 *   [s2-rm output 2 (from CEM)]       -> [s2-pebc input]  (all CEM messages incl. instructions)
 *   [Forecast command source]          -> [s2-pebc input]  (optional - to cap the forecast to the accumulated schedule)
 *   [PowerMeasurement command source] -> [s2-pebc input]  (optional - to resolve which side of an
 *                                          asymmetric bound currently applies; see output port 1)
 *   [s2-pebc output 1] -> downstream flow (active element dispatch)
 *   [s2-pebc output 2] -> downstream flow (full accumulated schedule dump)
 *   [s2-pebc output 3] -> [s2-rm input]  (PowerConstraints / InstructionStatus / Forecast commands)
 *
 * Output port 1 - active element:
 *   Active element: { cemId, payload: { startTime, endTime, duration, lowerBound, upperBound, commodityQuantity, direction, limitW } }
 *   Released (no PEBC bound active - last instruction revoked, or its final element ended with
 *   nothing queued after it): { cemId, payload: { lowerBound: null, upperBound: null, commodityQuantity, direction, limitW: null } }
 *   `direction` ('import' or 'export') and `limitW` (watts) are resolved from the last known
 *   PowerMeasurement for that commodity, if any was wired in; `direction` defaults to 'import'
 *   (limitW = upperBound) otherwise. When a measurement flips `direction` for the currently
 *   active element and its two bounds actually differ, output 1 is re-emitted with the updated
 *   values - this does not resend InstructionStatus on output 3, since the instruction itself
 *   hasn't changed, only which of its bounds is presently binding.
 *   Non-PEBC instructions: ignored silently.
 *
 * Output port 2 - schedule:
 *   { cemId, payload: { commodityQuantity, elements: [{ startTime, endTime, durationSec, lowerBound, upperBound }] } }
 *
 * Output port 3 - commands to s2-rm:
 *   { payload: { command: 'PowerConstraints', constraints } }
 *   { payload: { command: 'InstructionStatus', cemId, instructionId, status } }
 *     status is STARTED when an instruction's slot becomes active, SUCCEEDED once all of an
 *     instruction's slots have elapsed without being revoked, and REVOKED on an incoming
 *     RevokeObject for that instruction.
 *   { payload: { command: 'Forecast', cemId, forecast } }  (forecast capped to the accumulated schedule, if any)
 */
export = function (RED: NodeRedApp): void {
  function S2PebcNode (this: NodeRedNode, config: S2PebcNodeConfig): void {
    RED.nodes.createNode(this, config)
    const node = this

    const pebcConfigNode = RED.nodes.getNode(config.pebcConfig) as S2PebcConfigNode | null
    if (!pebcConfigNode) {
      node.error('s2-pebc-config node is missing - please configure PEBC power constraints defaults')
      node.status({ fill: 'red', shape: 'dot', text: 'config missing' })
      return
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
        // Repopulate pebcSlots (not just the schedule passed to applySchedule) so
        // updateNodeStatus - which reads pebcSlots, not the schedule variable - reflects
        // the restored schedule immediately instead of showing "no schedule" until the
        // next instruction arrives.
        for (const el of validElements) {
          pebcSlots.set(el.startMs, { element: el, commodityQuantity: schedule.commodityQuantity, cemId: schedule.cemId, instructionId: schedule.instructionId })
        }
        applySchedule({ ...schedule, elements: validElements })
        node.log(`Restored S2 schedule for CEM ${schedule.cemId} with ${validElements.length} future element(s)`)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
          node.warn('Failed to load persisted S2 schedule: ' + (e as Error).message)
        }
      }
    }

    let scheduleTimer: ReturnType<typeof setTimeout> | null = null
    // Accumulated PEBC slots: keyed by slot start time (ms).
    // Cleared when power_constraints_id changes (new planning period).
    let pebcConstraintsId: string | null = null
    const pebcSlots = new Map<number, { element: ScheduleElement, commodityQuantity: string, cemId: string, instructionId: string }>()

    // Deduplication: track last emitted active element to suppress identical re-emits from the CEM.
    let lastEmittedActive: { startMs: number, lowerBound: number | null, upperBound: number | null, commodityQuantity: string } | null = null
    let duplicateActiveCount = 0

    // Latest signed PowerMeasurement value per commodity quantity (positive = import, negative = export).
    const lastMeasurement = new Map<string, number>()
    // Direction last announced to the flow, tracked independently of lastEmittedActive so a
    // measurement-driven re-announcement never interacts with the InstructionStatus dedup above.
    let lastAnnouncedDirection: 'import' | 'export' | null = null

    function resolveDirection (commodityQuantity: string): 'import' | 'export' {
      const measured = lastMeasurement.get(commodityQuantity)
      return measured !== undefined && measured < 0 ? 'export' : 'import'
    }

    function resolveLimitW (direction: 'import' | 'export', lowerBound: number | null, upperBound: number | null): number | null {
      if (direction === 'export') return lowerBound === null ? null : Math.abs(lowerBound)
      return upperBound
    }

    function formatTime (ms: number): string {
      return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    function formatBound (bound: number | null): string {
      return bound === null ? '∞' : `${bound}W`
    }

    function updateNodeStatus (): void {
      const count = pebcSlots.size
      if (count === 0) {
        node.status({ fill: 'grey', shape: 'ring', text: 'no schedule' })
        return
      }

      const countLabel = `${count} slot${count > 1 ? 's' : ''}`
      const sorted = [...pebcSlots.values()].sort((a, b) => a.element.startMs - b.element.startMs)
      const now = Date.now()
      const active = sorted.find(s => now >= s.element.startMs && now < s.element.endMs)

      if (active) {
        node.status({
          fill: 'green',
          shape: 'dot',
          text: `${countLabel} · active ${formatBound(active.element.lowerBound)}..${formatBound(active.element.upperBound)} until ${formatTime(active.element.endMs)}`
        })
        return
      }

      const next = sorted.find(s => s.element.startMs > now)
      if (next) {
        node.status({ fill: 'blue', shape: 'dot', text: `${countLabel} · next @ ${formatTime(next.element.startMs)}` })
        return
      }

      node.status({ fill: 'yellow', shape: 'ring', text: `${countLabel} · all expired` })
    }

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
        node.debug(`duplicate active element from CEM (${duplicateActiveCount} total) - suppressing emit`)
        node.status({ fill: 'yellow', shape: 'ring', text: `${pebcSlots.size} slot(s) · ${duplicateActiveCount} dup.` })
        return
      }

      lastEmittedActive = { startMs: el.startMs, lowerBound: el.lowerBound, upperBound: el.upperBound, commodityQuantity: schedule.commodityQuantity }
      duplicateActiveCount = 0
      updateNodeStatus()

      const slot = pebcSlots.get(el.startMs)
      if (slot) {
        node.send([null, null, { payload: { command: 'InstructionStatus', cemId: slot.cemId, instructionId: slot.instructionId, status: InstructionStatus.STARTED } }])
      }

      const direction = resolveDirection(schedule.commodityQuantity)
      lastAnnouncedDirection = direction

      node.send([{
        cemId: schedule.cemId,
        payload: {
          startTime: new Date(el.startMs).toISOString(),
          endTime: new Date(el.endMs).toISOString(),
          duration: el.duration,
          lowerBound: el.lowerBound,
          upperBound: el.upperBound,
          commodityQuantity: schedule.commodityQuantity,
          direction,
          limitW: resolveLimitW(direction, el.lowerBound, el.upperBound)
        }
      }, null, null])
    }

    // Signals that no PEBC-imposed bound is active right now - after the last known
    // instruction is revoked, or its final element ends with nothing queued after it.
    // Reuses the S2 meaning of a null bound ("unbounded on this side") rather than a
    // separate message shape, so downstream consumers can treat it like any other
    // active-element update.
    function emitReleased (cemId: string, commodityQuantity: string): void {
      lastEmittedActive = null
      const direction = resolveDirection(commodityQuantity)
      lastAnnouncedDirection = direction
      node.send([{ cemId, payload: { lowerBound: null, upperBound: null, commodityQuantity, direction, limitW: null } }, null, null])
      updateNodeStatus()
    }

    // Sends InstructionStatus(SUCCEEDED) for any instruction whose accumulated slots have all
    // naturally elapsed (endMs <= nowMs) without being revoked or superseded, and removes those
    // slots from pebcSlots. An instruction's own slots can span more than one element, so this
    // only fires once none of its slots remain due - not the first time any one of them ends.
    function reapEndedInstructions (nowMs: number): void {
      const endedInstructionCemIds = new Map<string, string>()
      for (const [key, slot] of pebcSlots.entries()) {
        if (slot.element.endMs <= nowMs) {
          endedInstructionCemIds.set(slot.instructionId, slot.cemId)
          pebcSlots.delete(key)
        }
      }
      for (const [instructionId, cemId] of endedInstructionCemIds) {
        const stillRunning = [...pebcSlots.values()].some(s => s.instructionId === instructionId)
        if (!stillRunning) {
          node.send([null, null, { payload: { command: 'InstructionStatus', cemId, instructionId, status: InstructionStatus.SUCCEEDED } }])
        }
      }
    }

    function scheduleNextDispatch (schedule: PebcSchedule): void {
      if (scheduleTimer) {
        clearTimeout(scheduleTimer)
        scheduleTimer = null
      }
      const now = Date.now()
      const nextStart = getNextElementStart(schedule, now)
      if (nextStart !== null) {
        const delay = Math.max(0, nextStart - now)
        scheduleTimer = setTimeout(() => {
          scheduleTimer = null
          reapEndedInstructions(Date.now())
          emitActiveElement(schedule)
          scheduleNextDispatch(schedule)
        }, delay)
        return
      }

      // No next element queued - if one is currently active, it's the last one:
      // arm a release once it ends instead of leaving output 1 silent forever.
      const active = getActiveElement(schedule, now)
      if (!active) return
      const delay = Math.max(0, active.endMs - now)
      scheduleTimer = setTimeout(() => {
        scheduleTimer = null
        reapEndedInstructions(Date.now())
        emitReleased(schedule.cemId, schedule.commodityQuantity)
      }, delay)
    }

    function applySchedule (schedule: PebcSchedule): void {
      node.context().set(SCHEDULE_CONTEXT_KEY, schedule)
      saveSchedule(schedule)
      emitActiveElement(schedule)
      scheduleNextDispatch(schedule)
      node.send([null, {
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
      }, null])
      updateNodeStatus()
    }

    function handleInstruction (msg: NodeMessage): void {
      const payload = msg.payload as Record<string, unknown>
      const messageType = payload.message_type as string
      if (messageType !== MessageType.PEBC_INSTRUCTION) {
        return
      }
      const cemId = msg.cemId
      const rawMsg = payload
      const parsed = parsePebcInstruction(rawMsg, Date.now(), cemId)
      if (!parsed || parsed.elements.length === 0) return

      const constraintsId = rawMsg.power_constraints_id as string | undefined
      if (constraintsId && constraintsId !== pebcConstraintsId) {
        pebcSlots.clear()
        pebcConstraintsId = constraintsId
      }
      for (const el of parsed.elements) {
        pebcSlots.set(el.startMs, { element: el, commodityQuantity: parsed.commodityQuantity, cemId: cemId || '', instructionId: parsed.instructionId })
      }
      const sorted = [...pebcSlots.values()].sort((a, b) => a.element.startMs - b.element.startMs)
      const combined: PebcSchedule = {
        receivedAt: Date.now(),
        cemId: sorted[0].cemId,
        instructionId: parsed.instructionId,
        commodityQuantity: sorted[0].commodityQuantity,
        elements: sorted.map(s => s.element)
      }
      applySchedule(combined)
    }

    function handleRevoke (msg: NodeMessage): void {
      const payload = msg.payload as Record<string, unknown>
      const revokedId = payload.object_id as string | undefined
      const revokedObjectType = payload.object_type as string | undefined
      if (!revokedId || !revokedObjectType || !revokedObjectType.endsWith('.Instruction')) return

      let found = false
      let commodityQuantity = ''
      for (const [key, slot] of pebcSlots.entries()) {
        if (slot.instructionId === revokedId) {
          commodityQuantity = slot.commodityQuantity
          pebcSlots.delete(key)
          found = true
        }
      }
      if (!found) return

      node.send([null, null, { payload: { command: 'InstructionStatus', cemId: msg.cemId, instructionId: revokedId, status: InstructionStatus.REVOKED } }])

      if (pebcSlots.size === 0) {
        if (scheduleTimer) { clearTimeout(scheduleTimer); scheduleTimer = null }
        node.context().set(SCHEDULE_CONTEXT_KEY, null)
        emitReleased(msg.cemId || '', commodityQuantity)
      } else {
        const sorted = [...pebcSlots.values()].sort((a, b) => a.element.startMs - b.element.startMs)
        const rebuilt: PebcSchedule = {
          receivedAt: Date.now(),
          cemId: sorted[0].cemId,
          instructionId: sorted[0].instructionId,
          commodityQuantity: sorted[0].commodityQuantity,
          elements: sorted.map(s => s.element)
        }
        applySchedule(rebuilt)
        // The revoked slot may have been the currently-active one, leaving a gap before the
        // next queued slot starts - applySchedule's emitActiveElement no-ops when nothing is
        // currently active, so it would otherwise leave output 1 stuck on the revoked element's
        // stale bounds. Only release when something WAS actively constraining before this
        // revoke (lastEmittedActive): a schedule whose next slot simply hasn't started yet
        // must stay silent, per the "not-yet-started schedule" rule.
        if (lastEmittedActive !== null && !getActiveElement(rebuilt, Date.now())) {
          emitReleased(msg.cemId || '', commodityQuantity)
        }
      }
    }

    function buildCurrentSchedule (): PebcSchedule | null {
      if (pebcSlots.size === 0) return null
      const sorted = [...pebcSlots.values()].sort((a, b) => a.element.startMs - b.element.startMs)
      return {
        receivedAt: Date.now(),
        cemId: sorted[0].cemId,
        instructionId: sorted[0].instructionId,
        commodityQuantity: sorted[0].commodityQuantity,
        elements: sorted.map(s => s.element)
      }
    }

    function handleForecast (msg: NodeMessage): void {
      const payload = msg.payload as Record<string, unknown>
      const forecast = payload.forecast as PowerForecastInput | undefined
      const schedule = forecast ? buildCurrentSchedule() : null
      if (!forecast || !schedule) {
        node.send([null, null, msg])
        return
      }
      node.send([null, null, { ...msg, payload: { ...payload, forecast: capForecastToSchedule(forecast, schedule) } }])
    }

    function handlePowerMeasurement (msg: NodeMessage): void {
      const payload = msg.payload as Record<string, unknown>
      const values = payload.values as PowerMeasurementValue[] | undefined
      if (!Array.isArray(values)) return
      for (const v of values) {
        if (typeof v.value === 'number' && typeof v.commodity_quantity === 'string') {
          lastMeasurement.set(v.commodity_quantity, v.value)
        }
      }
      reannounceIfDirectionChanged()
    }

    // Re-emits the active element on output 1 only (no InstructionStatus on output 3) when a
    // measurement flips which side of an asymmetric bound currently applies. Deliberately
    // independent of emitActiveElement's dedup/InstructionStatus logic - the instruction itself
    // hasn't changed, only which of its two bounds is presently binding.
    function reannounceIfDirectionChanged (): void {
      const schedule = buildCurrentSchedule()
      if (!schedule) return
      const el = getActiveElement(schedule, Date.now())
      if (!el) return

      const direction = resolveDirection(schedule.commodityQuantity)
      if (direction === lastAnnouncedDirection) return

      const importLimit = resolveLimitW('import', el.lowerBound, el.upperBound)
      const exportLimit = resolveLimitW('export', el.lowerBound, el.upperBound)
      lastAnnouncedDirection = direction
      if (importLimit === exportLimit) return

      node.send([{
        cemId: schedule.cemId,
        payload: {
          startTime: new Date(el.startMs).toISOString(),
          endTime: new Date(el.endMs).toISOString(),
          duration: el.duration,
          lowerBound: el.lowerBound,
          upperBound: el.upperBound,
          commodityQuantity: schedule.commodityQuantity,
          direction,
          limitW: resolveLimitW(direction, el.lowerBound, el.upperBound)
        }
      }, null, null])
    }

    updateNodeStatus()

    node.on('input', (msg, _send, done) => {
      if ('controlType' in msg) {
        // Legacy enriched instruction from s2-rm (pre-v0.3)
        handleInstruction(msg)
        done()
        return
      }
      const payload = msg.payload as Record<string, unknown> | undefined
      if (payload && typeof payload === 'object') {
        const messageType = (payload as Record<string, unknown>).message_type as string | undefined
        if (messageType && messageType.startsWith('PEBC.')) {
          handleInstruction(msg)
          done()
          return
        }
      }
      if (payload && typeof payload === 'object' && payload.message_type === MessageType.REVOKE_OBJECT) {
        handleRevoke(msg)
        done()
        return
      }
      if (payload && typeof payload === 'object' && payload.command === 'Forecast') {
        handleForecast(msg)
        done()
        return
      }
      if (payload && typeof payload === 'object' && payload.command === 'PowerMeasurement') {
        handlePowerMeasurement(msg)
        done()
        return
      }
      done()
    })

    node.on('close', (done) => {
      if (scheduleTimer) {
        clearTimeout(scheduleTimer)
        scheduleTimer = null
      }
      done()
    })

    loadPersistedSchedule()

    // Push the configured default power constraints on deploy, used until a runtime
    // override is supplied. Deferred so s2-rm's input listener is guaranteed attached first.
    const defaultMaxPowerW = gridConnectionToWatts(pebcConfigNode.gridConnection, pebcConfigNode.customMaxPowerW)
    // Published so downstream flow logic can derive a released-state limit (e.g. amps)
    // the same way it derives any other numeric bound, instead of hardcoding one.
    node.context().flow.set('pebcDefaultMaxPowerW', defaultMaxPowerW)
    // The fixed breaker rating, when known - independent of any live voltage reading, unlike
    // dividing pebcDefaultMaxPowerW by voltage (which drifts below the configured rating
    // whenever actual voltage exceeds the 230V nominal used to derive that wattage).
    node.context().flow.set('pebcDefaultMaxAmpsPerPhase', gridConnectionToAmpsPerPhase(pebcConfigNode.gridConnection))
    if (defaultMaxPowerW != null) {
      const constraints: PEBCPowerConstraintsInput = {
        commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC',
        minPower: -defaultMaxPowerW,
        maxPower: defaultMaxPowerW
      }
      setTimeout(() => {
        node.send([null, null, { payload: { command: 'PowerConstraints', constraints } }])
      }, 100)
    }
  }

  RED.nodes.registerType('s2-pebc', S2PebcNode)
}
