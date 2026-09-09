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

export interface NodeRedContextStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export interface NodeRedContext {
  global: NodeRedContextStore
  flow: NodeRedContextStore
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export interface NodeRedNode {
  id: string
  name: string
  /** Flow tab id, set by RED.nodes.createNode(). Used to target debug-sidebar messages at the
   * right tab, matching what the core Debug node's own sendDebug() includes. */
  z?: string
  /** Subflow parentage chain, set by RED.nodes.createNode(). Only present when nested inside a
   * subflow; lets the debug sidebar render an accurate breadcrumb and reveal the right instance. */
  _flow?: { path: string }
  send(msgs: NodeMessage | Array<NodeMessage | null> | null): void
  error(logMessage: string, msg?: NodeMessage): void
  warn(logMessage: string, msg?: NodeMessage): void
  log(logMessage: string): void
  debug(logMessage: string): void
  trace(logMessage: string): void
  status(status: NodeRedStatus | Record<string, never>): void
  context(): NodeRedContext
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

export interface NodeRedComms {
  /** Publishes to the editor's websocket comms channel. Topic 'debug' is what the core Debug
   * node's sidebar view listens on - publishing there directly puts a message into the Debug
   * sidebar without requiring a Debug node to be wired in. */
  publish(topic: string, data: unknown, retain?: boolean): void
}

export interface NodeRedApp {
  nodes: NodeRedNodes
  settings?: { userDir?: string }
  comms: NodeRedComms
}
