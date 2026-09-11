export const WATT_MILLISECONDS_PER_KWH = 3_600_000_000

/**
 * EnergyAccumulator - integrates a per-key Power reading over time into a running Energy Forward
 * total (kWh), reproducing node-red-contrib-victron's own virtual acload/heatpump devices'
 * accumulateDelta approach (src/nodes/victron-virtual/energy-utils.js) exactly, so both projects'
 * "auto-calculate energy" features behave identically.
 *
 * On each call for a key, the delta uses the *previous* power value and the time elapsed since
 * that key's last call - never the newly-supplied value, since that value has only just started
 * applying. Negative power never decreases the running total (matching acload's own one-directional,
 * forward-only tracking - see PowerMeasurementCache/S2DbusTransport for the "Forward" naming).
 */
export class EnergyAccumulator {
  private readonly lastPower = new Map<string, number>()
  private readonly lastTimestamp = new Map<string, number>()
  private readonly totals = new Map<string, number>()

  /** Accumulates the energy delta for `key` since its last call (using its previous power value
   * and the elapsed time to `now`), adds it onto that key's running total, records `powerValue`/
   * `now` for the next call, and returns the updated total. Returns null on a key's first-ever
   * call, since there is no prior timestamp to compute a delta from yet. */
  accumulate (key: string, powerValue: number, now: number): number | null {
    const previousPower = this.lastPower.get(key)
    const previousTimestamp = this.lastTimestamp.get(key)

    let result: number | null = null
    if (previousPower !== undefined && previousTimestamp !== undefined) {
      const deltaKwh = Math.max(0, previousPower) * (now - previousTimestamp) / WATT_MILLISECONDS_PER_KWH
      const total = (this.totals.get(key) || 0) + deltaKwh
      this.totals.set(key, total)
      result = total
    }

    this.lastPower.set(key, powerValue)
    this.lastTimestamp.set(key, now)
    return result
  }

  /** The current running total for `key` (0 if never accumulated) - for rolling up several keys'
   * totals (e.g. per-phase Energy Forward) into an aggregate without waiting for every key to be
   * touched in the same call. */
  getTotal (key: string): number {
    return this.totals.get(key) || 0
  }
}
