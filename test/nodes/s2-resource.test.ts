import { EventEmitter } from 'events'
import { MessageType, serialize } from '../../src/lib/s2/messages'
import registerNode from '../../src/nodes/s2-resource/index'

// --- Transport mock (same pattern as test/nodes/s2-websocket.test.ts) ---

let mockTransport: EventEmitter & { connect: jest.Mock, disconnect: jest.Mock, send: jest.Mock }
let capturedTransportOptions: Record<string, unknown>

jest.mock('../../src/lib/transport/websocket', () => ({
  S2WebSocketTransport: jest.fn().mockImplementation((opts: Record<string, unknown>) => {
    capturedTransportOptions = opts
    return mockTransport
  })
}))

let mockDbusTransport: EventEmitter & { connect: jest.Mock, disconnect: jest.Mock, send: jest.Mock, setActive: jest.Mock, setMeasurementValues: jest.Mock }
let capturedDbusTransportOptions: Record<string, unknown>

jest.mock('../../src/lib/transport/dbus', () => ({
  S2DbusTransport: jest.fn().mockImplementation((opts: Record<string, unknown>) => {
    capturedDbusTransportOptions = opts
    return mockDbusTransport
  })
}))

beforeEach(() => {
  const emitter = new EventEmitter() as EventEmitter & { connect: jest.Mock, disconnect: jest.Mock, send: jest.Mock }
  emitter.connect = jest.fn()
  emitter.disconnect = jest.fn()
  emitter.send = jest.fn()
  mockTransport = emitter
  capturedTransportOptions = {}

  const dbusEmitter = new EventEmitter() as EventEmitter & { connect: jest.Mock, disconnect: jest.Mock, send: jest.Mock, setActive: jest.Mock, setMeasurementValues: jest.Mock }
  dbusEmitter.connect = jest.fn()
  dbusEmitter.disconnect = jest.fn()
  dbusEmitter.send = jest.fn()
  dbusEmitter.setActive = jest.fn()
  dbusEmitter.setMeasurementValues = jest.fn()
  mockDbusTransport = dbusEmitter
  capturedDbusTransportOptions = {}
})

// --- Test helpers ---

const DEFAULT_CEM_CONFIG = {
  url: 'wss://cem.example.com/s2/ws/',
  credentials: {}
}

const DEFAULT_DBUS_CONFIG = {
  connectionMode: 'system',
  deviceType: 'acload',
  measurementType: '3_PHASE_SYMMETRIC',
  nrOfPhases: 1,
  position: 0,
  phaseSetting: 1
}

function setupNode (config: Record<string, unknown>, cemConfig: unknown = DEFAULT_CEM_CONFIG, dbusConfig: unknown = DEFAULT_DBUS_CONFIG) {
  const merged: Record<string, unknown> = { id: 'node-test-id', cem: 'cem-cfg-id', dbusConfig: 'dbus-cfg-id', ...config }

  const handlers: Record<string, (...args: unknown[]) => void> = {}
  const nodeContext: Record<string, unknown> = {}
  const flowContext: Record<string, unknown> = {}
  const node: Record<string, unknown> = {
    id: merged.id,
    name: '',
    send: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
    status: jest.fn(),
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => { handlers[event] = handler }),
    context: jest.fn(() => ({
      get: jest.fn((key: string) => nodeContext[key]),
      set: jest.fn((key: string, value: unknown) => { nodeContext[key] = value }),
      flow: {
        get: jest.fn((key: string) => flowContext[key]),
        set: jest.fn((key: string, value: unknown) => { flowContext[key] = value })
      },
      global: { get: jest.fn(), set: jest.fn() }
    }))
  }

  const RED = {
    nodes: {
      createNode: jest.fn((n: Record<string, unknown>) => { Object.assign(n, node) }),
      registerType: jest.fn(),
      getNode: jest.fn((id: string) => {
        if (id === merged.cem) return cemConfig
        if (id === merged.dbusConfig) return dbusConfig
        return null
      })
    },
    comms: { publish: jest.fn() }
  }

  let Constructor: ((this: Record<string, unknown>, config: Record<string, unknown>) => void) | null = null
  RED.nodes.registerType.mockImplementation((_type: string, ctor: (this: Record<string, unknown>, config: Record<string, unknown>) => void) => {
    Constructor = ctor
  })

  registerNode(RED as never)
  Constructor!.call(node, merged as never)

  return { node, RED, handlers, nodeContext, flowContext }
}

