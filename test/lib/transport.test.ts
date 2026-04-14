import WebSocket from 'ws'
import { S2WebSocketTransport } from '../../src/lib/transport/websocket'

jest.mock('ws')

const MockWebSocket = WebSocket as jest.MockedClass<typeof WebSocket>

beforeEach(() => {
  MockWebSocket.mockClear()
  MockWebSocket.mockReturnValue({
    on: jest.fn(),
    send: jest.fn(),
    terminate: jest.fn()
  } as unknown as WebSocket)
})

describe('S2WebSocketTransport - headers', () => {
  it('passes Authorization header as second WebSocket constructor argument', () => {
    const transport = new S2WebSocketTransport({
      url: 'wss://example.com/s2',
      headers: { Authorization: 'Basic dXNlcjpwYXNz' }
    })
    transport.connect()

    expect(MockWebSocket.mock.calls[0]).toHaveLength(2)
    expect(MockWebSocket.mock.calls[0][1]).toEqual({
      headers: { Authorization: 'Basic dXNlcjpwYXNz' }
    })
  })

  it('passes no options argument when headers are not provided', () => {
    const transport = new S2WebSocketTransport({ url: 'ws://example.com/s2' })
    transport.connect()

    expect(MockWebSocket.mock.calls[0]).toHaveLength(1)
  })

  it('preserves other headers alongside Authorization', () => {
    const transport = new S2WebSocketTransport({
      url: 'ws://example.com/s2',
      headers: { Authorization: 'Bearer token', 'X-Custom': 'value' }
    })
    transport.connect()

    expect(MockWebSocket.mock.calls[0][1]).toEqual({
      headers: { Authorization: 'Bearer token', 'X-Custom': 'value' }
    })
  })
})
