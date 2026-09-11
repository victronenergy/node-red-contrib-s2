import { EventEmitter } from 'events'
import * as dbus from 'dbus-native-victron'
import { addVictronInterfaces, addSettings, VictronInterfaceHandle } from 'dbus-victron-virtual'
import { resolveMeasurementProps } from '../s2/power-measurement-cache'
import { EnergyAccumulator } from '../s2/energy-accumulator'
import { buildMinimalMeterShape, MinimalMeterPosition } from './minimal-meter-properties'

export type S2DbusConnectionMode = 'auto' | 'system' | 'tcp'

export interface S2DbusTransportOptions {
  connectionMode: S2DbusConnectionMode
  /** Required when connectionMode is 'tcp'. */
  tcpAddress?: string
  /** A product type dbus-victron-virtual recognizes, e.g. 'acload' or 'heatpump'. */
  deviceType: string
  /** Used to build both the service name (com.victronenergy.<deviceType>.virtual_s2_<nodeId>)
   * and the persisted-settings path claiming a DeviceInstance. The owning Node-RED node's own
   * id (short, already unique per deployment) - not the S2 resourceId, which is typically a
   * long UUID and makes for an unwieldy service name. Matches node-red-contrib-victron's own
   * virtual-device services, which key off node.id the same way. */
  nodeId: string
  /** When set (matching a key in power-measurement-cache.ts's MEASUREMENT_TYPE_TO_PROPS), the
   * corresponding property key(s) (e.g. Ac/Power) get a real starting value (0, then live-updated
   * via setMeasurementValues()) instead of the minimal-meter shape's default `null` ("unknown") -
   * not just relayed over S2. Must be known at registration time, since a D-Bus interface's
   * property set can't change after export. Omit for no such live tracking. */
  measurementType?: string
  /** 1-3. Declares the full node-red-contrib-victron-compatible "minimal meter" D-Bus shape for
   * this many phases (see minimal-meter-properties.ts) - the Victron UI (VRM, the GX device list)
   * expects these paths on any acload/heatpump service. Defaults to 1. */
  nrOfPhases?: number
  /** AC output (0) or AC input (1), matching node-red-contrib-victron's own Position property.
   * Defaults to 0 (AC output). */
  position?: MinimalMeterPosition
  /** Which physical line (1-3) a single-phase device (nrOfPhases 1) is wired to, reported under
   * Ac/L<phaseSetting>/* instead of always Ac/L1/*. Defaults to 1. Ignored when nrOfPhases > 1. */
  phaseSetting?: number
  /** Integrates tracked Power into Ac/[L<n>/]Energy/Forward over time (see ../s2/energy-accumulator.ts); false/omitted leaves it at the minimal-meter shape's `null` default. */
  autoCalculateEnergy?: boolean
}

const MAX_ADD_SETTINGS_RETRIES = 10
const DEFAULT_DEVICE_INSTANCE = 100

/** Same substrings node-red-contrib-victron's callAddSettingsWithRetry checks for. */
function isSettingsServiceUnavailable (error: unknown): boolean {
  const message = Array.isArray(error)
    ? error.join(', ')
    : (error instanceof Error ? error.message : String(error))
  return (
    message.includes('org.freedesktop.DBus.Error.ServiceUnknown') ||
    message.includes('com.victronenergy.settings') ||
    message.includes('No such service') ||
    message.includes('was not provided by any .service files')
  )
}