const OMBC_SYSTEM_DESCRIPTION = JSON.stringify({
  operationModes: [{ id: 'mode-standby', diagnostic_label: 'Standby', power_ranges: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', start_of_range: 0, end_of_range: 0 }], abnormal_condition_only: false }],
  transitions: [],
  timers: []
})

function outputAt (node: Record<string, unknown>, index: number): unknown[] {
  return (node.send as jest.Mock).mock.calls
    .map((c: unknown[]) => c[0] as unknown[])
    .filter((args) => Array.isArray(args) && args.length > index && args[index] !== null)
    .map((args) => args[index])
}

// --- RM identity (task 3.1) ---

describe('s2-resource - RM identity', () => {
  it('auto-generates a resourceId when not configured', () => {
    const { node, handlers } = setupNode({ transport: 'external', controlType: 'none' })
    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(), jest.fn()
    )

    const rmd = outputAt(node, 0).find((m) => {
      const payload = (m as { payload?: { message?: { message_type?: string } } }).payload
      return payload?.message?.message_type === MessageType.RESOURCE_MANAGER_DETAILS
    }) as { payload: { message: Record<string, unknown> } } | undefined

    expect(rmd).toBeDefined()
    expect(typeof rmd!.payload.message.resource_id).toBe('string')
    expect((rmd!.payload.message.resource_id as string).length).toBeGreaterThan(0)
  })

  it('parses comma-separated roles into role objects', () => {
    const { node, handlers } = setupNode({ transport: 'external', controlType: 'none', roles: 'ENERGY_CONSUMER,ENERGY_PRODUCER' })
    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(), jest.fn()
    )

    const rmd = outputAt(node, 0).find((m) => {
      const payload = (m as { payload?: { message?: { message_type?: string } } }).payload
      return payload?.message?.message_type === MessageType.RESOURCE_MANAGER_DETAILS
    }) as { payload: { message: { roles: Array<{ role: string }> } } } | undefined

    expect(rmd).toBeDefined()
    expect(rmd!.payload.message.roles.map((r) => r.role)).toEqual(['ENERGY_CONSUMER', 'ENERGY_PRODUCER'])
  })

  it('defaults manufacturer to "Custom (Node-RED)" and leaves model/firmwareVersion blank when not configured', () => {
    const { node, handlers } = setupNode({ transport: 'external', controlType: 'none' })
    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(), jest.fn()
    )

    const rmd = outputAt(node, 0).find((m) => {
      const payload = (m as { payload?: { message?: { message_type?: string } } }).payload
      return payload?.message?.message_type === MessageType.RESOURCE_MANAGER_DETAILS
    }) as { payload: { message: Record<string, unknown> } } | undefined

    expect(rmd).toBeDefined()
    expect(rmd!.payload.message.manufacturer).toBe('Custom (Node-RED)')
    expect(rmd!.payload.message.model).toBe('')
    expect(rmd!.payload.message.firmware_version).toBe('')
  })
})

// --- Transport (task 3.2) ---

