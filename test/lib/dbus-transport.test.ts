import * as dbusNative from 'dbus-native-victron'
import * as dbusVirtual from 'dbus-victron-virtual'
import { S2DbusTransport } from '../../src/lib/transport/dbus'

jest.mock('dbus-native-victron')
jest.mock('dbus-victron-virtual')

const mockCreateClient = dbusNative.createClient as jest.Mock
const mockSystemBus = dbusNative.systemBus as jest.Mock
const mockSessionBus = dbusNative.sessionBus as jest.Mock
const mockAddVictronInterfaces = dbusVirtual.addVictronInterfaces as jest.Mock
const mockAddSettings = dbusVirtual.addSettings as jest.Mock

interface FakeBus {
  connection: { on: jest.Mock }
  exportInterface: jest.Mock
  requestName: jest.Mock
  releaseName: jest.Mock
}

let fakeBus: FakeBus
let fakeHandle: { emitS2Signal: jest.Mock, setValuesLocally: jest.Mock, emitItemsChanged: jest.Mock }

// Matches the AddSettings response shape S2DbusTransport's getDeviceInstance parses:
// result[0][2][1][1][0] === "<class>:<instance>".
function settingsResultFor (instance: number): unknown {
  return [[null, null, [null, [null, [`acload:${instance}`]]]]]
}

// Flushes pending microtasks (the async DeviceInstance claim inside connect()).
function flush (): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.DBUS_SESSION_BUS_ADDRESS

  fakeBus = {
    connection: { on: jest.fn() },
    exportInterface: jest.fn(),
    requestName: jest.fn((_name: string, _flags: number, cb: (err: Error | null, retCode: number) => void) => cb(null, 1)),
    releaseName: jest.fn((_name: string, cb: (err: Error | null) => void) => cb(null))
  }
  fakeHandle = {
    emitS2Signal: jest.fn(),
    setValuesLocally: jest.fn(),
    emitItemsChanged: jest.fn()
  }

  mockCreateClient.mockReturnValue(fakeBus)
  mockSystemBus.mockReturnValue(fakeBus)
  mockSessionBus.mockReturnValue(fakeBus)
  mockAddVictronInterfaces.mockReturnValue(fakeHandle)
  mockAddSettings.mockResolvedValue(settingsResultFor(100))
})

function makeTransport (overrides: Partial<ConstructorParameters<typeof S2DbusTransport>[0]> = {}) {
  return new S2DbusTransport({
    connectionMode: 'system',
    deviceType: 'acload',
    nodeId: 'node1',
    ...overrides
  })
}

describe('S2DbusTransport - connection modes', () => {
  it('uses the system bus for connectionMode "system"', () => {
    makeTransport({ connectionMode: 'system' }).connect()
    expect(mockSystemBus).toHaveBeenCalled()
  })

  it('uses a TCP client for connectionMode "tcp"', () => {
    makeTransport({ connectionMode: 'tcp', tcpAddress: 'tcp:host=venus.local,port=78' }).connect()
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({ busAddress: 'tcp:host=venus.local,port=78' }),
      expect.any(Function)
    )
  })

  it('emits an error when connectionMode is "tcp" without a tcpAddress', () => {
    const transport = makeTransport({ connectionMode: 'tcp', tcpAddress: undefined })
    const onError = jest.fn()
    transport.on('error', onError)
    transport.connect()
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('uses the system bus for connectionMode "auto" when DBUS_SESSION_BUS_ADDRESS is not set', () => {
    makeTransport({ connectionMode: 'auto' }).connect()
    expect(mockSystemBus).toHaveBeenCalled()
    expect(mockSessionBus).not.toHaveBeenCalled()
  })

  it('uses the session bus for connectionMode "auto" when DBUS_SESSION_BUS_ADDRESS is set', () => {
    process.env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/tmp/bus'
    makeTransport({ connectionMode: 'auto' }).connect()
    expect(mockSessionBus).toHaveBeenCalled()
  })
})

describe('S2DbusTransport - DeviceInstance claiming', () => {
  it('claims a DeviceInstance via AddSettings, keyed by deviceType and nodeId, before registering', async () => {
    makeTransport({ deviceType: 'heatpump', nodeId: 'abc123' }).connect()
    await flush()

    expect(mockAddSettings).toHaveBeenCalledWith(fakeBus, [
      expect.objectContaining({
        path: '/Settings/Devices/virtual_s2_abc123/ClassAndVrmInstance',
        default: 'heatpump:100',
        type: 's'
      })
    ])
  })

  it('uses the claimed instance number as the registered DeviceInstance', async () => {
    mockAddSettings.mockResolvedValue(settingsResultFor(57))
    makeTransport().connect()
    await flush()

    expect(mockAddVictronInterfaces).toHaveBeenCalledWith(
      fakeBus,
      expect.anything(),
      expect.objectContaining({ DeviceInstance: 57 }),
      true
    )
  })

  it('does not retry, and emits "error", on a non-transient AddSettings failure', async () => {
    mockAddSettings.mockRejectedValue(new Error('some unrelated failure'))
    const transport = makeTransport()
    const onError = jest.fn()
    transport.on('error', onError)
    transport.connect()
    await flush()

    expect(mockAddSettings).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'some unrelated failure' }))
  })

  it('emits "error" and does not register when the DeviceInstance cannot be determined', async () => {
    mockAddSettings.mockResolvedValue('not a recognizable shape')
    const transport = makeTransport()
    const onError = jest.fn()
    transport.on('error', onError)
    transport.connect()
    await flush()

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('could not claim a DeviceInstance') }))
    expect(mockAddVictronInterfaces).not.toHaveBeenCalled()
  })
})

