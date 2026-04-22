import { parsePebcInstruction, getActiveElement, getNextElementStart } from '../../src/lib/s2/schedule'

const SLOT = 900_000 // 15 min in ms

function makeInstruction (elements: Array<{ duration: number, upper_limit?: number | null, lower_limit?: number | null }>, id = 'instr-1') {
  return {
    message_type: 'PEBC.Instruction',
    message_id: 'msg-1',
    id,
    power_envelopes: [
      {
        id: 'env-1',
        commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC',
        elements
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

  it('uses first power_envelope when multiple are present', () => {
    const msg = {
      message_type: 'PEBC.Instruction',
      message_id: 'msg-1',
      id: 'instr-1',
      power_envelopes: [
        { id: 'env-a', commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', elements: [{ duration: SLOT, upper_limit: 100, lower_limit: 0 }] },
        { id: 'env-b', commodity_quantity: 'ELECTRIC.POWER.L1', elements: [{ duration: SLOT, upper_limit: 200, lower_limit: 0 }] }
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