describe('s2-resource - Transport: WebSocket', () => {
  it('constructs the WebSocket transport from the referenced s2-cem-config, substituting resourceId', () => {
    setupNode({ transport: 'websocket', controlType: 'none', resourceId: 'my-resource-id' })

    expect(capturedTransportOptions.url).toBe('wss://cem.example.com/s2/ws/my-resource-id')
  })

  it('shows an error status and does not construct a transport when the CEM config is missing', () => {
    const { node } = setupNode({ transport: 'websocket', controlType: 'none', cem: 'missing-cem' }, null)

    expect(node.status as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({ fill: 'red', text: 'CEM config missing' }))
  })

  it('sends Connect into the RM when the transport opens', () => {
    const { node } = setupNode({ transport: 'websocket', controlType: 'none' })

    mockTransport.emit('open')

    const rmDown = outputAt(node, 0)
    const connected = rmDown.find((m) => (m as { topic?: string }).topic === 'Connected')
    expect(connected).toBeDefined()
  })

  it('forwards an outbound s2Signal Message to the WebSocket transport instead of an output port', () => {
    const { node } = setupNode({ transport: 'websocket', controlType: 'none' })
    mockTransport.emit('open')

    // Trigger a message the RM sends outbound (ResourceManagerDetails, via HandshakeResponse)
    mockTransport.emit('message', serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))

    expect(mockTransport.send).toHaveBeenCalled()
    // Only one output exists (downstream) when Transport: WebSocket - nothing sent with a
    // non-null first array element beyond that single output slot.
    expect((node.send as jest.Mock).mock.calls.every((c: unknown[]) => (c[0] as unknown[]).length === 1)).toBe(true)
  })

  it('publishes a Connect entry to the debug sidebar when the transport opens', () => {
    const { RED } = setupNode({ transport: 'websocket', controlType: 'none', debug: true })

    mockTransport.emit('open')

    expect(RED.comms.publish as jest.Mock).toHaveBeenCalledWith(
      'debug',
      expect.objectContaining({ topic: '<- from CEM cem (Connect)', msg: { cemId: 'cem' } }),
      false
    )
  })

  it('publishes inbound and outbound messages to the debug sidebar when debug is enabled', () => {
    const { RED } = setupNode({ transport: 'websocket', controlType: 'none', debug: true })
    mockTransport.emit('open')

    mockTransport.emit('message', serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))

    expect(RED.comms.publish as jest.Mock).toHaveBeenCalledWith(
      'debug',
      expect.objectContaining({ topic: '<- from CEM cem' }),
      false
    )
    expect(RED.comms.publish as jest.Mock).toHaveBeenCalledWith(
      'debug',
      expect.objectContaining({ topic: '-> to CEM cem' }),
      false
    )
  })

  it('does not publish to the debug sidebar when debug is disabled', () => {
    const { RED } = setupNode({ transport: 'websocket', controlType: 'none', debug: false })
    mockTransport.emit('open')

    mockTransport.emit('message', serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))

    expect(RED.comms.publish as jest.Mock).not.toHaveBeenCalled()
  })

  it('shows grey "waiting for CEM" (not a stale green) while genuinely disconnected and reconnecting', () => {
    const { node } = setupNode({ transport: 'websocket', controlType: 'none' })
    mockTransport.emit('open')
    ;(node.status as jest.Mock).mockClear()

    mockTransport.emit('close')

    const statusCalls = (node.status as jest.Mock).mock.calls
    const lastStatus = statusCalls[statusCalls.length - 1][0]
    expect(lastStatus).toEqual({ fill: 'grey', shape: 'ring', text: 'waiting for CEM' })
  })
})

describe('s2-resource - Transport: External', () => {
  it('emits outbound RM messages on the "to transport" output (port 0) instead of using a WebSocket', () => {
    const { node, handlers } = setupNode({ transport: 'external', controlType: 'none' })

    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(), jest.fn()
    )

    const toTransport = outputAt(node, 0)
    expect(toTransport.length).toBeGreaterThan(0)
    expect(mockTransport.send).not.toHaveBeenCalled()
  })
})

