export type PowerMeasurementValue = { commodity_quantity: string, value: number }

/** Maps a configured measurement type to the D-Bus-style property keys it reads from input
 * messages, and the S2 commodity quantity each one reports as. Same vocabulary
 * node-red-contrib-victron's s2-support.js uses, for consistency of shape - these keys are also
 * the ones exposed as real D-Bus BusItem properties (see S2DbusTransport's measurementType
 * option), unlike s2-support.js's own measurement handling which is S2-only. */
export const MEASUREMENT_TYPE_TO_PROPS: Record<string, Record<string, string>> = {
  '3_PHASE_SYMMETRIC': { 'Ac/Power': 'ELECTRIC.POWER.3_PHASE_SYMMETRIC' },
  L1_L2_L3: {
    'Ac/L1/Power': 'ELECTRIC.POWER.L1',
    'Ac/L2/Power': 'ELECTRIC.POWER.L2',
    'Ac/L3/Power': 'ELECTRIC.POWER.L3'
  }
}

export interface PowerMeasurementUpdate {
  /** Raw {D-Bus key: value} pairs this payload updated - for exposing on D-Bus, independent of
   * whether S2 measurement is currently active. Only the keys this call actually changed. */
  raw: Record<string, number>
  /** S2-shaped snapshot of every cached value, to relay to the CEM - null if measurement isn't
   * currently active for a CEM. */
  s2Values: PowerMeasurementValue[] | null
}

/**
 * PowerMeasurementCache - caches the latest power measurement value(s) fed to a node's input.
 * Two independent consumers of the same cache: (1) while active (between a CEM's
 * PowerMeasurementStart and PowerMeasurementStop), report the full snapshot to the CEM on every
 * update; (2) always, regardless of S2 activity, the raw values are available for exposing as
 * real D-Bus BusItem properties. Shared by s2-dbus and s2-resource's Transport: D-Bus path so
 * both relay measurements identically without duplicating the logic.
 */
export class PowerMeasurementCache {
  private readonly props: Record<string, string>
  private active = false
  private readonly values = new Map<string, number>()

  constructor (measurementType: string) {
    this.props = MEASUREMENT_TYPE_TO_PROPS[measurementType] || {}
  }

  /** Cache any matching keys in the payload. Returns null if the payload matched none of the
   * configured measurement keys. */
  update (payload: Record<string, unknown>): PowerMeasurementUpdate | null {
    const raw: Record<string, number> = {}
    for (const key of Object.keys(this.props)) {
      if (typeof payload[key] === 'number') {
        this.values.set(key, payload[key] as number)
        raw[key] = payload[key] as number
      }
    }
    if (Object.keys(raw).length === 0) return null
    return { raw, s2Values: this.active ? this.buildS2Values() : null }
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