describe('S2DbusTransport - service registration', () => {
  it('registers the S2 service with a name derived from deviceType and nodeId', async () => {
    makeTransport({ deviceType: 'heatpump', nodeId: 'abc123' }).connect()
    await flush()

    expect(mockAddVictronInterfaces).toHaveBeenCalledWith(
      fakeBus,
      expect.objectContaining({ name: 'com.victronenergy.heatpump.virtual_s2_abc123', __enableS2: true }),
      expect.anything(),
      true
    )
    expect(fakeBus.requestName).toHaveBeenCalledWith('com.victronenergy.heatpump.virtual_s2_abc123', 0x4, expect.any(Function))
  })

  it('sanitizes any non-alphanumeric character in nodeId into a valid D-Bus service name element', async () => {
    makeTransport({ deviceType: 'acload', nodeId: 'ab.cd-ef' }).connect()
    await flush()

    const expectedName = 'com.victronenergy.acload.virtual_s2_ab_cd_ef'
    expect(mockAddVictronInterfaces).toHaveBeenCalledWith(
      fakeBus,
      expect.objectContaining({ name: expectedName }),
      expect.anything(),
      true
    )
    expect(fakeBus.requestName).toHaveBeenCalledWith(expectedName, 0x4, expect.any(Function))
  })

  it('emits "open" once the D-Bus name is acquired', async () => {
    const transport = makeTransport()
    const onOpen = jest.fn()
    transport.on('open', onOpen)
    transport.connect()
    await flush()
    expect(onOpen).toHaveBeenCalled()
  })

  it('emits "error" when requestName fails', async () => {
    fakeBus.requestName.mockImplementation((_name, _flags, cb) => cb(new Error('nope'), 0))
    const transport = makeTransport()
    const onError = jest.fn()
    transport.on('error', onError)
    transport.connect()
    await flush()
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })
})