describe('s2-resource - Transport: D-Bus', () => {
  it('constructs S2DbusTransport from the referenced s2-dbus-config and this node\'s own id', () => {
    setupNode({ transport: 'dbus', controlType: 'none', id: 'my-node-id' })

    expect(capturedDbusTransportOptions).toMatchObject({
      connectionMode: 'system',
      deviceType: 'acload',
      nodeId: 'my-node-id',
      nrOfPhases: 1,
      position: 0,
      phaseSetting: 1
    })
  })

  it('defaults to Transport: D-Bus when transport is not configured', () => {
    setupNode({ controlType: 'none' })

    expect(capturedDbusTransportOptions).toMatchObject({ deviceType: 'acload' })
  })

  it('shows an error status and does not connect when the D-Bus config is missing', () => {
    const { node } = setupNode({ transport: 'dbus', controlType: 'none' }, DEFAULT_CEM_CONFIG, null)

    expect(node.status as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({ fill: 'red', text: 'D-Bus config missing' }))
    expect(mockDbusTransport.connect).not.toHaveBeenCalled()
  })

  it('shows an error status and does not connect for an unrecognized deviceType', () => {
    const { node } = setupNode({ transport: 'dbus', controlType: 'none' }, DEFAULT_CEM_CONFIG, { ...DEFAULT_DBUS_CONFIG, deviceType: 'nonsense' })

    expect(node.error as jest.Mock).toHaveBeenCalled()
    expect(node.status as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({ fill: 'red', text: 'invalid deviceType: nonsense' }))
    expect(mockDbusTransport.connect).not.toHaveBeenCalled()
  })

  it('sends Connect into the RM when the D-Bus transport reports a CEM connected', () => {
    const { node } = setupNode({ transport: 'dbus', controlType: 'none' })

    mockDbusTransport.emit('connect', 'dbus-cem-1', 300)

    const downstream = outputAt(node, 0)
    const connected = downstream.find((m) => (m as { topic?: string }).topic === 'Connected')
    expect(connected).toBeDefined()
  })

  it('forwards an outbound s2Signal Message to the D-Bus transport instead of an output port', () => {
    const { node } = setupNode({ transport: 'dbus', controlType: 'none' })
    mockDbusTransport.emit('connect', 'dbus-cem-1', 300)

    mockDbusTransport.emit('message', 'dbus-cem-1', serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))

    expect(mockDbusTransport.send).toHaveBeenCalled()
    expect((node.send as jest.Mock).mock.calls.every((c: unknown[]) => (c[0] as unknown[]).length === 1)).toBe(true)
  })

  it('publishes inbound and outbound messages to the debug sidebar when debug is enabled', () => {
    const { RED } = setupNode({ transport: 'dbus', controlType: 'none', debug: true })
    mockDbusTransport.emit('connect', 'dbus-cem-1', 300)

    mockDbusTransport.emit('message', 'dbus-cem-1', serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))

    expect(RED.comms.publish as jest.Mock).toHaveBeenCalledWith(
      'debug',
      expect.objectContaining({ topic: '<- from CEM dbus-cem-1' }),
      false
    )
    expect(RED.comms.publish as jest.Mock).toHaveBeenCalledWith(
      'debug',
      expect.objectContaining({ topic: '-> to CEM dbus-cem-1' }),
      false
    )
  })

  it('sets S2/0/Active via the D-Bus transport on SelectControlType', () => {
    setupNode({ transport: 'dbus', controlType: 'none' })
    mockDbusTransport.emit('connect', 'dbus-cem-1', 300)
    mockDbusTransport.emit('message', 'dbus-cem-1', serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))

    mockDbusTransport.emit('message', 'dbus-cem-1', serialize({ message_type: MessageType.SELECT_CONTROL_TYPE, message_id: 'sct1', control_type: 'OPERATION_MODE_BASED_CONTROL' }))

    expect(mockDbusTransport.setActive).toHaveBeenCalledWith(1)
  })

  it('sends Disconnect into the RM when the D-Bus transport reports a CEM disconnected', () => {
    const { node } = setupNode({ transport: 'dbus', controlType: 'none' })
    mockDbusTransport.emit('connect', 'dbus-cem-1', 300)
    ;(node.send as jest.Mock).mockClear()

    mockDbusTransport.emit('disconnect', 'dbus-cem-1')

    const downstream = outputAt(node, 0)
    const disconnected = downstream.find((m) => (m as { topic?: string }).topic === 'Disconnected')
    expect(disconnected).toBeDefined()
  })

  it('publishes a Disconnect entry to the debug sidebar with the real D-Bus cemId', () => {
    const { RED } = setupNode({ transport: 'dbus', controlType: 'none', debug: true })
    mockDbusTransport.emit('connect', 'dbus-cem-1', 300)
    ;(RED.comms.publish as jest.Mock).mockClear()

    mockDbusTransport.emit('disconnect', 'dbus-cem-1')

    expect(RED.comms.publish as jest.Mock).toHaveBeenCalledWith(
      'debug',
      expect.objectContaining({ topic: '<- from CEM dbus-cem-1 (Disconnect)', msg: { cemId: 'dbus-cem-1' } }),
      false
    )
  })

  it('stays green "waiting for CEM" (not the RM\'s generic grey) after a CEM disconnects, since the D-Bus service is still registered', () => {
    const { node } = setupNode({ transport: 'dbus', controlType: 'none' })
    mockDbusTransport.emit('open')
    mockDbusTransport.emit('connect', 'dbus-cem-1', 300)
    ;(node.status as jest.Mock).mockClear()

    mockDbusTransport.emit('disconnect', 'dbus-cem-1')

    const statusCalls = (node.status as jest.Mock).mock.calls
    const lastStatus = statusCalls[statusCalls.length - 1][0]
    expect(lastStatus).toEqual({ fill: 'green', shape: 'ring', text: 'waiting for CEM' })
  })
})

