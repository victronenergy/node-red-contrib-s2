'use strict'

import type { PowerForecastInput, PowerForecastValue } from './messages'

export interface ScheduleElement {
  startMs: number
  endMs: number
  duration: number
  lowerBound: number | null
  upperBound: number | null
}

export interface PebcSchedule {
  receivedAt: number
  cemId: string
  instructionId: string
  commodityQuantity: string
  elements: ScheduleElement[]
}

interface RawEnvelopeElement {
  duration: number
  upper_limit?: number | null
  lower_limit?: number | null
}

interface RawPowerEnvelope {
  id: string
  commodity_quantity: string
  power_envelope_elements: RawEnvelopeElement[]
}

/**
 * Parse a PEBC.Instruction message into a PebcSchedule with absolute timestamps.
 * Returns null if the message contains no usable power_envelopes.
 */
export function parsePebcInstruction (msg: Record<string, unknown>, receivedAt: number, cemId = ''): PebcSchedule | null {
  const envelopes = msg.power_envelopes as RawPowerEnvelope[] | undefined
  if (!Array.isArray(envelopes) || envelopes.length === 0) return null

  const envelope = envelopes[0]
  const rawElements = envelope.power_envelope_elements ?? []

  const executionTimeMs = msg.execution_time
    ? new Date(msg.execution_time as string).getTime()
    : receivedAt
  let cursor = executionTimeMs
  const elements: ScheduleElement[] = rawElements.map((el) => {
    const startMs = cursor
    const endMs = cursor + el.duration
    cursor = endMs
    return {
      startMs,
      endMs,
      duration: el.duration,
      lowerBound: el.lower_limit ?? null,
      upperBound: el.upper_limit ?? null
    }
  })

  return {
    receivedAt,
    cemId,
    instructionId: msg.id as string,
    commodityQuantity: envelope.commodity_quantity,
    elements
  }
}

/**
 * Return the element active at nowMs, or null if outside the schedule window.
 */
export function getActiveElement (schedule: PebcSchedule, nowMs: number): ScheduleElement | null {
  for (const el of schedule.elements) {
    if (nowMs >= el.startMs && nowMs < el.endMs) return el
  }
  return null
}

/**
 * Return the start time (ms) of the element that follows the currently active one,
 * or null if in the last element or outside the schedule window.
 */
export function getNextElementStart (schedule: PebcSchedule, nowMs: number): number | null {
  for (let i = 0; i < schedule.elements.length - 1; i++) {
    const el = schedule.elements[i]
    if (nowMs >= el.startMs && nowMs < el.endMs) return schedule.elements[i + 1].startMs
  }
  return null
}

/**
 * Return a copy of forecast with value_expected (and value_upper/lower_limit when present)
 * clamped to the tightest PEBC bounds overlapping each forecast element's time window.
 * Elements with no overlapping PEBC bound are passed through unchanged.
 */
export function capForecastToSchedule (forecast: PowerForecastInput, schedule: PebcSchedule): PowerForecastInput {
  let cursor = new Date(forecast.startTime).getTime()

  const elements = forecast.elements.map(el => {
    const elStart = cursor
    const elEnd = cursor + el.duration
    cursor = elEnd

    let effectiveUpper: number | null = null
    let effectiveLower: number | null = null

    for (const schedEl of schedule.elements) {
      if (elEnd <= schedEl.startMs || elStart >= schedEl.endMs) continue
      if (schedEl.upperBound !== null) {
        effectiveUpper = effectiveUpper === null ? schedEl.upperBound : Math.min(effectiveUpper, schedEl.upperBound)
      }
      if (schedEl.lowerBound !== null) {
        effectiveLower = effectiveLower === null ? schedEl.lowerBound : Math.max(effectiveLower, schedEl.lowerBound)
      }
    }

    if (effectiveUpper === null && effectiveLower === null) return el

    const power_values: PowerForecastValue[] = el.power_values.map(pv => {
      let expected = pv.value_expected
      if (effectiveUpper !== null) expected = Math.min(expected, effectiveUpper)
      if (effectiveLower !== null) expected = Math.max(expected, effectiveLower)

      const capped: PowerForecastValue = { ...pv, value_expected: expected }
      if (pv.value_upper_limit !== undefined && effectiveUpper !== null) {
        capped.value_upper_limit = Math.min(pv.value_upper_limit, effectiveUpper)
      }
      if (pv.value_lower_limit !== undefined && effectiveLower !== null) {
        capped.value_lower_limit = Math.max(pv.value_lower_limit, effectiveLower)
      }
      return capped
    })

    return { ...el, power_values }
  })

  return { ...forecast, elements }
}
