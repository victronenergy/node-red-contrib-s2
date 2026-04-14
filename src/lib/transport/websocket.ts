import { EventEmitter } from 'events'
import WebSocket from 'ws'

export interface S2WebSocketTransportOptions {
  url: string
  reconnectInterval?: number
  headers?: Record<string, string>
}

/**
 * S2WebSocketTransport manages a single outbound WebSocket connection
 * from an RM to a CEM. It is a thin EventEmitter wrapper around `ws`
 * with automatic reconnection.
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
  private readonly _reconnectInterval: number
  private readonly _headers: Record<string, string> | undefined
  private _ws: WebSocket | null
  private _reconnectTimer: ReturnType<typeof setTimeout> | null
  private _intentionalClose: boolean

  constructor ({ url, reconnectInterval = 5000, headers }: S2WebSocketTransportOptions) {
    super()
    this._url = url
    this._reconnectInterval = reconnectInterval
    this._headers = headers
    this._ws = null
    this._reconnectTimer = null
    this._intentionalClose = false
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

  // -- private --

  private _doConnect (): void {
    const ws = this._headers
      ? new WebSocket(this._url, { headers: this._headers })
      : new WebSocket(this._url)
    this._ws = ws

    ws.on('open', () => {
      this.emit('open')
    })

    ws.on('message', (data) => {
      this.emit('message', data.toString())
    })

    ws.on('close', () => {
      this._ws = null
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

  private _scheduleReconnect (): void {
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      this._doConnect()
    }, this._reconnectInterval)
  }
}