describe('s2-resource - power measurement advertised capability follows the active transport', () => {
  // For built-in transports (WebSocket/D-Bus), ResourceManagerDetails goes to the transport's
  // own send(), not a node output port - unlike Transport: External, where it's on node.send().
  function findResourceManagerDetailsSentVia (mockSend: jest.Mock): { provides_power_measurement_types: string[] } | undefined {
    const raw = mockSend.mock.calls.map((c: unknown[]) => c[0] as string).find((r) => r.includes(MessageType.RESOURCE_MANAGER_DETAILS))
    if (!raw) return undefined
    return JSON.parse(raw)
  }

  it('Transport: D-Bus advertises the D-Bus config\'s measurementType, ignoring the RM tab\'s own field', () => {
    setupNode(
      { transport: 'dbus', controlType: 'none', providesPowerMeasurement: '' },
      DEFAULT_CEM_CONFIG,
      { ...DEFAULT_DBUS_CONFIG, measurementType: 'L1_L2_L3' }
    )

    mockDbusTransport.emit('connect', 'dbus-cem-1', 300)
    mockDbusTransport.emit('message', 'dbus-cem-1', serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))

    const rmd = findResourceManagerDetailsSentVia(mockDbusTransport.send as jest.Mock)
    expect(rmd?.provides_power_measurement_types).toEqual(['ELECTRIC.POWER.L1', 'ELECTRIC.POWER.L2', 'ELECTRIC.POWER.L3'])
  })

  it('Transport: WebSocket still uses the RM tab\'s own providesPowerMeasurement field', () => {
    setupNode({ transport: 'websocket', controlType: 'none', providesPowerMeasurement: '3_PHASE_SYMMETRIC' })

    mockTransport.emit('open')
    mockTransport.emit('message', serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))

    const rmd = findResourceManagerDetailsSentVia(mockTransport.send as jest.Mock)
    expect(rmd?.provides_power_measurement_types).toEqual(['ELECTRIC.POWER.3_PHASE_SYMMETRIC'])
  })
})

