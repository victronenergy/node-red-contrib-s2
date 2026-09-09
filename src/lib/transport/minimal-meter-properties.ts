/**
 * The "minimal meter" D-Bus BusItem shape node-red-contrib-victron's virtual acload/heatpump
 * devices expose (see https://github.com/victronenergy/venus/wiki/dbus#grid-and-genset-and-acload-and-heatpump-meter,
 * plus Ac/Frequency which that page omits) - reproduced here so s2-dbus/s2-resource's D-Bus
 * transport registers the same paths the Victron UI (VRM, the GX device list) expects to find on
 * any acload/heatpump service, not just the S2-specific ones.
 *
 * Values this module has no real data source for (everything except Connected/DeviceType/
 * ErrorCode/NrOfPhases/Position/PhaseSetting, which are genuinely known at registration time) are
 * initialized to `null` - dbus-victron-virtual's convention for "declared but not yet known",
 * wrapped on the wire as an empty/invalid BusItem value rather than a fabricated reading. Callers
 * that do have a real value for one of these paths (e.g. S2DbusTransport's own measurementType-
 * driven Ac/Power tracking) should overwrite the corresponding definition entry afterward.
 */

export type MinimalMeterPosition = 0 | 1 // 0 = AC output, 1 = AC input

export interface MinimalMeterOptions {
  /** 1-3. A single phase (nrOfPhases === 1) reports under whichever line phaseSetting names,
   * instead of always L1. */
  nrOfPhases: number
  position: MinimalMeterPosition
  /** Which physical line (1-3) a single-phase device is wired to. Only meaningful/declared when
   * nrOfPhases === 1. */
  phaseSetting?: number
}

export interface MinimalMeterShape {
  properties: Record<string, unknown>
  definition: Record<string, unknown>
}

const PHASE_PROPS: Array<{ name: string, unit: string }> = [
  { name: 'Current', unit: 'A' },
  { name: 'Energy/Forward', unit: 'kWh' },
  { name: 'Energy/Reverse', unit: 'kWh' },
  { name: 'Power', unit: 'W' },
  { name: 'PowerFactor', unit: '' },
  { name: 'Voltage', unit: 'V' }
]

function unknownNumberFormat (unit: string): (v: unknown) => string {
  return (v: unknown) => v != null ? Number(v).toFixed(2) + unit : ''
}

export function buildMinimalMeterShape (opts: MinimalMeterOptions): MinimalMeterShape {
  const properties: Record<string, unknown> = {
    'Ac/Energy/Forward': { type: 'd', format: unknownNumberFormat('kWh') },
    'Ac/Energy/Reverse': { type: 'd', format: unknownNumberFormat('kWh') },
    'Ac/Frequency': { type: 'd', format: unknownNumberFormat('Hz') },
    'Ac/Power': { type: 'd', format: unknownNumberFormat('W') },
    'Ac/PowerFactor': { type: 'd', format: unknownNumberFormat('') },
    Connected: { type: 'i' },
    DeviceType: { type: 'i' },
    ErrorCode: { type: 'i' },
    IsGenericEnergyMeter: { type: 'i' },
    NrOfPhases: { type: 'i' },
    Position: { type: 'i', format: (v: unknown) => ({ 0: 'AC output', 1: 'AC input' } as Record<number, string>)[v as number] || 'unknown' }
  }
  const definition: Record<string, unknown> = {
    'Ac/Energy/Forward': null,
    'Ac/Energy/Reverse': null,
    'Ac/Frequency': null,
    'Ac/Power': null,
    'Ac/PowerFactor': null,
    Connected: 1,
    DeviceType: 0,
    ErrorCode: 0,
    IsGenericEnergyMeter: 0,
    NrOfPhases: opts.nrOfPhases,
    Position: opts.position
  }

  const isSinglePhase = opts.nrOfPhases === 1
  if (isSinglePhase) {
    properties.PhaseSetting = { type: 'i', format: (v: unknown) => v != null ? 'L' + v : '' }
    definition.PhaseSetting = opts.phaseSetting ?? 1
  }

  for (let i = 1; i <= opts.nrOfPhases; i++) {
    const phase = isSinglePhase ? (opts.phaseSetting ?? 1) : i
    for (const { name, unit } of PHASE_PROPS) {
      const key = `Ac/L${phase}/${name}`
      properties[key] = { type: 'd', format: unknownNumberFormat(unit) }
      definition[key] = null
    }
  }

  return { properties, definition }
}
