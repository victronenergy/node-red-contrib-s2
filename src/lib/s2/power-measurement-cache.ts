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
  /** Set when `values` couldn't be applied; callers should surface this via their own node.warn(). */
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
 * (`{ values: 10 | [11, 22, 33] }`). When `values` is absent, `commodityPower` can provide
 * S2-shaped commodity/value entries; `values` takes precedence when both are present.
 */
export class PowerMeasurementCache {
  private readonly measurementType: string
  private readonly nrOfPhases: number
  private readonly props: Record<string, string>
  private active = false
  private readonly values = new Map<string, number>()

  constructor (measurementType: string, nrOfPhases = 1, phaseSetting = 1) {
    this.measurementType = measurementType
    this.nrOfPhases = nrOfPhases
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

    // A single-phase device has only one line, so its wired-phase key (e.g. `Ac/L2/Power`) and
    // the generic `Ac/Power` mean the same physical reading - accept either as raw-key input,
    // unlike a multi-phase device where `Ac/Power` alone would be ambiguous.
    if (this.measurementType === 'L1_L2_L3' && this.nrOfPhases === 1 && typeof payload['Ac/Power'] === 'number') {
      const [phaseKey] = Object.keys(this.props)
      if (phaseKey && !(phaseKey in raw)) setValue(phaseKey, payload['Ac/Power'] as number)
    }

    // `values` shape.
    const hasValues = Object.prototype.hasOwnProperty.call(payload, 'values')
    const hasCommodityPower = Object.prototype.hasOwnProperty.call(payload, 'commodityPower')
    const valuesKey = hasValues ? 'values' : hasCommodityPower ? 'commodityPower' : undefined
    const values = valuesKey ? payload[valuesKey] : undefined
    if (valuesKey) {
      if (values === null || values === 0) {
        const phaseKeys = Object.keys(this.props)
        if (this.measurementType === 'L1_L2_L3') {
          phaseKeys.forEach(key => setValue(key, 0))
        } else if (this.measurementType === '3_PHASE_SYMMETRIC') {
          setValue('Ac/Power', 0)
        }
      } else if (valuesKey === 'commodityPower') {
        // Native S2 shape (PowerMeasurementValue[]) - never falls through to the generic
        // scalar/array-of-numbers branches below, which are for the friendly `values` shape only
        // and would otherwise silently misinterpret a malformed commodityPower payload (e.g. a
        // bare number) as a valid scalar reading.
        if (Array.isArray(values) && values.length > 0 && values.every((value) => {
          const item = value as Record<string, unknown>
          return item !== null && typeof item === 'object' && typeof item.commodity_quantity === 'string' && typeof item.value === 'number'
        })) {
          const commodityValues = values as PowerMeasurementValue[]
          const byCommodity = new Map(commodityValues.map(value => [value.commodity_quantity, value.value]))
          if (this.measurementType === '3_PHASE_SYMMETRIC') {
            const symmetric = byCommodity.get('ELECTRIC.POWER.3_PHASE_SYMMETRIC')
            if (symmetric !== undefined) {
              setValue('Ac/Power', symmetric)
            } else {
              const phaseValues = ['L1', 'L2', 'L3'].map(phase => byCommodity.get(`ELECTRIC.POWER.${phase}`) || 0)
              if (phaseValues.some((value, index) => byCommodity.has(`ELECTRIC.POWER.L${index + 1}`))) {
                phaseValues.forEach((value, index) => setValue(`Ac/L${index + 1}/Power`, value))
                setValue('Ac/Power', phaseValues.reduce((sum, value) => sum + value, 0))
              }
            }
          } else if (this.measurementType === 'L1_L2_L3') {
            const phaseKeys = Object.keys(this.props)
            phaseKeys.forEach(key => {
              const commodity = this.props[key]
              const value = byCommodity.get(commodity)
              if (value !== undefined) setValue(key, value)
            })
          }
        } else {
          warning = 'commodityPower must be a non-empty array of { commodity_quantity, value } entries'
        }
      } else if (this.measurementType === 'L1_L2_L3') {
        const phaseKeys = Object.keys(this.props)
        if (phaseKeys.length === 1) {
          if (typeof values === 'number') {
            setValue(phaseKeys[0], values)
          } else if (Array.isArray(values) && values.length === 3 && values.every((v) => typeof v === 'number')) {
            const phaseIndex = Number(phaseKeys[0].match(/L(\d)/)?.[1]) - 1
            setValue(phaseKeys[0], values[phaseIndex] as number)
            warning = `values array of length 3 reduced to wired phase (${phaseKeys[0]})`
          } else if (Array.isArray(values) && values.length === 1 && typeof values[0] === 'number') {
            setValue(phaseKeys[0], values[0])
          } else {
            warning = 'values for a single-phase device (nrOfPhases: 1) must be a scalar, a 1-element array, or a 3-element array'
          }
        } else if (Array.isArray(values) && values.length === phaseKeys.length && values.every((v) => typeof v === 'number')) {
          phaseKeys.forEach((key, i) => setValue(key, values[i] as number))
        } else if (phaseKeys.length === 3 && typeof values === 'number') {
          const perPhase = values / 3
          phaseKeys.forEach(key => setValue(key, perPhase))
          warning = 'scalar divided equally across L1, L2, and L3'
        } else {
          warning = `values must be a scalar or an array of exactly ${phaseKeys.length} numbers (one per phase)`
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
          warning = 'three values summed for 3-phase symmetric power'
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