describe('s2-resource - Transport: D-Bus power measurement relay', () => {
  function connectAndSelect (): void {
    mockDbusTransport.emit('connect', 'dbus-cem-1', 300)
    mockDbusTransport.emit('message', 'dbus-cem-1', serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }))
    mockDbusTransport.emit('message', 'dbus-cem-1', serialize({ message_type: MessageType.SELECT_CONTROL_TYPE, message_id: 'sct1', control_type: 'OPERATION_MODE_BASED_CONTROL' }))
  }

  function findSentPowerMeasurement (): { values: Array<{ commodity_quantity: string, value: number }> } | undefined {
    const raw = (mockDbusTransport.send as jest.Mock).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .find((r) => r.includes(MessageType.POWER_MEASUREMENT))
    return raw ? JSON.parse(raw) : undefined
  }

  it('relays a value cached before the CEM connects, once the RM starts power measurement', () => {
    const { handlers } = setupNode({ transport: 'dbus', controlType: 'none', providesPowerMeasurement: '3_PHASE_SYMMETRIC' })
    handlers.input({ payload: { 'Ac/Power': 1800 } }, jest.fn(), jest.fn())

    connectAndSelect()

    const sent = findSentPowerMeasurement()
    expect(sent).toBeDefined()
    expect(sent!.values).toEqual([{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: 1800 }])
  })

  it('relays an updated value fed to the input while active', () => {
    const { handlers } = setupNode({ transport: 'dbus', controlType: 'none', providesPowerMeasurement: '3_PHASE_SYMMETRIC' })
    connectAndSelect()
    ;(mockDbusTransport.send as jest.Mock).mockClear()

    handlers.input({ payload: { 'Ac/Power': 2200 } }, jest.fn(), jest.fn())

    const sent = findSentPowerMeasurement()
    expect(sent).toBeDefined()
    expect(sent!.values).toEqual([{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: 2200 }])
  })

  it('does not relay a value fed to the input before the CEM has started measurement', () => {
    const { handlers } = setupNode({ transport: 'dbus', controlType: 'none' })

    handlers.input({ payload: { 'Ac/Power': 900 } }, jest.fn(), jest.fn())

    expect(findSentPowerMeasurement()).toBeUndefined()
  })

  it('updates the D-Bus BusItem property even before the CEM has started measurement', () => {
    const { handlers } = setupNode({ transport: 'dbus', controlType: 'none' })

    handlers.input({ payload: { 'Ac/Power': 900 } }, jest.fn(), jest.fn())

    expect(mockDbusTransport.setMeasurementValues).toHaveBeenCalledWith({ 'Ac/Power': 900 })
  })

  it('passes measurementType through to S2DbusTransport', () => {
    setupNode({ transport: 'dbus', controlType: 'none' }, DEFAULT_CEM_CONFIG, { ...DEFAULT_DBUS_CONFIG, measurementType: 'L1_L2_L3' })

    expect(capturedDbusTransportOptions.measurementType).toBe('L1_L2_L3')
  })
})

// --- Control type (task 4.1) ---

