import { EventEmitter } from 'events'
import registerNode from '../../src/nodes/s2-websocket/index'

// --- Transport mock ---

let mockTransport: EventEmitter & { connect: jest.Mock, disconnect: jest.Mock, send: jest.Mock }
let capturedTransportOptions: Record<string, unknown>

jest.mock('../../src/lib/transport/websocket', () => ({
  S2WebSocketTransport: jest.fn().mockImplementation((opts: Record<string, unknown>) => {
    capturedTransportOptions = opts
    return mockTransport
  })
}))

// --- Test helpers ---

const DEFAULT_CEM_CONFIG = {
  url: 'wss://api.example.com/s2-message-handler/ws/{resourceId}',
  credentials: { username: 'testuser', password: 'testpass' }
}

const DEFAULT_RM_CONFIG = {
  resourceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
}

function setupNode (
  config: Record<string, unknown>,
  cemConfig: unknown = DEFAULT_CEM_CONFIG,
  rmConfig: unknown = DEFAULT_RM_CONFIG
) {
  const merged: Record<string, unknown> = { cem: 'cem-cfg', rmConfig: 'rm-cfg', ...config, id: config.id || 'node-test-id' }

  const handlers: Record<string, (...args: unknown[]) => void> = {}
  const node: Record<string, unknown> = {
    id: merged.id,
    name: (merged.name as string) || '',
    send: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
    status: jest.fn(),
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => { handlers[event] = handler })
  }

  const RED = {
    nodes: {
      createNode: jest.fn((n: Record<string, unknown>) => { Object.assign(n, node) }),
      registerType: jest.fn(),
      getNode: jest.fn((id: string) => {
        if (id === merged.cem) return cemConfig
        if (id === merged.rmConfig) return rmConfig
        return null
      })
    }
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
  const emitter = new EventEmitter() as EventEmitter & { connect: jest.Mock, disconnect: jest.Mock, send: jest.Mock }
  emitter.connect = jest.fn()
  emitter.disconnect = jest.fn()
  emitter.send = jest.fn()
  mockTransport = emitter
  capturedTransportOptions = {}
  jest.clearAllMocks()
})

// --- Tests ---

describe('s2-websocket - initialization', () => {
  it('substitutes {resourceId} in the URL template', () => {
    setupNode({})

    expect(capturedTransportOptions.url).toBe(
      'wss://api.example.com/s2-message-handler/ws/a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    )
  })

  it('appends resourceId to URL when no {resourceId} placeholder is present', () => {
    setupNode({}, { url: 'wss://cem.example.com/s2/ws/', credentials: {} })

    expect(capturedTransportOptions.url).toBe(
      'wss://cem.example.com/s2/ws/a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    )
  })

  it('adds trailing slash before resourceId when URL has no placeholder and no trailing slash', () => {
    setupNode({}, { url: 'wss://cem.example.com/s2/ws', credentials: {} })

    expect(capturedTransportOptions.url).toBe(
      'wss://cem.example.com/s2/ws/a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    )
  })

  it('builds Basic auth header from config credentials', () => {
    setupNode({})

    const expected = 'Basic ' + Buffer.from('testuser:testpass').toString('base64')
    expect(capturedTransportOptions.headers).toEqual({ Authorization: expected })
  })

  it('omits headers when credentials are empty', () => {
    setupNode({}, { url: 'ws://localhost/s2/{resourceId}', credentials: {} })

    expect(capturedTransportOptions.headers).toBeUndefined()
  })

  it('uses configured reconnectInterval (converted to ms)', () => {
    setupNode({ reconnectInterval: 10 })

    expect(capturedTransportOptions.reconnectInterval).toBe(10000)
  })

  it('defaults reconnectInterval to 5s', () => {
    setupNode({})

    expect(capturedTransportOptions.reconnectInterval).toBe(5000)
  })

  it('calls transport.connect() on startup', () => {
    setupNode({})

    expect(mockTransport.connect).toHaveBeenCalledTimes(1)
  })

  it('sets connecting status on startup', () => {
    const { node } = setupNode({})

    expect(node.status as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ fill: 'yellow', text: expect.stringContaining('connect') })
    )
  })

  it('sets error status when CEM config is missing', () => {
    const { node } = setupNode({}, null)

    expect(node.status as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({ fill: 'red' }))
    expect(mockTransport.connect).not.toHaveBeenCalled()
  })

  it('sets error status when RM config is missing', () => {
    const { node } = setupNode({}, DEFAULT_CEM_CONFIG, null)

    expect(node.status as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({ fill: 'red' }))
    expect(mockTransport.connect).not.toHaveBeenCalled()
  })
})

describe('s2-websocket - transport open', () => {
  it('emits Connect command with cemId "cem" on transport open', () => {
    const { node } = setupNode({})

    mockTransport.emit('open')

    expect(node.send as jest.Mock).toHaveBeenCalledWith({
      payload: { command: 'Connect', cemId: 'cem', keepAliveInterval: 0 }
    })
  })

  it('updates status to connected on transport open', () => {
    const { node } = setupNode({})
    ;(node.status as jest.Mock).mockClear()

    mockTransport.emit('open')

    expect(node.status as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ fill: 'green', text: 'connected' })
    )
  })
})