describe('S2DbusTransport - S2 handler wiring', () => {
  async function connectedTransport () {
    const transport = makeTransport()
    transport.connect()
    await flush()
    const declaration = mockAddVictronInterfaces.mock.calls[0][1] as { __s2Handlers: Record<string, (...args: unknown[]) => void> }
    return { transport, handlers: declaration.__s2Handlers }
  }

  it('emits "connect" with cemId and keepAliveInterval when the CEM connects', async () => {
    const { transport, handlers } = await connectedTransport()
    const onConnect = jest.fn()
    transport.on('connect', onConnect)

    handlers.Connect('cem-1', 300)

    expect(onConnect).toHaveBeenCalledWith('cem-1', 300)
  })

  it('emits "disconnect" with cemId when the CEM disconnects', async () => {
    const { transport, handlers } = await connectedTransport()
    const onDisconnect = jest.fn()
    transport.on('disconnect', onDisconnect)

    handlers.Disconnect('cem-1')

    expect(onDisconnect).toHaveBeenCalledWith('cem-1')
  })

  it('emits "message" with cemId and raw payload when a Message arrives', async () => {
    const { transport, handlers } = await connectedTransport()
    const onMessage = jest.fn()
    transport.on('message', onMessage)

    handlers.Message('cem-1', '{"message_type":"Handshake"}')

    expect(onMessage).toHaveBeenCalledWith('cem-1', '{"message_type":"Handshake"}')
  })

  it('sets S2/0/Rm to identify the CEM when it connects', async () => {
    const { handlers } = await connectedTransport()

    handlers.Connect('cem-1', 300)

    expect(fakeHandle.setValuesLocally).toHaveBeenCalledWith({ 'S2/0/Rm': 'CEM: cem-1' })
  })

  it('resets S2/0/Active and S2/0/Rm when the CEM disconnects', async () => {
    const { handlers } = await connectedTransport()

    handlers.Disconnect('cem-1')

    expect(fakeHandle.setValuesLocally).toHaveBeenCalledWith({ 'S2/0/Active': 0, 'S2/0/Rm': '' })
  })
})

describe('S2DbusTransport - transport-state properties', () => {
  it('declares S2/0/Active and S2/0/Rm as BusItem properties, with initial values 0 and empty string', async () => {
    makeTransport().connect()
    await flush()

    const declaration = mockAddVictronInterfaces.mock.calls[0][1] as { properties: Record<string, unknown> }
    const definition = mockAddVictronInterfaces.mock.calls[0][2] as Record<string, unknown>
    expect(declaration.properties['S2/0/Active']).toBeDefined()
    expect(declaration.properties['S2/0/Rm']).toBeDefined()
    expect(definition['S2/0/Active']).toBe(0)
    expect(definition['S2/0/Rm']).toBe('')
  })
})

describe('S2DbusTransport - send / setActive', () => {
  it('sends a message via emitS2Signal', async () => {
    const transport = makeTransport()
    transport.connect()
    await flush()

    transport.send('{"message_type":"ResourceManagerDetails"}')

    expect(fakeHandle.emitS2Signal).toHaveBeenCalledWith('Message', ['{"message_type":"ResourceManagerDetails"}'])
  })

  it('updates S2/0/Active via setValuesLocally', async () => {
    const transport = makeTransport()
    transport.connect()
    await flush()

    transport.setActive(1)

    expect(fakeHandle.setValuesLocally).toHaveBeenCalledWith({ 'S2/0/Active': 1 })
  })

  it('emits an error instead of throwing when send is called before connect', () => {
    const transport = makeTransport()
    const onError = jest.fn()
    transport.on('error', onError)

    transport.send('irrelevant')

    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })
})