describe('s2-resource - Control type: OMBC', () => {
  function connectAndSelectOmbc (handlers: Record<string, (...args: unknown[]) => void>): void {
    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(), jest.fn()
    )
    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.SELECT_CONTROL_TYPE, message_id: 'sct1', control_type: 'OPERATION_MODE_BASED_CONTROL' }) } },
      jest.fn(), jest.fn()
    )
  }

  it('sends OMBC.SystemDescription (built from config) to the CEM once OMBC is selected, without a downstream "from CEM" passthrough', () => {
    const { node, handlers } = setupNode({ transport: 'external', controlType: 'ombc', systemDescription: OMBC_SYSTEM_DESCRIPTION })
    connectAndSelectOmbc(handlers)

    const toTransport = outputAt(node, 0)
    const sysDesc = toTransport.find((m) => {
      const payload = (m as { payload?: { message?: { message_type?: string } } }).payload
      return payload?.message?.message_type === MessageType.OMBC_SYSTEM_DESCRIPTION
    }) as { payload: { message: { operation_modes: Array<{ id: string }> } } } | undefined

    expect(sysDesc).toBeDefined()
    expect(sysDesc!.payload.message.operation_modes[0].id).toBe('mode-standby')
  })

  it('sends OMBC.Status for the configured default mode once OMBC is selected, without a separate confirm', () => {
    const { node, handlers } = setupNode({ transport: 'external', controlType: 'ombc', systemDescription: OMBC_SYSTEM_DESCRIPTION, defaultOperationModeId: 'mode-standby' })
    connectAndSelectOmbc(handlers)

    const toTransport = outputAt(node, 0)
    const status = toTransport.find((m) => {
      const payload = (m as { payload?: { message?: { message_type?: string } } }).payload
      return payload?.message?.message_type === MessageType.OMBC_STATUS
    }) as { payload: { message: { active_operation_mode_id: string } } } | undefined

    expect(status).toBeDefined()
    expect(status!.payload.message.active_operation_mode_id).toBe('mode-standby')
  })

  it('reports an error instead of throwing when defaultOperationModeId does not match any configured mode', () => {
    const { node } = setupNode({ transport: 'external', controlType: 'ombc', systemDescription: OMBC_SYSTEM_DESCRIPTION, defaultOperationModeId: 'nonexistent-mode' })

    expect(node.error as jest.Mock).toHaveBeenCalledWith(expect.stringContaining('default mode'))
  })

  it('resolves an OMBC instruction into a ModeInstruction on the downstream output', () => {
    const { node, handlers } = setupNode({ transport: 'external', controlType: 'ombc', systemDescription: OMBC_SYSTEM_DESCRIPTION })
    connectAndSelectOmbc(handlers)
    ;(node.send as jest.Mock).mockClear()

    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-1',
          id: 'instr-1',
          execution_time: new Date(Date.now() - 1000).toISOString(),
          operation_mode_id: 'mode-standby',
          operation_mode_factor: 1,
          abnormal_condition: false
        })
      }
    }, jest.fn(), jest.fn())

    const downstream = outputAt(node, 1)
    const instr = downstream.find((m) => (m as { topic?: string }).topic === 'ModeInstruction')
    expect(instr).toBeDefined()
    expect((instr as { payload: { id: string } }).payload.id).toBe('mode-standby')
  })

  function sendOmbcInstruction (handlers: Record<string, (...args: unknown[]) => void>): void {
    handlers.input({
      payload: {
        command: 'Message',
        cemId: 'cem-1',
        message: serialize({
          message_type: MessageType.OMBC_INSTRUCTION,
          message_id: 'msg-1',
          id: 'instr-1',
          execution_time: new Date(Date.now() - 1000).toISOString(),
          operation_mode_id: 'mode-standby',
          operation_mode_factor: 1,
          abnormal_condition: false
        })
      }
    }, jest.fn(), jest.fn())
  }

  it('auto-confirms an instructed mode by default, sending an updated OMBC.Status without a separate confirm', () => {
    const { node, handlers } = setupNode({ transport: 'external', controlType: 'ombc', systemDescription: OMBC_SYSTEM_DESCRIPTION })
    connectAndSelectOmbc(handlers)
    ;(node.send as jest.Mock).mockClear()

    sendOmbcInstruction(handlers)

    const toTransport = outputAt(node, 0)
    const status = toTransport.find((m) => {
      const payload = (m as { payload?: { message?: { message_type?: string } } }).payload
      return payload?.message?.message_type === MessageType.OMBC_STATUS
    }) as { payload: { message: { active_operation_mode_id: string } } } | undefined

    expect(status).toBeDefined()
    expect(status!.payload.message.active_operation_mode_id).toBe('mode-standby')
  })

  it('does not auto-confirm an instructed mode when autoConfirmInstructions is disabled', () => {
    const { node, handlers } = setupNode({ transport: 'external', controlType: 'ombc', systemDescription: OMBC_SYSTEM_DESCRIPTION, autoConfirmInstructions: false })
    connectAndSelectOmbc(handlers)
    ;(node.send as jest.Mock).mockClear()

    sendOmbcInstruction(handlers)

    const toTransport = outputAt(node, 0)
    const status = toTransport.find((m) => {
      const payload = (m as { payload?: { message?: { message_type?: string } } }).payload
      return payload?.message?.message_type === MessageType.OMBC_STATUS
    })

    expect(status).toBeUndefined()
  })

  it('routes a ModeConfirmation on the node input to the built-in OMBC controller', () => {
    const { node, handlers } = setupNode({ transport: 'external', controlType: 'ombc', systemDescription: OMBC_SYSTEM_DESCRIPTION })
    connectAndSelectOmbc(handlers)
    ;(node.send as jest.Mock).mockClear()

    handlers.input({ topic: 'ModeConfirmation', payload: { id: 'mode-standby' }, cemId: 'cem-1' }, jest.fn(), jest.fn())

    const toTransport = outputAt(node, 0)
    const status = toTransport.find((m) => {
      const payload = (m as { payload?: { message?: { message_type?: string } } }).payload
      return payload?.message?.message_type === MessageType.OMBC_STATUS
    })
    expect(status).toBeDefined()
  })
})

