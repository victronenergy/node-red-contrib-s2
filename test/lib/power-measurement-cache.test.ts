import { PowerMeasurementCache, resolveMeasurementProps } from '../../src/lib/s2/power-measurement-cache'

describe('resolveMeasurementProps', () => {
  it('resolves L1_L2_L3 with nrOfPhases: 1 to a single key/commodity for the wired phase', () => {
    expect(resolveMeasurementProps('L1_L2_L3', 1, 2)).toEqual({ 'Ac/L2/Power': 'ELECTRIC.POWER.L2' })
  })

  it('resolves L1_L2_L3 with nrOfPhases: 2 to two keys', () => {
    expect(resolveMeasurementProps('L1_L2_L3', 2)).toEqual({
      'Ac/L1/Power': 'ELECTRIC.POWER.L1',
      'Ac/L2/Power': 'ELECTRIC.POWER.L2'
    })
  })

  it('resolves L1_L2_L3 with nrOfPhases: 3 to three keys', () => {
    expect(resolveMeasurementProps('L1_L2_L3', 3)).toEqual({
      'Ac/L1/Power': 'ELECTRIC.POWER.L1',
      'Ac/L2/Power': 'ELECTRIC.POWER.L2',
      'Ac/L3/Power': 'ELECTRIC.POWER.L3'
    })
  })

  it('resolves 3_PHASE_SYMMETRIC to a single Ac/Power key regardless of nrOfPhases', () => {
    expect(resolveMeasurementProps('3_PHASE_SYMMETRIC', 1)).toEqual({ 'Ac/Power': 'ELECTRIC.POWER.3_PHASE_SYMMETRIC' })
    expect(resolveMeasurementProps('3_PHASE_SYMMETRIC', 3)).toEqual({ 'Ac/Power': 'ELECTRIC.POWER.3_PHASE_SYMMETRIC' })
  })

  it('resolves an unrecognized/empty measurementType to no props', () => {
    expect(resolveMeasurementProps('')).toEqual({})
    expect(resolveMeasurementProps('nonsense')).toEqual({})
  })
})

describe('PowerMeasurementCache - raw D-Bus-key input (unchanged shape)', () => {
  it('caches a matching key and returns it in raw', () => {
    const cache = new PowerMeasurementCache('L1_L2_L3', 1, 2)
    const update = cache.update({ 'Ac/L2/Power': 1500 })
    expect(update?.raw).toEqual({ 'Ac/L2/Power': 1500, 'Ac/Power': 1500 })
  })

  it('returns null when the payload matches no configured key and has no values field', () => {
    const cache = new PowerMeasurementCache('L1_L2_L3', 1, 2)
    expect(cache.update({ somethingElse: 1 })).toBeNull()
  })

  it('returns null for a measurementType of "" (None)', () => {
    const cache = new PowerMeasurementCache('')
    expect(cache.update({ 'Ac/Power': 1500 })).toBeNull()
  })
})

describe('PowerMeasurementCache - values shape, L1_L2_L3, nrOfPhases: 1', () => {
  it('scalar values maps to the wired phase and aggregates into Ac/Power', () => {
    const cache = new PowerMeasurementCache('L1_L2_L3', 1, 2)
    const update = cache.update({ values: 10 })
    expect(update?.raw).toEqual({ 'Ac/L2/Power': 10, 'Ac/Power': 10 })
    expect(update?.warning).toBeUndefined()
  })

  it('rejects an array values input with a warning and no cache changes', () => {
    const cache = new PowerMeasurementCache('L1_L2_L3', 1, 2)
    const update = cache.update({ values: [11, 22, 33] })
    expect(update?.raw).toEqual({})
    expect(update?.warning).toMatch(/single-phase/)
  })

  it('a subsequent valid update after a rejection is unaffected', () => {
    const cache = new PowerMeasurementCache('L1_L2_L3', 1, 2)
    cache.update({ values: [11, 22, 33] })
    const update = cache.update({ values: 5 })
    expect(update?.raw).toEqual({ 'Ac/L2/Power': 5, 'Ac/Power': 5 })
  })
})

