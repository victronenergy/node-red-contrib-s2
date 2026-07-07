import { parsePebcInstruction, getActiveElement, getNextElementStart, capForecastToSchedule } from '../../src/lib/s2/schedule'
import type { PowerForecastInput } from '../../src/lib/s2/messages'

const SLOT = 900_000 // 15 min in ms

function makeInstruction (elements: Array<{ duration: number, upper_limit?: number | null, lower_limit?: number | null }>, id = 'instr-1', execution_time?: string) {
  return {
    message_type: 'PEBC.Instruction',
    message_id: 'msg-1',
    id,
    ...(execution_time ? { execution_time } : {}),
    power_envelopes: [
      {
        id: 'env-1',
        commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC',
        power_envelope_elements: elements
      }
    ]
  }
}

describe('parsePebcInstruction', () => {
  const base = 1_000_000_000_000 // arbitrary epoch ms

  it('returns null for a message with no power_envelopes', () => {
    expect(parsePebcInstruction({ message_type: 'PEBC.Instruction', message_id: 'x', id: 'y', power_envelopes: [] }, base)).toBeNull()
  })

  it('computes absolute start/end times from receivedAt', () => {
    const msg = makeInstruction([
      { duration: SLOT, upper_limit: 2000, lower_limit: -500 },
      { duration: SLOT, upper_limit: 1500, lower_limit: 0 }
    ])
    const schedule = parsePebcInstruction(msg, base)!
    expect(schedule.elements[0].startMs).toBe(base)
    expect(schedule.elements[0].endMs).toBe(base + SLOT)
    expect(schedule.elements[1].startMs).toBe(base + SLOT)
    expect(schedule.elements[1].endMs).toBe(base + 2 * SLOT)
  })

  it('maps upper_limit and lower_limit to upperBound and lowerBound', () => {
    const msg = makeInstruction([{ duration: SLOT, upper_limit: 3000, lower_limit: -1000 }])
    const schedule = parsePebcInstruction(msg, base)!
    expect(schedule.elements[0].upperBound).toBe(3000)
    expect(schedule.elements[0].lowerBound).toBe(-1000)
  })

  it('preserves null limits', () => {
    const msg = makeInstruction([{ duration: SLOT, upper_limit: null, lower_limit: null }])
    const schedule = parsePebcInstruction(msg, base)!
    expect(schedule.elements[0].upperBound).toBeNull()
    expect(schedule.elements[0].lowerBound).toBeNull()
  })

  it('stores receivedAt, instructionId, and commodityQuantity', () => {
    const msg = makeInstruction([{ duration: SLOT }], 'instr-42')
    const schedule = parsePebcInstruction(msg, base)!
    expect(schedule.receivedAt).toBe(base)
    expect(schedule.instructionId).toBe('instr-42')
    expect(schedule.commodityQuantity).toBe('ELECTRIC.POWER.3_PHASE_SYMMETRIC')
  })

  it('uses execution_time as the slot anchor when present', () => {
    const execTime = base + 5_000_000
    const msg = makeInstruction([{ duration: SLOT }], 'instr-et', new Date(execTime).toISOString())
    const schedule = parsePebcInstruction(msg, base)!
    expect(schedule.elements[0].startMs).toBe(execTime)
    expect(schedule.elements[0].endMs).toBe(execTime + SLOT)
  })

  it('falls back to receivedAt when execution_time is absent', () => {
    const msg = makeInstruction([{ duration: SLOT }])
    const schedule = parsePebcInstruction(msg, base)!
    expect(schedule.elements[0].startMs).toBe(base)
  })

  it('uses first power_envelope when multiple are present', () => {
    const msg = {
      message_type: 'PEBC.Instruction',
      message_id: 'msg-1',
      id: 'instr-1',
      power_envelopes: [
        { id: 'env-a', commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', power_envelope_elements: [{ duration: SLOT, upper_limit: 100, lower_limit: 0 }] },
        { id: 'env-b', commodity_quantity: 'ELECTRIC.POWER.L1', power_envelope_elements: [{ duration: SLOT, upper_limit: 200, lower_limit: 0 }] }
      ]
    }
    const schedule = parsePebcInstruction(msg, base)!
    expect(schedule.commodityQuantity).toBe('ELECTRIC.POWER.3_PHASE_SYMMETRIC')
    expect(schedule.elements[0].upperBound).toBe(100)
  })
})

describe('getActiveElement', () => {
  const base = 1_000_000_000_000
  const msg = makeInstruction([
    { duration: SLOT, upper_limit: 1000, lower_limit: 0 },
    { duration: SLOT, upper_limit: 2000, lower_limit: -500 },
    { duration: SLOT, upper_limit: 500,  lower_limit: 0 }
  ])

  let schedule: ReturnType<typeof parsePebcInstruction>
  beforeEach(() => { schedule = parsePebcInstruction(msg, base) })

  it('returns the first element at receivedAt', () => {
    const el = getActiveElement(schedule!, base)!
    expect(el.upperBound).toBe(1000)
  })

  it('returns the first element mid-slot', () => {
    const el = getActiveElement(schedule!, base + SLOT / 2)!
    expect(el.upperBound).toBe(1000)
  })

  it('returns the second element at the slot boundary', () => {
    const el = getActiveElement(schedule!, base + SLOT)!
    expect(el.upperBound).toBe(2000)
  })

  it('returns the last element', () => {
    const el = getActiveElement(schedule!, base + 2 * SLOT)!
    expect(el.upperBound).toBe(500)
  })

  it('returns null before the schedule starts', () => {
    expect(getActiveElement(schedule!, base - 1)).toBeNull()
  })

  it('returns null after the schedule ends', () => {
    expect(getActiveElement(schedule!, base + 3 * SLOT)).toBeNull()
  })
})

describe('getNextElementStart', () => {
  const base = 1_000_000_000_000
  const msg = makeInstruction([
    { duration: SLOT, upper_limit: 1000, lower_limit: 0 },
    { duration: SLOT, upper_limit: 2000, lower_limit: -500 }
  ])

  let schedule: ReturnType<typeof parsePebcInstruction>
  beforeEach(() => { schedule = parsePebcInstruction(msg, base) })

  it('returns the start of the second element while in the first', () => {
    expect(getNextElementStart(schedule!, base)).toBe(base + SLOT)
  })

  it('returns the start of the second element mid-slot', () => {
    expect(getNextElementStart(schedule!, base + SLOT / 2)).toBe(base + SLOT)
  })

  it('returns null when in the last element (nothing follows)', () => {
    expect(getNextElementStart(schedule!, base + SLOT)).toBeNull()
  })

  it('returns null when schedule has not started', () => {
    expect(getNextElementStart(schedule!, base - 1)).toBeNull()
  })

  it('returns null when schedule has ended', () => {
    expect(getNextElementStart(schedule!, base + 2 * SLOT)).toBeNull()
  })
})

describe('capForecastToSchedule', () => {
  const base = 1_000_000_000_000

  function makeSchedule (elements: Array<{ startMs: number, endMs: number, upper: number | null, lower: number | null }>): ReturnType<typeof parsePebcInstruction> {
    return {
      receivedAt: base,
      cemId: 'cem-1',
      instructionId: 'instr-1',
      commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC',
      elements: elements.map(e => ({
        startMs: e.startMs,
        endMs: e.endMs,
        duration: e.endMs - e.startMs,
        upperBound: e.upper,
        lowerBound: e.lower
      }))
    }
  }

  function makeForecast (startMs: number, slots: number[]): PowerForecastInput {
    return {
      startTime: new Date(startMs).toISOString(),
      elements: slots.map(v => ({
        duration: SLOT,
        power_values: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value_expected: v }]
      }))
    }
  }

  it('caps value_expected at upperBound when forecast exceeds it', () => {
    const schedule = makeSchedule([{ startMs: base, endMs: base + SLOT, upper: 4000, lower: -4000 }])!
    const forecast = makeForecast(base, [6000])
    const result = capForecastToSchedule(forecast, schedule)
    expect(result.elements[0].power_values[0].value_expected).toBe(4000)
  })

  it('caps value_expected at lowerBound when forecast is below it', () => {
    const schedule = makeSchedule([{ startMs: base, endMs: base + SLOT, upper: 4000, lower: -4000 }])!
    const forecast = makeForecast(base, [-6000])
    const result = capForecastToSchedule(forecast, schedule)
    expect(result.elements[0].power_values[0].value_expected).toBe(-4000)
  })

  it('leaves value_expected unchanged when within bounds', () => {
    const schedule = makeSchedule([{ startMs: base, endMs: base + SLOT, upper: 4000, lower: -4000 }])!
    const forecast = makeForecast(base, [2000])
    const result = capForecastToSchedule(forecast, schedule)
    expect(result.elements[0].power_values[0].value_expected).toBe(2000)
  })

  it('leaves forecast elements unchanged when no PEBC element overlaps', () => {
    const schedule = makeSchedule([{ startMs: base + 2 * SLOT, endMs: base + 3 * SLOT, upper: 1000, lower: -1000 }])!
    const forecast = makeForecast(base, [8000])
    const result = capForecastToSchedule(forecast, schedule)
    expect(result.elements[0].power_values[0].value_expected).toBe(8000)
  })

  it('applies tightest bound when forecast element overlaps multiple PEBC elements', () => {
    const schedule = makeSchedule([
      { startMs: base, endMs: base + SLOT, upper: 4000, lower: -4000 },
      { startMs: base + SLOT, endMs: base + 2 * SLOT, upper: 2000, lower: -2000 }
    ])!
    // 2-hour forecast slot spanning both 15-min PEBC slots
    const forecast: PowerForecastInput = {
      startTime: new Date(base).toISOString(),
      elements: [{ duration: 2 * SLOT, power_values: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value_expected: 5000 }] }]
    }
    const result = capForecastToSchedule(forecast, schedule)
    expect(result.elements[0].power_values[0].value_expected).toBe(2000)
  })

  it('caps value_upper_limit and value_lower_limit when present', () => {
    const schedule = makeSchedule([{ startMs: base, endMs: base + SLOT, upper: 4000, lower: -4000 }])!
    const forecast: PowerForecastInput = {
      startTime: new Date(base).toISOString(),
      elements: [{
        duration: SLOT,
        power_values: [{
          commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC',
          value_expected: 3000,
          value_upper_limit: 6000,
          value_lower_limit: -6000
        }]
      }]
    }
    const result = capForecastToSchedule(forecast, schedule)
    const pv = result.elements[0].power_values[0]
    expect(pv.value_upper_limit).toBe(4000)
    expect(pv.value_lower_limit).toBe(-4000)
  })

  it('handles null PEBC bounds by not capping that direction', () => {
    const schedule = makeSchedule([{ startMs: base, endMs: base + SLOT, upper: 3000, lower: null }])!
    const forecast = makeForecast(base, [-9000])
    const result = capForecastToSchedule(forecast, schedule)
    expect(result.elements[0].power_values[0].value_expected).toBe(-9000)
  })
})
