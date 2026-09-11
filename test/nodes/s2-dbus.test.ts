import { EventEmitter } from 'events'
import registerNode from '../../src/nodes/s2-dbus/index'

let mockTransport: EventEmitter & { connect: jest.Mock, disconnect: jest.Mock, send: jest.Mock, setActive: jest.Mock, setMeasurementValues: jest.Mock }
let capturedTransportOptions: Record<string, unknown>

jest.mock('../../src/lib/transport/dbus', () => ({
  S2DbusTransport: jest.fn().mockImplementation((opts: Record<string, unknown>) => {
    capturedTransportOptions = opts
    return mockTransport
  })
}))

const DEFAULT_DBUS_CONFIG = {
  connectionMode: 'system',
  deviceType: 'acload',
  measurementType: '3_PHASE_SYMMETRIC',
  nrOfPhases: 1,
  position: 0,
  phaseSetting: 1,
  autoCalculateEnergy: true
}

function setupNode (
  config: Record<string, unknown>,
  dbusConfig: unknown = DEFAULT_DBUS_CONFIG
) {
  const merged: Record<string, unknown> = { dbusConfig: 'dbus-cfg', ...config, id: config.id || 'node-test-id' }

  const handlers: Record<string, (...args: unknown[]) => void> = {}
  const node: Record<string, unknown> = {
    id: merged.id,
    name: '',
    send: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
    status: jest.fn(),
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => { handlers[event] = handler })
  }

  const RED = {
    nodes: {
      createNode: jest.fn((n: Record<string, unknown>) => { Object.assign(n, node) }),
      registerType: jest.fn(),
      getNode: jest.fn((id: string) => (id === merged.dbusConfig ? dbusConfig : null))
    },
    comms: { publish: jest.fn() }
  }

  let Constructor: ((this: Record<string, unknown>, config: Record<string, unknown>) => void) | null = null
  RED.nodes.registerType.mockImplementation((_type: string, ctor: (this: Record<string, unknown>, config: Record<string, unknown>) => void) => {
    Constructor = ctor
  })

  registerNode(RED as never)
  Constructor!.call(node, merged as never)

  return { node, RED, handlers }
}

beforeEach(() => {
  const emitter = new EventEmitter() as EventEmitter & { connect: jest.Mock, disconnect: jest.Mock, send: jest.Mock, setActive: jest.Mock, setMeasurementValues: jest.Mock }
  emitter.connect = jest.fn()
  emitter.disconnect = jest.fn()
  emitter.send = jest.fn()
  emitter.setActive = jest.fn()
  emitter.setMeasurementValues = jest.fn()
  mockTransport = emitter
  capturedTransportOptions = {}
  jest.clearAllMocks()
})

describe('s2-dbus - initialization', () => {
  it('constructs S2DbusTransport from the referenced config and this node\'s own id', () => {
    setupNode({ id: 'my-node-id' })

    expect(capturedTransportOptions).toMatchObject({
      connectionMode: 'system',
      deviceType: 'acload',
      nodeId: 'my-node-id',
      measurementType: '3_PHASE_SYMMETRIC',
      nrOfPhases: 1,
      position: 0,
      phaseSetting: 1,
      autoCalculateEnergy: true
    })
  })

  it('shows an error status and does not construct a transport when the D-Bus config is missing', () => {
    const { node } = setupNode({}, null)
    expect(node.status as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({ fill: 'red', text: 'D-Bus config missing' }))
  })

  it('shows an error status and does not connect for an unrecognized deviceType', () => {
    const { node } = setupNode({}, { ...DEFAULT_DBUS_CONFIG, deviceType: 'nonsense' })

    expect(node.error as jest.Mock).toHaveBeenCalled()
    expect(node.status as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({ fill: 'red', text: 'invalid deviceType: nonsense' }))
    expect(mockTransport.connect).not.toHaveBeenCalled()
  })
})

describe('s2-dbus - transport event -> output message parity with s2-websocket', () => {
  it('emits Connect on the node output when the transport connects a CEM', () => {
    const { node } = setupNode({})

    mockTransport.emit('connect', 'cem-x', 300)

    expect(node.send as jest.Mock).toHaveBeenCalledWith({ payload: { command: 'Connect', cemId: 'cem', keepAliveInterval: 300 } })
  })

  it('emits Message on the node output when the transport receives a message', () => {
    const { node } = setupNode({})

    mockTransport.emit('message', 'cem-x', '{"message_type":"Handshake"}')

    expect(node.send as jest.Mock).toHaveBeenCalledWith({ payload: { command: 'Message', cemId: 'cem', message: '{"message_type":"Handshake"}' } })
  })

  it('emits Disconnect on the node output when the transport disconnects', () => {
    const { node } = setupNode({})

    mockTransport.emit('disconnect', 'cem-x')

    expect(node.send as jest.Mock).toHaveBeenCalledWith({ payload: { command: 'Disconnect', cemId: 'cem' } })
  })
})