describe('PowerMeasurementCache - values shape, L1_L2_L3, nrOfPhases: 2/3', () => {
  it('array values of matching length maps element-by-element and aggregates', () => {
    const cache = new PowerMeasurementCache('L1_L2_L3', 3)
    const update = cache.update({ values: [11, 22, 33] })
    expect(update?.raw).toEqual({ 'Ac/L1/Power': 11, 'Ac/L2/Power': 22, 'Ac/L3/Power': 33, 'Ac/Power': 66 })
  })

  it('scalar values broadcasts to every declared phase', () => {
    const cache = new PowerMeasurementCache('L1_L2_L3', 2)
    const update = cache.update({ values: 7 })
    expect(update?.raw).toEqual({ 'Ac/L1/Power': 7, 'Ac/L2/Power': 7, 'Ac/Power': 14 })
  })

  it('an array of the wrong length is rejected', () => {
    const cache = new PowerMeasurementCache('L1_L2_L3', 3)
    const update = cache.update({ values: [1, 2] })
    expect(update?.raw).toEqual({})
    expect(update?.warning).toBeDefined()
  })
})

describe('PowerMeasurementCache - Ac/Power aggregation (L1_L2_L3)', () => {
  it('sums only the currently-known phases, unset phases contributing 0', () => {
    const cache = new PowerMeasurementCache('L1_L2_L3', 3)

    const first = cache.update({ 'Ac/L1/Power': 100 })
    expect(first?.raw).toEqual({ 'Ac/L1/Power': 100, 'Ac/Power': 100 })

    const second = cache.update({ 'Ac/L2/Power': 200 })
    expect(second?.raw).toEqual({ 'Ac/L2/Power': 200, 'Ac/Power': 300 })
  })

  it('does not touch Ac/Power when the update matched nothing', () => {
    const cache = new PowerMeasurementCache('L1_L2_L3', 3)
    expect(cache.update({ irrelevant: 1 })).toBeNull()
  })
})

describe('PowerMeasurementCache - 3_PHASE_SYMMETRIC', () => {
  it('a scalar (raw-key shape) splits evenly across per-phase properties', () => {
    const cache = new PowerMeasurementCache('3_PHASE_SYMMETRIC', 3)
    const update = cache.update({ 'Ac/Power': 9 })
    expect(update?.raw).toEqual({ 'Ac/Power': 9, 'Ac/L1/Power': 3, 'Ac/L2/Power': 3, 'Ac/L3/Power': 3 })
  })

  it('a scalar (values shape) also splits evenly', () => {
    const cache = new PowerMeasurementCache('3_PHASE_SYMMETRIC', 3)
    const update = cache.update({ values: 9 })
    expect(update?.raw).toEqual({ 'Ac/Power': 9, 'Ac/L1/Power': 3, 'Ac/L2/Power': 3, 'Ac/L3/Power': 3 })
  })

  it('an array (values shape) writes per-phase values directly, unsplit, and sums into Ac/Power', () => {
    const cache = new PowerMeasurementCache('3_PHASE_SYMMETRIC', 3)
    const update = cache.update({ values: [11, 22, 33] })
    expect(update?.raw).toEqual({ 'Ac/L1/Power': 11, 'Ac/L2/Power': 22, 'Ac/L3/Power': 33, 'Ac/Power': 66 })
  })

  it('sends exactly one S2 commodity even when the array populated all three per-phase properties', () => {
    const cache = new PowerMeasurementCache('3_PHASE_SYMMETRIC', 3)
    cache.start()
    const update = cache.update({ values: [11, 22, 33] })
    expect(update?.s2Values).toEqual([{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: 66 }])
  })
})

describe('PowerMeasurementCache - S2 relay while active', () => {
  it('emits the cached snapshot on start()', () => {
    const cache = new PowerMeasurementCache('3_PHASE_SYMMETRIC', 3)
    cache.update({ 'Ac/Power': 42 })
    expect(cache.start()).toEqual([{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: 42 }])
  })

  it('s2Values is null while inactive', () => {
    const cache = new PowerMeasurementCache('3_PHASE_SYMMETRIC', 3)
    const update = cache.update({ 'Ac/Power': 42 })
    expect(update?.s2Values).toBeNull()
  })

  it('stop() reverts to null s2Values on later updates', () => {
    const cache = new PowerMeasurementCache('3_PHASE_SYMMETRIC', 3)
    cache.start()
    cache.stop()
    const update = cache.update({ 'Ac/Power': 42 })
    expect(update?.s2Values).toBeNull()
  })
})
