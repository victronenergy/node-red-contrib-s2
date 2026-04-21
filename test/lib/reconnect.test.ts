import WebSocket from 'ws'
import { S2WebSocketTransport } from '../../src/lib/transport/websocket'

jest.mock('ws')
jest.useFakeTimers()

const MockWebSocket = WebSocket as jest.MockedClass<typeof WebSocket>

describe('S2WebSocketTransport Reconnection Logic', () => {
  let transport: S2WebSocketTransport
  const url = 'ws://example.com/s2'
  const reconnectInterval = 1000

  beforeEach(() => {
    jest.clearAllMocks()
    jest.clearAllTimers()
    MockWebSocket.mockReturnValue({
      on: jest.fn(),
      send: jest.fn(),
      terminate: jest.fn(),
      ping: jest.fn()
    } as unknown as WebSocket)
    transport = new S2WebSocketTransport({ url, reconnectInterval })
  })

  it('attempts to reconnect when the connection is closed', () => {
    transport.connect()
    expect(MockWebSocket).toHaveBeenCalledTimes(1)

    const wsInstance = MockWebSocket.mock.results[0].value
    const closeHandler = (wsInstance.on as jest.Mock).mock.calls.find(call => call[0] === 'close')[1]

    // Simulate connection closure
    closeHandler()

    // Should not have reconnected immediately
    expect(MockWebSocket).toHaveBeenCalledTimes(1)

    // Advance time by the reconnect interval
    jest.advanceTimersByTime(reconnectInterval)

    // Should have attempted to reconnect
    expect(MockWebSocket).toHaveBeenCalledTimes(2)
  })

  it('continues to reconnect indefinitely if connection fails (with backoff)', () => {
    transport.connect()

    let currentInterval = reconnectInterval

    for (let i = 1; i <= 5; i++) {
      const wsInstance = MockWebSocket.mock.results[i - 1].value
      const closeHandler = (wsInstance.on as jest.Mock).mock.calls.find(call => call[0] === 'close')[1]
      closeHandler()
      
      jest.advanceTimersByTime(currentInterval)
      expect(MockWebSocket).toHaveBeenCalledTimes(i + 1)
      
      currentInterval = Math.min(currentInterval * 2, 30000) // 30000 is default max
    }
  })

  it('implements exponential backoff', () => {
    transport.connect()
    
    // First failure
    const ws1 = MockWebSocket.mock.results[0].value
    const close1 = (ws1.on as jest.Mock).mock.calls.find(call => call[0] === 'close')[1]
    close1()
    
    jest.advanceTimersByTime(reconnectInterval)
    expect(MockWebSocket).toHaveBeenCalledTimes(2)
    
    // Second failure
    const ws2 = MockWebSocket.mock.results[1].value
    const close2 = (ws2.on as jest.Mock).mock.calls.find(call => call[0] === 'close')[1]
    close2()
    
    jest.advanceTimersByTime(reconnectInterval) // Not enough time now
    expect(MockWebSocket).toHaveBeenCalledTimes(2) 
    
    jest.advanceTimersByTime(reconnectInterval) // Total 2*reconnectInterval
    expect(MockWebSocket).toHaveBeenCalledTimes(3)
  })

  it('auto-reconnects after disconnect() followed by connect() and an unintentional close', () => {
    transport.connect()
    const ws1 = MockWebSocket.mock.results[0].value as any
    const open1 = (ws1.on as jest.Mock).mock.calls.find(call => call[0] === 'open')[1]
    open1()

    // Intentional disconnect then reconnect (e.g. manual Reconnect command)
    transport.disconnect()
    transport.connect()

    const ws2 = MockWebSocket.mock.results[1].value as any
    const close2 = (ws2.on as jest.Mock).mock.calls.find(call => call[0] === 'close')[1]

    // Unintentional close after the manual reconnect
    close2()

    jest.advanceTimersByTime(reconnectInterval)
    expect(MockWebSocket).toHaveBeenCalledTimes(3)
  })

  it('resets backoff on successful connection', () => {
    transport.connect()
    
    // Fail once
    const ws1 = MockWebSocket.mock.results[0].value
    const close1 = (ws1.on as jest.Mock).mock.calls.find(call => call[0] === 'close')[1]
    close1()
    
    jest.advanceTimersByTime(reconnectInterval)
    expect(MockWebSocket).toHaveBeenCalledTimes(2) // Attempt 2
    
    // Connect successfully
    const ws2 = MockWebSocket.mock.results[1].value
    const open2 = (ws2.on as jest.Mock).mock.calls.find(call => call[0] === 'open')[1]
    open2()
    
    // Fail again
    const close2 = (ws2.on as jest.Mock).mock.calls.find(call => call[0] === 'close')[1]
    close2()
    
    // Should reconnect after initial interval, not backoff interval
    jest.advanceTimersByTime(reconnectInterval)
    expect(MockWebSocket).toHaveBeenCalledTimes(3)
  })

  it('terminates the connection if heartbeat fails', () => {
    transport.connect()
    const ws = MockWebSocket.mock.results[0].value as any
    
    // Trigger open
    const openHandler = (ws.on as jest.Mock).mock.calls.find(call => call[0] === 'open')[1]
    openHandler()
    
    // Heartbeat should have started. Advance time by 30s + small margin.
    // The first ping happens after 30s.
    jest.advanceTimersByTime(30001)
    expect(ws.ping).toHaveBeenCalled()
    
    // Simulate NO pong by advancing another 30s.
    // At 60s, the next check happens. Since isAlive was set to false at 30s and no pong occurred, it should terminate.
    jest.advanceTimersByTime(30001)
    expect(ws.terminate).toHaveBeenCalled()
  })

  it('stays alive if pong is received', () => {
    transport.connect()
    const ws = MockWebSocket.mock.results[0].value as any
    
    const openHandler = (ws.on as jest.Mock).mock.calls.find(call => call[0] === 'open')[1]
    const pongHandler = (ws.on as jest.Mock).mock.calls.find(call => call[0] === 'pong')[1]
    openHandler()
    
    // First interval: 30s
    jest.advanceTimersByTime(30001)
    expect(ws.ping).toHaveBeenCalledTimes(1)
    
    // Simulate pong
    pongHandler()
    
    // Second interval: 60s
    jest.advanceTimersByTime(30001)
    expect(ws.ping).toHaveBeenCalledTimes(2)
    expect(ws.terminate).not.toHaveBeenCalled()
  })

  it('emits activity event on message, pong, and open', () => {
    const activitySpy = jest.fn()
    transport.on('activity', activitySpy)
    
    transport.connect()
    const ws = MockWebSocket.mock.results[0].value as any
    
    // 1. Open
    const openHandler = (ws.on as jest.Mock).mock.calls.find(call => call[0] === 'open')[1]
    openHandler()
    expect(activitySpy).toHaveBeenCalledTimes(1)
    
    // 2. Message
    const messageHandler = (ws.on as jest.Mock).mock.calls.find(call => call[0] === 'message')[1]
    messageHandler(Buffer.from('test'))
    expect(activitySpy).toHaveBeenCalledTimes(2)
    
    // 3. Pong
    const pongHandler = (ws.on as jest.Mock).mock.calls.find(call => call[0] === 'pong')[1]
    pongHandler()
    expect(activitySpy).toHaveBeenCalledTimes(3)
    
    expect(activitySpy.mock.calls[0][0]).toBeInstanceOf(Date)
  })
})
