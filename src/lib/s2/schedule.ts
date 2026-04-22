'use strict'

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
  elements: RawEnvelopeElement[]
}

/**
 * Parse a PEBC.Instruction message into a PebcSchedule with absolute timestamps.
 * Returns null if the message contains no usable power_envelopes.
 */
export function parsePebcInstruction (msg: Record<string, unknown>, receivedAt: number, cemId = ''): PebcSchedule | null {
  const envelopes = msg.power_envelopes as RawPowerEnvelope[] | undefined
  if (!Array.isArray(envelopes) || envelopes.length === 0) return null

  const envelope = envelopes[0]
  const rawElements = envelope.elements ?? []

  let cursor = receivedAt
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