async function callAddSettingsWithRetry (bus: unknown, settings: Parameters<typeof addSettings>[1]): Promise<unknown> {
  for (let attempt = 0; attempt < MAX_ADD_SETTINGS_RETRIES; attempt++) {
    try {
      return await addSettings(bus, settings)
    } catch (error) {
      if (!isSettingsServiceUnavailable(error) || attempt === MAX_ADD_SETTINGS_RETRIES - 1) {
        throw error
      }
      const delayMs = Math.min(1000 * 2 ** attempt, 10000)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  return undefined
}

/**
 * Extracts the DeviceInstance number from an AddSettings response of the form
 * "<class>:<instance>" - same two response shapes (primary + fallback) node-red-contrib-victron's
 * own getDeviceInstance handles, since the exact nesting varies with whether the setting already
 * existed. Returns null (and logs a warning) if nothing recognizable is found.
 */
function getDeviceInstance (result: unknown): number | null {
  const tryPath = (value: unknown): number | null => {
    if (typeof value !== 'string') return null
    const part = value.split(':')[1]
    if (part === undefined) return null
    const n = Number(part)
    return Number.isNaN(n) ? null : n
  }

  try {
    const r = result as { [k: number]: unknown }
    const primary = (((r?.[0] as { [k: number]: unknown })?.[2] as { [k: number]: unknown })?.[1] as { [k: number]: unknown })?.[1]
    const primaryValue = (primary as { [k: number]: unknown })?.[0]
    const n = tryPath(primaryValue)
    if (n !== null) return n
  } catch { /* fall through to the fallback shape below */ }

  try {
    const r = result as { [k: number]: unknown }
    const fallback = (r?.[1] as { [k: number]: unknown })?.[0]
    const n = tryPath(fallback)
    if (n !== null) return n
  } catch { /* fall through to the null return below */ }

  console.warn('S2DbusTransport: failed to extract a valid DeviceInstance from the settings response')
  return null
}

/**
 * S2DbusTransport registers a com.victronenergy.<deviceType>.virtual_s2_<nodeId>
 * D-Bus service exposing /S2/0/Rm (the S2-over-D-Bus session protocol), via
 * dbus-victron-virtual's built-in S2 support. Unlike S2WebSocketTransport, the RM does not
 * dial out - it registers the service and waits for a CEM to call in.
 *
 * DeviceInstance is claimed via com.victronenergy.settings (AddSettings on
 * /Settings/Devices/virtual_<nodeId>/ClassAndVrmInstance, default "<deviceType>:100"), the same
 * mechanism and default node-red-contrib-victron's virtual devices use - so the instance number
 * is stable across redeploys/restarts rather than a value the user has to pick and keep unique.
 *
 * When constructed with a measurementType, the corresponding power properties (e.g. Ac/Power)
 * are declared as real, readable D-Bus BusItem properties - so the latest value is visible to
 * anything else on the Venus system (VRM, other services), not just relayed over S2.
 *
 * Events:
 *   'open'       - service registered and D-Bus name acquired
 *   'connect'    - a CEM connected, args: (cemId: string, keepAliveInterval: number)
 *   'disconnect' - the CEM disconnected (CEM-initiated, or a KeepAlive timeout), args: (cemId: string)
 *   'message'    - raw S2 JSON string received from the CEM, args: (cemId: string, raw: string)
 *   'error'      - error occurred, arg: Error
 */
export class S2DbusTransport extends EventEmitter {
  private readonly opts: S2DbusTransportOptions
  private bus: dbus.DBusClient | undefined
  private handle: VictronInterfaceHandle | undefined
  private serviceName: string | undefined
  private readonly energyAccumulator = new EnergyAccumulator()
  // Per-phase Energy/Forward keys to roll up into Ac/Energy/Forward; empty unless autoCalculateEnergy + 'L1_L2_L3'.
  private phaseEnergyKeys: string[] = []

  constructor (opts: S2DbusTransportOptions) {
    super()
    this.opts = opts
  }

  connect (): void {
    const { connectionMode, tcpAddress } = this.opts

    if (connectionMode === 'tcp') {
      if (!tcpAddress) {
        this.emit('error', new Error('S2DbusTransport: tcpAddress is required when connectionMode is "tcp"'))
        return
      }
      this.bus = dbus.createClient({ busAddress: tcpAddress, authMethods: ['ANONYMOUS'] }, (err) => {
        if (err) this.emit('error', err)
      })
    } else if (connectionMode === 'system') {
      this.bus = dbus.systemBus({}, (err) => {
        if (err) this.emit('error', err)
      })
    } else {
      // auto: session bus if DBUS_SESSION_BUS_ADDRESS is set (dev/test), else system bus
      this.bus = process.env.DBUS_SESSION_BUS_ADDRESS
        ? dbus.sessionBus({}, (err) => { if (err) this.emit('error', err) })
        : dbus.systemBus({}, (err) => { if (err) this.emit('error', err) })
    }

    if (!this.bus) {
      this.emit('error', new Error('S2DbusTransport: could not connect to the D-Bus bus'))
      return
    }

    this.bus.connection.on('error', (err: unknown) => {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
    })

    this.claimDeviceInstanceAndRegister(this.bus).catch((err: unknown) => {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
    })
  }

  private async claimDeviceInstanceAndRegister (bus: dbus.DBusClient): Promise<void> {
    const { deviceType, nodeId } = this.opts
    // Sanitized the same way node-red-contrib-victron's sanitizeIdForDbus does - node.id is
    // already alphanumeric in practice, this is just a defensive match to that convention.
    const sanitizedNodeId = nodeId.replace(/[^A-Za-z0-9_]/g, '_')
    const serviceName = `com.victronenergy.${deviceType}.virtual_s2_${sanitizedNodeId}`
    this.serviceName = serviceName

    const settingsResult = await callAddSettingsWithRetry(bus, [
      {
        path: `/Settings/Devices/virtual_s2_${sanitizedNodeId}/ClassAndVrmInstance`,
        default: `${deviceType}:${DEFAULT_DEVICE_INSTANCE}`,
        type: 's'
      }
    ])
    const deviceInstance = getDeviceInstance(settingsResult)
    if (deviceInstance === null) {
      this.emit('error', new Error(`S2DbusTransport: could not claim a DeviceInstance for ${serviceName}`))
      return
    }

    const minimalMeter = buildMinimalMeterShape({
      nrOfPhases: this.opts.nrOfPhases ?? 1,
      position: this.opts.position ?? 0,
      phaseSetting: this.opts.phaseSetting
    })

    const measurementProps = this.opts.measurementType
      ? resolveMeasurementProps(this.opts.measurementType, this.opts.nrOfPhases ?? 1, this.opts.phaseSetting ?? 1)
      : {}
    // 3-phase-symmetric also gets a derived, D-Bus-only per-phase breakdown (see PowerMeasurementCache.update()) not in measurementProps.
    const measurementKeys = new Set(Object.keys(measurementProps))
    if (this.opts.measurementType === '3_PHASE_SYMMETRIC') {
      measurementKeys.add('Ac/L1/Power').add('Ac/L2/Power').add('Ac/L3/Power')
    }
    const measurementPropertyDecls: Record<string, unknown> = {}
    const measurementDefinition: Record<string, unknown> = {}
    for (const key of measurementKeys) {
      measurementPropertyDecls[key] = { type: 'd', format: (v: unknown) => v != null ? Number(v).toFixed(2) + 'W' : '' }
      measurementDefinition[key] = 0
    }

    // Based on measurementProps, not measurementKeys - a 3-phase-symmetric device's derived per-phase Power isn't separately integrated.
    if (this.opts.autoCalculateEnergy && Object.keys(measurementProps).length > 0) {
      this.phaseEnergyKeys = Object.keys(measurementProps)
        .map((key) => key.match(/^Ac\/L(\d)\/Power$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => `Ac/L${m[1]}/Energy/Forward`)
      const energyKeys = new Set(this.phaseEnergyKeys)
      energyKeys.add('Ac/Energy/Forward')
      for (const key of energyKeys) {
        measurementPropertyDecls[key] = { type: 'd', format: (v: unknown) => v != null ? Number(v).toFixed(2) + 'kWh' : '' }
        measurementDefinition[key] = 0
      }
    }

    const declaration: Record<string, unknown> = {
      name: serviceName,
      productType: deviceType,
      properties: {
        DeviceInstance: { type: 'i', readonly: true },
        // Full node-red-contrib-victron-compatible "minimal meter" shape (Position, NrOfPhases,
        // per-phase Voltage/Current/Power/etc.) - see minimal-meter-properties.ts for why. Applied
        // before the measurement-tracked overrides below, so a configured measurementType's
        // key(s) win over the shape's own `null` ("unknown") default for the same path.
        ...minimalMeter.properties,
        // Transport-state properties every S2-capable device needs, matching
        // node-red-contrib-victron's s2-support.js TRANSPORT_PROPERTIES exactly - these are
        // ordinary BusItem properties, not auto-declared by dbus-victron-virtual's S2 support
        // itself, so setValuesLocally() would throw "Property ... not found" without them.
        'S2/0/Active': { type: 'i' },
        'S2/0/Rm': { type: 's', format: (v: unknown) => v != null ? v : '' },
        ...measurementPropertyDecls
      },
      __enableS2: true,
      __s2Handlers: {
        Connect: (cemId: string, keepAliveInterval: number) => {
          this.handle?.setValuesLocally({ 'S2/0/Rm': `CEM: ${cemId}` })
          this.emit('connect', cemId, keepAliveInterval)
        },
        Disconnect: (cemId: string) => {
          this.handle?.setValuesLocally({ 'S2/0/Active': 0, 'S2/0/Rm': '' })
          this.emit('disconnect', cemId)
        },
        Message: (cemId: string, message: string) => this.emit('message', cemId, message),
        KeepAlive: () => {}
      }
    }
    const definition: Record<string, unknown> = {
      DeviceInstance: deviceInstance,
      ...minimalMeter.definition,
      'S2/0/Active': 0,
      'S2/0/Rm': '',
      ...measurementDefinition
    }

    try {
      this.handle = addVictronInterfaces(bus, declaration, definition, true)
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      return
    }

    bus.requestName(serviceName, 0x4, (err, retCode) => {
      if (err || (retCode !== 1 && retCode !== 3)) {
        this.emit('error', new Error(`S2DbusTransport: failed to acquire D-Bus name ${serviceName} (retCode=${String(retCode)})`))
        return
      }
      this.emit('open')
    })
  }

  /** Send a raw S2 JSON message to the connected CEM. */
  send (message: string): void {
    if (!this.handle || !this.handle.emitS2Signal) {
      this.emit('error', new Error('S2DbusTransport: not registered yet, cannot send'))
      return
    }
    this.handle.emitS2Signal('Message', [message])
  }

  /** Update the S2/0/Active BusItem property (1 = an active control type is selected, 0 = not). */
  setActive (value: 0 | 1): void {
    if (!this.handle) return
    this.handle.setValuesLocally({ 'S2/0/Active': value })
  }

  /** Update the measurement BusItem propert(y/ies) declared via the measurementType option
   * (e.g. { 'Ac/Power': 1800 }). A no-op before registration completes or if measurementType
   * was not set. When autoCalculateEnergy is on, also integrates the updated Power value(s) into
   * their running Energy Forward total(s) - see EnergyAccumulator. */
  setMeasurementValues (values: Record<string, number>): void {
    if (!this.handle || Object.keys(values).length === 0) return
    this.handle.setValuesLocally(values)
    if (!this.opts.autoCalculateEnergy) return

    const now = Date.now()
    const energyUpdates: Record<string, number> = {}

    if (this.opts.measurementType === '3_PHASE_SYMMETRIC') {
      if ('Ac/Power' in values) {
        const total = this.energyAccumulator.accumulate('Ac/Energy/Forward', values['Ac/Power'], now)
        if (total !== null) energyUpdates['Ac/Energy/Forward'] = total
      }
    } else if (this.phaseEnergyKeys.length > 0) {
      let anyPhaseUpdated = false
      for (const powerKey of Object.keys(values)) {
        const m = powerKey.match(/^Ac\/L(\d)\/Power$/)
        if (!m) continue
        const energyKey = `Ac/L${m[1]}/Energy/Forward`
        const total = this.energyAccumulator.accumulate(energyKey, values[powerKey], now)
        if (total !== null) {
          energyUpdates[energyKey] = total
          anyPhaseUpdated = true
        }
      }
      // Rolled up from every tracked phase's current total, mirroring node-red-contrib-victron's acload.js.
      if (anyPhaseUpdated) {
        energyUpdates['Ac/Energy/Forward'] = this.phaseEnergyKeys.reduce((sum, key) => sum + this.energyAccumulator.getTotal(key), 0)
      }
    }

    if (Object.keys(energyUpdates).length > 0) this.handle.setValuesLocally(energyUpdates)
  }

  disconnect (): void {
    if (this.bus && this.serviceName) {
      this.bus.releaseName(this.serviceName, () => {})
    }
    this.bus = undefined
    this.handle = undefined
  }
}
