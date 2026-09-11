import { EnergyAccumulator } from '../../src/lib/s2/energy-accumulator'

const ONE_HOUR_MS = 3_600_000

describe('EnergyAccumulator', () => {
  it('returns null on a key\'s first-ever call - no prior timestamp to compute a delta from', () => {
    const acc = new EnergyAccumulator()
    expect(acc.accumulate('Ac/Power', 100, 0)).toBeNull()
  })

  it('accumulates using the previous power value and the elapsed time since the last call', () => {
    const acc = new EnergyAccumulator()
    acc.accumulate('Ac/Power', 100, 0)
    const total = acc.accumulate('Ac/Power', 150, ONE_HOUR_MS)
    expect(total).toBeCloseTo(0.1) // 100W for 1 hour = 0.1 kWh
  })

  it('keeps accumulating onto the running total across further calls', () => {
    const acc = new EnergyAccumulator()
    acc.accumulate('Ac/Power', 100, 0)
    acc.accumulate('Ac/Power', 100, ONE_HOUR_MS)
    const total = acc.accumulate('Ac/Power', 100, ONE_HOUR_MS * 2)
    expect(total).toBeCloseTo(0.2)
  })

  it('never subtracts energy for a negative previous power value', () => {
    const acc = new EnergyAccumulator()
    acc.accumulate('Ac/Power', -50, 0)
    const total = acc.accumulate('Ac/Power', 100, ONE_HOUR_MS)
    expect(total).toBe(0)
  })

  it('zero previous power contributes nothing', () => {
    const acc = new EnergyAccumulator()
    acc.accumulate('Ac/Power', 0, 0)
    const total = acc.accumulate('Ac/Power', 100, ONE_HOUR_MS)
    expect(total).toBe(0)
  })

  it('tracks multiple keys independently', () => {
    const acc = new EnergyAccumulator()
    acc.accumulate('Ac/L1/Power', 100, 0)
    acc.accumulate('Ac/L2/Power', 200, 0)

    const l1 = acc.accumulate('Ac/L1/Power', 100, ONE_HOUR_MS)
    const l2 = acc.accumulate('Ac/L2/Power', 200, ONE_HOUR_MS)

    expect(l1).toBeCloseTo(0.1)
    expect(l2).toBeCloseTo(0.2)
  })

  describe('getTotal', () => {
    it('returns 0 for a key that has never accumulated', () => {
      const acc = new EnergyAccumulator()
      expect(acc.getTotal('Ac/Power')).toBe(0)
    })

    it('returns the current running total without requiring another accumulate() call', () => {
      const acc = new EnergyAccumulator()
      acc.accumulate('Ac/Power', 100, 0)
      acc.accumulate('Ac/Power', 100, ONE_HOUR_MS)
      expect(acc.getTotal('Ac/Power')).toBeCloseTo(0.1)
    })
  })
})
