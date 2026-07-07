import { EventEmitter } from 'events'
import WebSocket from 'ws'

export interface S2WebSocketTransportOptions {
  url: string
  reconnectInterval?: number
  maxReconnectInterval?: number
  headers?: Record<string, string>
}

/**
 * S2WebSocketTransport manages a single outbound WebSocket connection
 * from an RM to a CEM. It is a thin EventEmitter wrapper around `ws`
 * with automatic reconnection, exponential backoff, and heartbeat.
 *
 * Events:
 *   'open'    - WS connection established
 *   'message' - raw string received from CEM, arg: string
 *   'close'   - connection closed
 *   'error'   - error occurred, arg: Error
 *
 * @example
 * const transport = new S2WebSocketTransport({ url: 'wss://cem.local/s2/{resourceId}' })
 * transport.on('open', () => { transport.send(JSON.stringify(handshake)) })
 * transport.on('message', (raw) => handleMessage(raw))
 * transport.on('close', () => handleDisconnect())
 * transport.connect()
 */
export class S2WebSocketTransport extends EventEmitter {
  private readonly _url: string
  private readonly _initialReconnectInterval: number
  private readonly _maxReconnectInterval: number
  private readonly _headers: Record<string, string> | undefined
  private _ws: WebSocket | null
  private _reconnectTimer: ReturnType<typeof setTimeout> | null
  private _heartbeatTimer: ReturnType<typeof setInterval> | null
  private _intentionalClose: boolean
  private _currentReconnectInterval: number
  private _isAlive: boolean
  private _lastContact: Date | null

  constructor ({ url, reconnectInterval = 5000, maxReconnectInterval = 30000, headers }: S2WebSocketTransportOptions) {
    super()
    this._url = url
    this._initialReconnectInterval = reconnectInterval
    this._maxReconnectInterval = maxReconnectInterval
    this._headers = headers
    this._ws = null
    this._reconnectTimer = null
    this._heartbeatTimer = null
    this._intentionalClose = false
    this._currentReconnectInterval = reconnectInterval
    this._isAlive = false
    this._lastContact = null
  }

  /**
   * Initiate the WebSocket connection to the CEM.
   */
  connect (): void {
    this._intentionalClose = false
    this._doConnect()
  }

  /**
   * Close the WebSocket connection and stop reconnecting.
   */
  disconnect (): void {
    this._intentionalClose = true
    this._stopHeartbeat()
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
    if (this._ws) {
      this._ws.terminate()
      this._ws = null
    }
  }

  /**
   * Send a raw string over the WebSocket. Throws if not connected.
   */
  send (raw: string): void {
    if (!this._ws) {
      throw new Error('WebSocket is not connected')
    }
    this._ws.send(raw)
  }

  get url (): string {
    return this._url
  }

  get lastContact (): Date | null {
    return this._lastContact
  }

  // -- private --

  private _recordActivity (): void {
    this._isAlive = true
    this._lastContact = new Date()
    this.emit('activity', this._lastContact)
  }

  private _doConnect (): void {
    const ws = this._headers
      ? new WebSocket(this._url, { headers: this._headers })
      : new WebSocket(this._url)
    this._ws = ws

    ws.on('open', () => {
      this._currentReconnectInterval = this._initialReconnectInterval
      this._recordActivity()
      this._startHeartbeat()
      this.emit('open')
    })

    ws.on('message', (data) => {
      this._recordActivity()
      this.emit('message', data.toString())
    })

    ws.on('pong', () => {
      this._recordActivity()
    })

    ws.on('close', () => {
      this._ws = null
      this._stopHeartbeat()
      this.emit('close')
      if (!this._intentionalClose) {
        this._scheduleReconnect()
      }
    })

    ws.on('error', (err) => {
      this.emit('error', err)
      // 'close' will fire after 'error', reconnect is handled there
    })
  }

  private _startHeartbeat (): void {
    this._stopHeartbeat()
    this._heartbeatTimer = setInterval(() => {
      if (this._isAlive === false) {
        if (this._ws) {
          this._ws.terminate()
        }
        return
      }
      this._isAlive = false
      if (this._ws) {
        this._ws.ping()
      }
    }, 30000)
  }

  private _stopHeartbeat (): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = null
    }
  }

  private _scheduleReconnect (): void {
    if (this._reconnectTimer) return

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      this._doConnect()
    }, this._currentReconnectInterval)

    // Increase interval for next time
    this._currentReconnectInterval = Math.min(
      this._currentReconnectInterval * 2,
      this._maxReconnectInterval
    )
  }
}