describe('s2-websocket - transport message', () => {
  it('emits Message command with raw string on transport message', () => {
    const { node } = setupNode({})
    const raw = '{"message_type":"HandshakeResponse","message_id":"hr1"}'

    mockTransport.emit('message', raw)

    expect(node.send as jest.Mock).toHaveBeenCalledWith({
      payload: { command: 'Message', cemId: 'cem', message: raw }
    })
  })
})

describe('s2-websocket - transport close', () => {
  it('emits Disconnect command on transport close', () => {
    const { node } = setupNode({})

    mockTransport.emit('close')

    expect(node.send as jest.Mock).toHaveBeenCalledWith({
      payload: { command: 'Disconnect', cemId: 'cem' }
    })
  })

  it('shows reconnecting status after first successful connection', () => {
    const { node } = setupNode({})
    mockTransport.emit('open')
    ;(node.status as jest.Mock).mockClear()

    mockTransport.emit('close')

    expect(node.status as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'reconnecting...' })
    )
  })

  it('shows disconnected status if never connected', () => {
    const { node } = setupNode({})
    ;(node.status as jest.Mock).mockClear()

    mockTransport.emit('close')

    expect(node.status as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ fill: 'red', text: 'disconnected' })
    )
  })
})

describe('s2-websocket - input handling', () => {
  it('serializes and sends Message signal over WebSocket', () => {
    const { handlers } = setupNode({})
    const message = { message_type: 'PowerMeasurement', message_id: 'pm1', values: [] }

    const done = jest.fn()
    handlers.input({ payload: { s2Signal: 'Message', message } }, jest.fn(), done)

    expect(mockTransport.send).toHaveBeenCalledWith(JSON.stringify(message))
    expect(done).toHaveBeenCalledWith()
  })

  it('errors when Message signal has no message object', () => {
    const { handlers } = setupNode({})

    const done = jest.fn()
    handlers.input({ payload: { s2Signal: 'Message' } }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith(expect.any(Error))
    expect(mockTransport.send).not.toHaveBeenCalled()
  })

  it('handles PowerMeasurementStart without error and without sending', () => {
    const { handlers } = setupNode({})

    const done = jest.fn()
    handlers.input(
      { payload: { s2Signal: 'PowerMeasurementStart', commodityQuantities: ['ELECTRIC.POWER.3_PHASE_SYMMETRIC'] } },
      jest.fn(),
      done
    )

    expect(mockTransport.send).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalledWith()
  })

  it('handles unknown s2Signal without error', () => {
    const { handlers } = setupNode({})

    const done = jest.fn()
    handlers.input({ payload: { s2Signal: 'UnknownSignal' } }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith()
  })

  it('handles non-object payload without error', () => {
    const { handlers } = setupNode({})

    const done = jest.fn()
    handlers.input({ payload: null }, jest.fn(), done)

    expect(done).toHaveBeenCalledWith()
  })

  it('warns (does not throw) when send fails due to disconnection', () => {
    const { node, handlers } = setupNode({})
    mockTransport.send.mockImplementation(() => { throw new Error('not connected') })

    const done = jest.fn()
    handlers.input({ payload: { s2Signal: 'Message', message: { message_type: 'x' } } }, jest.fn(), done)

    expect(node.warn as jest.Mock).toHaveBeenCalled()
    expect(done).toHaveBeenCalledWith()
  })
})

describe('s2-websocket - node close', () => {
  it('calls transport.disconnect() and clears status', () => {
    const { node, handlers } = setupNode({})

    const done = jest.fn()
    handlers.close(done)

    expect(mockTransport.disconnect).toHaveBeenCalled()
    expect(node.status as jest.Mock).toHaveBeenCalledWith({})
    expect(done).toHaveBeenCalled()
  })
})

describe('s2-websocket - debug logging', () => {
  it('logs outbound messages when debug is enabled', () => {
    const { node, handlers } = setupNode({ debug: true })

    handlers.input(
      { payload: { s2Signal: 'Message', message: { message_type: 'Handshake' } } },
      jest.fn(),
      jest.fn()
    )

    expect(node.log as jest.Mock).toHaveBeenCalledWith(expect.stringContaining('Handshake'))
  })

  it('does not log message content when debug is disabled', () => {
    const { node, handlers } = setupNode({ debug: false })
    ;(node.log as jest.Mock).mockClear()

    handlers.input(
      { payload: { s2Signal: 'Message', message: { message_type: 'Handshake' } } },
      jest.fn(),
      jest.fn()
    )

    expect(node.log as jest.Mock).not.toHaveBeenCalledWith(expect.stringContaining('Handshake'))
  })
})