describe('s2-dbus - s2Signal input handling', () => {
  it('forwards an s2Signal Message to the transport as a JSON string', () => {
    const { handlers } = setupNode({})

    handlers.input({ payload: { s2Signal: 'Message', message: { message_type: 'Handshake' } } }, jest.fn(), jest.fn())

    expect(mockTransport.send).toHaveBeenCalledWith(JSON.stringify({ message_type: 'Handshake' }))
  })

  it('sets S2/0/Active via the transport', () => {
    const { handlers } = setupNode({})

    handlers.input({ payload: { 'S2/0/Active': 1 } }, jest.fn(), jest.fn())

    expect(mockTransport.setActive).toHaveBeenCalledWith(1)
  })
})

describe('s2-dbus - power measurement cache', () => {
  it('immediately emits a cached value on PowerMeasurementStart', () => {
    const { node, handlers } = setupNode({})

    handlers.input({ payload: { 'Ac/Power': 1800 } }, jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()
    handlers.input({ payload: { s2Signal: 'PowerMeasurementStart' } }, jest.fn(), jest.fn())

    expect(node.send as jest.Mock).toHaveBeenCalledWith({
      payload: { command: 'PowerMeasurement', cemId: 'cem', values: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: 1800 }] }
    })
  })

  it('emits an updated value while active', () => {
    const { node, handlers } = setupNode({})
    handlers.input({ payload: { s2Signal: 'PowerMeasurementStart' } }, jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    handlers.input({ payload: { 'Ac/Power': 2100 } }, jest.fn(), jest.fn())

    expect(node.send as jest.Mock).toHaveBeenCalledWith({
      payload: { command: 'PowerMeasurement', cemId: 'cem', values: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: 2100 }] }
    })
  })

  it('stops emitting after PowerMeasurementStop', () => {
    const { node, handlers } = setupNode({})
    handlers.input({ payload: { s2Signal: 'PowerMeasurementStart' } }, jest.fn(), jest.fn())
    handlers.input({ payload: { s2Signal: 'PowerMeasurementStop' } }, jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    handlers.input({ payload: { 'Ac/Power': 3000 } }, jest.fn(), jest.fn())

    expect(node.send as jest.Mock).not.toHaveBeenCalled()
  })

  it('does not send a PowerMeasurement command to s2-rm before PowerMeasurementStart', () => {
    const { node, handlers } = setupNode({})

    handlers.input({ payload: { 'Ac/Power': 900 } }, jest.fn(), jest.fn())

    expect(node.send as jest.Mock).not.toHaveBeenCalled()
  })

  it('updates the D-Bus BusItem property even before PowerMeasurementStart (and splits evenly across per-phase properties, per 3-phase-symmetric)', () => {
    const { handlers } = setupNode({})

    handlers.input({ payload: { 'Ac/Power': 900 } }, jest.fn(), jest.fn())

    expect(mockTransport.setMeasurementValues).toHaveBeenCalledWith({ 'Ac/Power': 900, 'Ac/L1/Power': 300, 'Ac/L2/Power': 300, 'Ac/L3/Power': 300 })
  })

  it('updates the D-Bus BusItem property on every value update, independent of S2 activity', () => {
    const { handlers } = setupNode({})
    handlers.input({ payload: { s2Signal: 'PowerMeasurementStart' } }, jest.fn(), jest.fn())
    ;(mockTransport.setMeasurementValues as jest.Mock).mockClear()

    handlers.input({ payload: { 'Ac/Power': 2100 } }, jest.fn(), jest.fn())

    expect(mockTransport.setMeasurementValues).toHaveBeenCalledWith({ 'Ac/Power': 2100, 'Ac/L1/Power': 700, 'Ac/L2/Power': 700, 'Ac/L3/Power': 700 })
  })

  it('reads per-phase values when measurementType is L1_L2_L3', () => {
    const { node, handlers } = setupNode({}, { ...DEFAULT_DBUS_CONFIG, measurementType: 'L1_L2_L3', nrOfPhases: 3 })
    handlers.input({ payload: { s2Signal: 'PowerMeasurementStart' } }, jest.fn(), jest.fn())
    ;(node.send as jest.Mock).mockClear()

    handlers.input({ payload: { 'Ac/L1/Power': 100, 'Ac/L2/Power': 200, 'Ac/L3/Power': 300 } }, jest.fn(), jest.fn())

    expect(node.send as jest.Mock).toHaveBeenCalledWith({
      payload: {
        command: 'PowerMeasurement',
        cemId: 'cem',
        values: [
          { commodity_quantity: 'ELECTRIC.POWER.L1', value: 100 },
          { commodity_quantity: 'ELECTRIC.POWER.L2', value: 200 },
          { commodity_quantity: 'ELECTRIC.POWER.L3', value: 300 }
        ]
      }
    })
  })

  it('maps a scalar `values` input to the wired phase, proving nrOfPhases/phaseSetting reach PowerMeasurementCache', () => {
    const { handlers } = setupNode({}, { ...DEFAULT_DBUS_CONFIG, measurementType: 'L1_L2_L3', nrOfPhases: 1, phaseSetting: 2 })

    handlers.input({ payload: { values: 10 } }, jest.fn(), jest.fn())

    expect(mockTransport.setMeasurementValues).toHaveBeenCalledWith({ 'Ac/L2/Power': 10, 'Ac/Power': 10 })
  })

  it('warns and does not update the transport when a `values` array is sent to a single-phase device', () => {
    const { node, handlers } = setupNode({}, { ...DEFAULT_DBUS_CONFIG, measurementType: 'L1_L2_L3', nrOfPhases: 1, phaseSetting: 2 })

    handlers.input({ payload: { values: [11, 22, 33] } }, jest.fn(), jest.fn())

    expect(node.warn as jest.Mock).toHaveBeenCalledWith(expect.stringContaining('single-phase'))
    // Called with an empty object (a harmless no-op - S2DbusTransport.setMeasurementValues
    // itself ignores an empty update) since nothing was actually cached from the rejected array.
    expect(mockTransport.setMeasurementValues).toHaveBeenCalledWith({})
  })
})

