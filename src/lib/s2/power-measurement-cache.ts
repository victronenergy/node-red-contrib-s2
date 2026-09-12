export type PowerMeasurementValue = { commodity_quantity: string, value: number }

/** Maps a measurement type (plus, for `L1_L2_L3`, phase count/wiring) to the D-Bus property
 * key(s) read from input and sent to S2, and each one's S2 commodity quantity. A single-phase
 * device resolves `L1_L2_L3` to just its wired line, never a fabricated `Ac/L1/Power`/`Ac/L3/Power`. */
export function resolveMeasurementProps (measurementType: string, nrOfPhases = 1, phaseSetting = 1): Record<string, string> {
  if (measurementType === '3_PHASE_SYMMETRIC') {
    return { 'Ac/Power': 'ELECTRIC.POWER.3_PHASE_SYMMETRIC' }
  }
  if (measurementType === 'L1_L2_L3') {
    if (nrOfPhases === 1) {
      return { [`Ac/L${phaseSetting}/Power`]: `ELECTRIC.POWER.L${phaseSetting}` }
    }
    const props: Record<string, string> = {}
    for (let i = 1; i <= nrOfPhases; i++) {
      props[`Ac/L${i}/Power`] = `ELECTRIC.POWER.L${i}`
    }
    return props
  }
  return {}
}

export interface PowerMeasurementUpdate {
  /** Raw {D-Bus key: value} pairs this payload updated - for exposing on D-Bus, independent of
   * whether S2 measurement is currently active. Only the keys this call actually changed. */
  raw: Record<string, number>
  /** S2-shaped snapshot of every cached value, to relay to the CEM - null if measurement isn't
   * currently active for a CEM, or if this call changed nothing. */
  s2Values: PowerMeasurementValue[] | null
  /** Set when `values` couldn't be applied (e.g. an array on a single-phase device); callers should surface this via their own node.warn(). */
  warning?: string
}

/**
 * PowerMeasurementCache - caches the latest power measurement value(s) fed to a node's input.
 * Two independent consumers of the same cache: (1) while active (between a CEM's
 * PowerMeasurementStart and PowerMeasurementStop), report the full snapshot to the CEM on every
 * update; (2) always, regardless of S2 activity, the raw values are available for exposing as
 * real D-Bus BusItem properties. Shared by s2-dbus and s2-resource's Transport: D-Bus path so
 * both relay measurements identically without duplicating the logic.
 *
 * Accepts either the raw D-Bus-key shape (`{ 'Ac/Power': 1800 }`) or a friendlier `values` shape
 * (`{ values: 10 | [11, 22, 33] }`) whose meaning depends on measurement type/phase count - see update() below.
 */
export class PowerMeasurementCache {
  private readonly measurementType: string
  private readonly props: Record<string, string>
  private active = false
  private readonly values = new Map<string, number>()

  constructor (measurementType: string, nrOfPhases = 1, phaseSetting = 1) {
    this.measurementType = measurementType
    this.props = resolveMeasurementProps(measurementType, nrOfPhases, phaseSetting)
  }

  /** Caches matching keys (either input shape) and derives Ac/Power <-> per-phase; null if the payload matched neither shape. */
  update (payload: Record<string, unknown>): PowerMeasurementUpdate | null {
    const raw: Record<string, number> = {}
    let warning: string | undefined
    const setValue = (key: string, value: number): void => {
      this.values.set(key, value)
      raw[key] = value
    }

    // Raw D-Bus-key shape - whatever's actually sent to S2 as an independent commodity.
    for (const key of Object.keys(this.props)) {
      if (typeof payload[key] === 'number') setValue(key, payload[key] as number)
    }

    // `values` shape.
    const values = (payload as { values?: unknown }).values
    if (values !== undefined) {
      if (this.measurementType === 'L1_L2_L3') {
        const phaseKeys = Object.keys(this.props)
        if (phaseKeys.length === 1) {
          if (typeof values === 'number') {
            setValue(phaseKeys[0], values)
          } else {
            // A genuinely single-phase device has no second/third line to attribute array elements to.
            warning = 'values array input is not supported for a single-phase device (nrOfPhases: 1) - use a scalar value instead'
          }
        } else if (Array.isArray(values) && values.length === phaseKeys.length && values.every((v) => typeof v === 'number')) {
          phaseKeys.forEach((key, i) => setValue(key, values[i] as number))
        } else {
          // A scalar is deliberately rejected too (not broadcast) - which line each phase should
          // report is ambiguous for a per-phase measurement, unlike 3-phase-symmetric below.
          warning = `values must be an array of exactly ${phaseKeys.length} numbers (one per phase) for a per-phase measurement`
        }
      } else if (this.measurementType === '3_PHASE_SYMMETRIC') {
        if (typeof values === 'number') {
          setValue('Ac/Power', values)
        } else if (Array.isArray(values) && values.length === 3 && values.every((v) => typeof v === 'number')) {
          const [l1, l2, l3] = values as number[]
          setValue('Ac/L1/Power', l1)
          setValue('Ac/L2/Power', l2)
          setValue('Ac/L3/Power', l3)
          setValue('Ac/Power', l1 + l2 + l3)
        } else {
          warning = 'values array for 3-phase symmetric measurement must have exactly 3 numbers'
        }
      }
    }

    // Ac/Power is recomputed from every cached per-phase value, never tracked as independent state.
    if (this.measurementType === 'L1_L2_L3') {
      const phaseKeys = Object.keys(this.props)
      if (phaseKeys.some((key) => key in raw)) {
        setValue('Ac/Power', phaseKeys.reduce((sum, key) => sum + (this.values.get(key) || 0), 0))
      }
    }

    // Skipped when an array already set the per-phase values directly above.
    if (this.measurementType === '3_PHASE_SYMMETRIC' && 'Ac/Power' in raw && !('Ac/L1/Power' in raw)) {
      const perPhase = raw['Ac/Power'] / 3
      setValue('Ac/L1/Power', perPhase)
      setValue('Ac/L2/Power', perPhase)
      setValue('Ac/L3/Power', perPhase)
    }

    if (Object.keys(raw).length === 0 && !warning) return null
    return {
      raw,
      s2Values: Object.keys(raw).length > 0 && this.active ? this.buildS2Values() : null,
      ...(warning ? { warning } : {})
    }
  }

  /** Mark measurement as active; returns the current S2-shaped snapshot immediately, if any
   * value is cached. */
  start (): PowerMeasurementValue[] | null {
    this.active = true
    return this.buildS2Values()
  }

  stop (): void {
    this.active = false
  }

  private buildS2Values (): PowerMeasurementValue[] | null {
    const values: PowerMeasurementValue[] = []
    for (const [key, commodityQuantity] of Object.entries(this.props)) {
      const v = this.values.get(key)
      if (v !== undefined) values.push({ commodity_quantity: commodityQuantity, value: v })
    }
    return values.length > 0 ? values : null
  }
}