describe('S2DbusTransport - measurement properties', () => {
  it('leaves Ac/Power as an unknown placeholder (null) when measurementType is not set', async () => {
    makeTransport().connect()
    await flush()

    const [, , definition] = mockAddVictronInterfaces.mock.calls[0] as [unknown, unknown, Record<string, unknown>]
    expect(definition['Ac/Power']).toBeNull()
  })

  it('declares Ac/Power, and also Ac/L1-3/Power (derived per-phase breakdown), when measurementType is 3_PHASE_SYMMETRIC', async () => {
    makeTransport({ measurementType: '3_PHASE_SYMMETRIC', nrOfPhases: 3 }).connect()
    await flush()

    const [, declaration, definition] = mockAddVictronInterfaces.mock.calls[0] as [unknown, { properties: Record<string, unknown> }, Record<string, unknown>]
    expect(declaration.properties['Ac/Power']).toBeDefined()
    expect(definition['Ac/Power']).toBe(0)
    expect(definition['Ac/L1/Power']).toBe(0)
    expect(definition['Ac/L2/Power']).toBe(0)
    expect(definition['Ac/L3/Power']).toBe(0)
  })

  it('gives each tracked phase power property an initial value of 0 when measurementType is L1_L2_L3 with nrOfPhases: 3', async () => {
    makeTransport({ measurementType: 'L1_L2_L3', nrOfPhases: 3 }).connect()
    await flush()

    const [, , definition] = mockAddVictronInterfaces.mock.calls[0] as [unknown, unknown, Record<string, unknown>]
    expect(definition['Ac/L1/Power']).toBe(0)
    expect(definition['Ac/L2/Power']).toBe(0)
    expect(definition['Ac/L3/Power']).toBe(0)
  })

  it('declares only the wired phase\'s Power property when measurementType is L1_L2_L3 with nrOfPhases: 1 (bug 1 regression)', async () => {
    makeTransport({ measurementType: 'L1_L2_L3', nrOfPhases: 1, phaseSetting: 2 }).connect()
    await flush()

    const [, , definition] = mockAddVictronInterfaces.mock.calls[0] as [unknown, unknown, Record<string, unknown>]
    expect(definition['Ac/L2/Power']).toBe(0)
    // The "minimal meter" shape only ever declares the single wired phase for a single-phase
    // device (see minimal-meter-properties.ts) - L1/L3 aren't declared at all here, not even as
    // null placeholders, so the point of this regression test is that the measurement-tracked
    // override doesn't (re-)introduce them either.
    expect(definition['Ac/L1/Power']).toBeUndefined()
    expect(definition['Ac/L3/Power']).toBeUndefined()
  })

  it('setMeasurementValues updates the declared properties via setValuesLocally', async () => {
    const transport = makeTransport({ measurementType: '3_PHASE_SYMMETRIC' })
    transport.connect()
    await flush()

    transport.setMeasurementValues({ 'Ac/Power': 1800 })

    expect(fakeHandle.setValuesLocally).toHaveBeenCalledWith({ 'Ac/Power': 1800 })
  })

  it('setMeasurementValues is a no-op before registration completes', () => {
    const transport = makeTransport({ measurementType: '3_PHASE_SYMMETRIC' })

    expect(() => transport.setMeasurementValues({ 'Ac/Power': 1800 })).not.toThrow()
    expect(fakeHandle.setValuesLocally).not.toHaveBeenCalled()
  })
})

describe('S2DbusTransport - energy auto-calculation', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('declares Ac/Energy/Forward and per-phase Energy/Forward (initial 0) when autoCalculateEnergy is true', async () => {
    makeTransport({ measurementType: 'L1_L2_L3', nrOfPhases: 1, phaseSetting: 2, autoCalculateEnergy: true }).connect()
    await flush()

    const [, , definition] = mockAddVictronInterfaces.mock.calls[0] as [unknown, unknown, Record<string, unknown>]
    expect(definition['Ac/L2/Energy/Forward']).toBe(0)
    expect(definition['Ac/Energy/Forward']).toBe(0)
  })

  it('leaves Energy/Forward properties at their null default when autoCalculateEnergy is false', async () => {
    makeTransport({ measurementType: 'L1_L2_L3', nrOfPhases: 1, phaseSetting: 2, autoCalculateEnergy: false }).connect()
    await flush()

    const [, , definition] = mockAddVictronInterfaces.mock.calls[0] as [unknown, unknown, Record<string, unknown>]
    expect(definition['Ac/L2/Energy/Forward']).toBeNull()
    expect(definition['Ac/Energy/Forward']).toBeNull()
  })

  it('integrates Power over time into Energy/Forward via setValuesLocally, using the previous power value', async () => {
    const nowSpy = jest.spyOn(Date, 'now')
    const transport = makeTransport({ measurementType: 'L1_L2_L3', nrOfPhases: 1, phaseSetting: 2, autoCalculateEnergy: true })
    transport.connect()
    await flush()
    fakeHandle.setValuesLocally.mockClear()

    nowSpy.mockReturnValue(0)
    transport.setMeasurementValues({ 'Ac/L2/Power': 100 })
    expect(fakeHandle.setValuesLocally).not.toHaveBeenCalledWith(expect.objectContaining({ 'Ac/L2/Energy/Forward': expect.anything() }))

    nowSpy.mockReturnValue(3_600_000) // 1 hour later
    transport.setMeasurementValues({ 'Ac/L2/Power': 150 })

    expect(fakeHandle.setValuesLocally).toHaveBeenCalledWith({ 'Ac/L2/Energy/Forward': 0.1, 'Ac/Energy/Forward': 0.1 })
  })

  it('accumulates 3-phase-symmetric energy once from Ac/Power, not per derived phase', async () => {
    const nowSpy = jest.spyOn(Date, 'now')
    const transport = makeTransport({ measurementType: '3_PHASE_SYMMETRIC', nrOfPhases: 3, autoCalculateEnergy: true })
    transport.connect()
    await flush()

    nowSpy.mockReturnValue(0)
    transport.setMeasurementValues({ 'Ac/Power': 300, 'Ac/L1/Power': 100, 'Ac/L2/Power': 100, 'Ac/L3/Power': 100 })
    fakeHandle.setValuesLocally.mockClear()

    nowSpy.mockReturnValue(3_600_000)
    transport.setMeasurementValues({ 'Ac/Power': 300, 'Ac/L1/Power': 100, 'Ac/L2/Power': 100, 'Ac/L3/Power': 100 })

    const energyCall = fakeHandle.setValuesLocally.mock.calls.find((c) => 'Ac/Energy/Forward' in (c[0] as Record<string, unknown>))
    expect(energyCall?.[0]).toEqual({ 'Ac/Energy/Forward': 0.3 })
    expect((energyCall?.[0] as Record<string, unknown>)['Ac/L1/Energy/Forward']).toBeUndefined()
  })
})