describe('s2-dbus - debug logging', () => {
  it('publishes inbound messages to the debug sidebar when debug is enabled', () => {
    const { RED } = setupNode({ debug: true })

    mockTransport.emit('message', 'cem-1', JSON.stringify({ message_type: 'HandshakeResponse' }))

    expect(RED.comms.publish as jest.Mock).toHaveBeenCalledWith(
      'debug',
      expect.objectContaining({ topic: '<- from CEM cem-1', msg: { message_type: 'HandshakeResponse' } }),
      false
    )
  })

  it('publishes outbound messages to the debug sidebar when debug is enabled', () => {
    const { RED, handlers } = setupNode({ debug: true })

    handlers.input({ payload: { s2Signal: 'Message', message: { message_type: 'Handshake' } } }, jest.fn(), jest.fn())

    expect(RED.comms.publish as jest.Mock).toHaveBeenCalledWith(
      'debug',
      expect.objectContaining({ topic: '-> to CEM cem', msg: { message_type: 'Handshake' } }),
      false
    )
  })

  it('does not publish to the debug sidebar when debug is disabled', () => {
    const { RED, handlers } = setupNode({ debug: false })

    mockTransport.emit('message', 'cem-1', JSON.stringify({ message_type: 'HandshakeResponse' }))
    handlers.input({ payload: { s2Signal: 'Message', message: { message_type: 'Handshake' } } }, jest.fn(), jest.fn())

    expect(RED.comms.publish as jest.Mock).not.toHaveBeenCalled()
  })

  it('publishes a Connect entry to the debug sidebar with the real D-Bus cemId', () => {
    const { RED } = setupNode({ debug: true })

    mockTransport.emit('connect', 'cem-1', 300)

    expect(RED.comms.publish as jest.Mock).toHaveBeenCalledWith(
      'debug',
      expect.objectContaining({ topic: '<- from CEM cem-1 (Connect)', msg: { cemId: 'cem-1', keepAliveInterval: 300 } }),
      false
    )
  })

  it('publishes a Disconnect entry to the debug sidebar with the real D-Bus cemId', () => {
    const { RED } = setupNode({ debug: true })
    mockTransport.emit('connect', 'cem-1', 300)
    ;(RED.comms.publish as jest.Mock).mockClear()

    mockTransport.emit('disconnect', 'cem-1')

    expect(RED.comms.publish as jest.Mock).toHaveBeenCalledWith(
      'debug',
      expect.objectContaining({ topic: '<- from CEM cem-1 (Disconnect)', msg: { cemId: 'cem-1' } }),
      false
    )
  })

  it('uses the real connected D-Bus cemId (not the internal placeholder) in outbound debug topics', () => {
    const { RED, handlers } = setupNode({ debug: true })
    mockTransport.emit('connect', 'cem-1', 300)

    handlers.input({ payload: { s2Signal: 'Message', message: { message_type: 'Handshake' } } }, jest.fn(), jest.fn())

    expect(RED.comms.publish as jest.Mock).toHaveBeenCalledWith(
      'debug',
      expect.objectContaining({ topic: '-> to CEM cem-1' }),
      false
    )
  })
})
