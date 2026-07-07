/**
 * Integration tests for S2WebSocketTransport reconnection behaviour.
 *
 * These tests use a real ws.Server on localhost so the full network path
 * (TCP connect, ping/pong, close) is exercised without any mocking.
 *
 * A short reconnectInterval (50 ms) keeps the suite fast while still
 * testing real async timing.
 */

import { AddressInfo } from 'net'
import { WebSocketServer } from 'ws'
import { S2WebSocketTransport } from '../../src/lib/transport/websocket'

const RECONNECT_MS = 50
const WAIT_MS = RECONNECT_MS * 6   // enough time for several reconnect cycles

jest.setTimeout(10_000)

function makeTransport (port: number): S2WebSocketTransport {
  return new S2WebSocketTransport({
    url: `ws://127.0.0.1:${port}`,
    reconnectInterval: RECONNECT_MS,
    maxReconnectInterval: RECONNECT_MS * 4
  })
}

function startServer (): Promise<WebSocketServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    wss.on('listening', () => resolve(wss))
  })
}

function stopServer (wss: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    // Terminate all open client sockets first so 'close' fires promptly
    wss.clients.forEach(c => c.terminate())
    wss.close(err => (err ? reject(err) : resolve()))
  })
}

function wait (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('S2WebSocketTransport - integration (real server)', () => {
  let wss: WebSocketServer
  let port: number
  let transport: S2WebSocketTransport

  afterEach(async () => {
    transport.disconnect()
    if (wss) await stopServer(wss)
  })

  it('connects to a running server', async () => {
    wss = await startServer()
    port = (wss.address() as AddressInfo).port
    transport = makeTransport(port)

    const opened = new Promise<void>(resolve => transport.once('open', resolve))
    transport.connect()
    await opened
  })

  it('reconnects after server closes the connection', async () => {
    wss = await startServer()
    port = (wss.address() as AddressInfo).port
    transport = makeTransport(port)

    let openCount = 0
    transport.on('open', () => { openCount++ })

    const firstOpen = new Promise<void>(resolve => transport.once('open', resolve))
    transport.connect()
    await firstOpen

    // Server-side: terminate the client socket to force a disconnect
    wss.clients.forEach(c => c.terminate())

    await wait(WAIT_MS)
    expect(openCount).toBeGreaterThanOrEqual(2)
  })

  it('retries until the server becomes available', async () => {
    // Use a fixed port that has nothing listening yet
    port = await getFreePort()
    transport = makeTransport(port)

    const errors: Error[] = []
    transport.on('error', (e: Error) => errors.push(e))

    let openCount = 0
    transport.on('open', () => { openCount++ })

    transport.connect()

    // No server yet - should produce connection errors and keep retrying
    await wait(WAIT_MS)
    expect(errors.length).toBeGreaterThan(0)
    expect(openCount).toBe(0)

    // Now start the server on the same port
    wss = new WebSocketServer({ host: '127.0.0.1', port })
    await new Promise<void>(resolve => wss.on('listening', resolve))

    const connected = new Promise<void>(resolve => transport.once('open', resolve))
    await connected
    expect(openCount).toBe(1)
  })

  it('reconnects multiple times after repeated server restarts', async () => {
    wss = await startServer()
    port = (wss.address() as AddressInfo).port
    transport = makeTransport(port)

    let openCount = 0
    transport.on('open', () => { openCount++ })

    const firstOpen = new Promise<void>(resolve => transport.once('open', resolve))
    transport.connect()
    await firstOpen
    expect(openCount).toBe(1)

    // Cycle the server twice
    for (let i = 0; i < 2; i++) {
      await stopServer(wss)

      wss = new WebSocketServer({ host: '127.0.0.1', port })
      await new Promise<void>(resolve => wss.on('listening', resolve))

      const reopen = new Promise<void>(resolve => transport.once('open', resolve))
      await reopen
    }

    expect(openCount).toBe(3)
  })

  it('does not reconnect after intentional disconnect()', async () => {
    wss = await startServer()
    port = (wss.address() as AddressInfo).port
    transport = makeTransport(port)

    const firstOpen = new Promise<void>(resolve => transport.once('open', resolve))
    transport.connect()
    await firstOpen

    let openAfterDisconnect = 0
    transport.on('open', () => { openAfterDisconnect++ })

    transport.disconnect()

    await wait(WAIT_MS)
    expect(openAfterDisconnect).toBe(0)
  })

  it('emits activity on open and on message', async () => {
    wss = await startServer()
    port = (wss.address() as AddressInfo).port
    transport = makeTransport(port)

    const activities: Date[] = []
    transport.on('activity', (d: Date) => activities.push(d))

    const firstOpen = new Promise<void>(resolve => transport.once('open', resolve))
    transport.connect()
    await firstOpen

    expect(activities).toHaveLength(1) // open
    expect(activities[0]).toBeInstanceOf(Date)

    // Send a message from server to client
    const msgReceived = new Promise<void>(resolve => transport.once('message', () => resolve()))
    wss.clients.forEach(c => c.send(JSON.stringify({ hello: 'world' })))
    await msgReceived

    expect(activities).toHaveLength(2) // open + message
  })
})

// ---------------------------------------------------------------------------

function getFreePort (): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    server.on('listening', () => {
      const { port } = server.address() as AddressInfo
      server.close(err => (err ? reject(err) : resolve(port)))
    })
  })
}