describe('S2DbusTransport - minimal meter shape (node-red-contrib-victron parity)', () => {
  it('declares the full single-phase shape by default, with unknown numeric paths left null', async () => {
    makeTransport().connect()
    await flush()

    const [, declaration, definition] = mockAddVictronInterfaces.mock.calls[0] as [unknown, { properties: Record<string, unknown> }, Record<string, unknown>]
    for (const key of ['Ac/Energy/Forward', 'Ac/Energy/Reverse', 'Ac/Frequency', 'Ac/PowerFactor', 'Ac/L1/Current', 'Ac/L1/Energy/Forward', 'Ac/L1/Energy/Reverse', 'Ac/L1/Power', 'Ac/L1/PowerFactor', 'Ac/L1/Voltage']) {
      expect(declaration.properties[key]).toBeDefined()
      expect(definition[key]).toBeNull()
    }
    expect(definition.NrOfPhases).toBe(1)
    expect(definition.Position).toBe(0)
    expect(definition.PhaseSetting).toBe(1)
    expect(definition.Connected).toBe(1)
    expect(definition.IsGenericEnergyMeter).toBe(0)
    expect(declaration.properties['Ac/L2/Current']).toBeUndefined()
  })

  it('reports a single-phase device under the configured phaseSetting line instead of L1', async () => {
    makeTransport({ phaseSetting: 3 }).connect()
    await flush()

    const [, declaration, definition] = mockAddVictronInterfaces.mock.calls[0] as [unknown, { properties: Record<string, unknown> }, Record<string, unknown>]
    expect(declaration.properties['Ac/L3/Power']).toBeDefined()
    expect(declaration.properties['Ac/L1/Power']).toBeUndefined()
    expect(definition.PhaseSetting).toBe(3)
  })

  it('declares Ac/L1-L3 properties and no PhaseSetting when nrOfPhases is 3', async () => {
    makeTransport({ nrOfPhases: 3 }).connect()
    await flush()

    const [, declaration, definition] = mockAddVictronInterfaces.mock.calls[0] as [unknown, { properties: Record<string, unknown> }, Record<string, unknown>]
    for (const phase of [1, 2, 3]) {
      expect(declaration.properties[`Ac/L${phase}/Voltage`]).toBeDefined()
      expect(definition[`Ac/L${phase}/Voltage`]).toBeNull()
    }
    expect(declaration.properties.PhaseSetting).toBeUndefined()
    expect(definition.NrOfPhases).toBe(3)
  })

  it('reports the configured Position', async () => {
    makeTransport({ position: 1 }).connect()
    await flush()

    const [, , definition] = mockAddVictronInterfaces.mock.calls[0] as [unknown, unknown, Record<string, unknown>]
    expect(definition.Position).toBe(1)
  })
})

describe('S2DbusTransport - disconnect', () => {
  it('releases the D-Bus name', async () => {
    const transport = makeTransport()
    transport.connect()
    await flush()

    transport.disconnect()

    expect(fakeBus.releaseName).toHaveBeenCalledWith('com.victronenergy.acload.virtual_s2_node1', expect.any(Function))
  })
})