describe('s2-resource - Control type: None', () => {
  it('forwards raw CEM messages on the downstream output, identical in shape to s2-rm\'s "from CEM" output', () => {
    const { node, handlers } = setupNode({ transport: 'external', controlType: 'none' })

    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(), jest.fn()
    )

    const downstream = outputAt(node, 1)
    const handshakeMsg = downstream.find((m) => (m as { payload?: { message_type?: string } }).payload?.message_type === MessageType.HANDSHAKE_RESPONSE)
    expect(handshakeMsg).toBeDefined()
    expect((handshakeMsg as { topic: string }).topic).toBe(MessageType.HANDSHAKE_RESPONSE)
  })

  it('routes a command-shaped input message (e.g. UpdateStatus from an external control-type node) to the RM', () => {
    const { node, handlers } = setupNode({ transport: 'external', controlType: 'none' })
    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 0 } }, jest.fn(), jest.fn())
    handlers.input(
      { payload: { command: 'Message', cemId: 'cem-1', message: serialize({ message_type: MessageType.HANDSHAKE_RESPONSE, message_id: 'hr1' }) } },
      jest.fn(), jest.fn()
    )
    ;(node.send as jest.Mock).mockClear()

    handlers.input({
      payload: { command: 'UpdateStatus', cemId: 'cem-1', controlType: 'OPERATION_MODE_BASED_CONTROL', ombc: { activeOperationModeId: 'mode-on', operationModeFactor: 1 } }
    }, jest.fn(), jest.fn())

    const toTransport = outputAt(node, 0)
    const status = toTransport.find((m) => {
      const payload = (m as { payload?: { message?: { message_type?: string } } }).payload
      return payload?.message?.message_type === MessageType.OMBC_STATUS
    })
    expect(status).toBeDefined()
  })
})

// --- Port contract (task 5.1) ---

describe('s2-resource - port contract parity with s2-rm (Transport: External, Control type: None)', () => {
  it('emits exactly two outputs - "to transport" at index 0, "from CEM" at index 1 - matching s2-rm exactly', () => {
    const { node, handlers } = setupNode({ transport: 'external', controlType: 'none' })

    handlers.input({ payload: { command: 'Connect', cemId: 'cem-1', keepAliveInterval: 30 } }, jest.fn(), jest.fn())

    const calls = (node.send as jest.Mock).mock.calls.map((c: unknown[]) => c[0] as unknown[])
    expect(calls.length).toBeGreaterThan(0)
    for (const args of calls) {
      expect(args.length).toBe(2)
    }
    const connected = outputAt(node, 1).find((m) => (m as { topic?: string }).topic === 'Connected')
    expect(connected).toBeDefined()
  })
})
