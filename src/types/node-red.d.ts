/**
 * Minimal type stubs for the Node-RED RED object.
 * Official @types/node-red does not exist; these cover what s2-rm and s2-websocket use.
 */

export interface NodeRedStatus {
  fill?: 'red' | 'green' | 'yellow' | 'blue' | 'grey'
  shape?: 'ring' | 'dot'
  text?: string
}

export interface NodeMessage {
  payload?: unknown
  cemId?: string
  topic?: string
  [key: string]: unknown
}

export type DoneFunction = (err?: Error) => void
export type SendFunction = (msgs: NodeMessage | Array<NodeMessage | null> | null) => void

export interface NodeRedNode {
  id: string
  name: string
  send(msgs: NodeMessage | Array<NodeMessage | null> | null): void
  error(logMessage: string, msg?: NodeMessage): void
  warn(logMessage: string, msg?: NodeMessage): void
  log(logMessage: string): void
  debug(logMessage: string): void
  trace(logMessage: string): void
  status(status: NodeRedStatus | Record<string, never>): void
  on(event: 'input', listener: (msg: NodeMessage, send: SendFunction, done: DoneFunction) => void): this
  on(event: 'close', listener: (done: () => void) => void): this
  on(event: string, listener: (...args: unknown[]) => void): this
}

export interface NodeConfig {
  id: string
  type: string
  name?: string
  [key: string]: unknown
}

export interface NodeRedCredentialType {
  type: 'text' | 'password'
}

export interface NodeRedTypeOptions {
  credentials?: Record<string, NodeRedCredentialType>
}

export interface NodeRedNodes {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createNode(node: NodeRedNode, config: NodeConfig): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerType(type: string, constructor: any, options?: NodeRedTypeOptions): void
  getNode(id: string): NodeRedNode | null
}

export interface NodeRedApp {
  nodes: NodeRedNodes
}
