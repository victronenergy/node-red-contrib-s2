import { readFileSync } from 'fs'
import { join } from 'path'
import { runInNewContext } from 'vm'
import registerNode from '../../src/nodes/s2-frbc/index'

function exampleConfigNode (): Record<string, unknown> {
  const window: Record<string, unknown> = {}
  runInNewContext(readFileSync(join(__dirname, '../../resources/s2-frbc-editor.js'), 'utf8'), { window })
  const editor = window.__s2FrbcEditor as { exampleSystemDescription: () => string, exampleLeakageBehaviour: () => string }
  return { systemDescription: editor.exampleSystemDescription(), leakageBehaviour: editor.exampleLeakageBehaviour() }
}

function setupNode (frbcConfigNode: unknown = exampleConfigNode()) {
  const handlers: Record<string, (...args: unknown[]) => void> = {}
  const nodeContext: Record<string, unknown> = {}
  const node: Record<string, unknown> = {
    id: 'frbc-node-id',
    send: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    status: jest.fn(),
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => { handlers[event] = handler }),
    context: jest.fn(() => ({
      get: jest.fn((key: string) => nodeContext[key]),
      set: jest.fn((key: string, value: unknown) => { nodeContext[key] = value })
    }))
  }
  let Constructor: ((this: Record<string, unknown>, config: Record<string, unknown>) => void) | null = null
  const RED = {
    nodes: {
      createNode: jest.fn((n: Record<string, unknown>) => { Object.assign(n, node) }),
      registerType: jest.fn((_type: string, ctor: typeof Constructor) => { Constructor = ctor }),
      getNode: jest.fn(() => frbcConfigNode)
    }
  }
  registerNode(RED as never)
  Constructor!.call(node, { id: 'frbc-node-id', frbcConfig: 'cfg' } as never)
  return { node, handlers, nodeContext }
}

describe('s2-frbc', () => {
  it('refuses to start without a config node', () => {
    const { node, handlers } = setupNode(null)
    expect(node.error).toHaveBeenCalledWith(expect.stringContaining('s2-frbc-config node is missing'))
    expect(node.status).toHaveBeenCalledWith({ fill: 'red', shape: 'dot', text: 'config missing' })
    expect(handlers.input).toBeUndefined()
  })

  it('refuses to start with an invalid configuration, naming the problem', () => {
    const { node, handlers } = setupNode({ ...exampleConfigNode(), leakageBehaviour: '' })
    expect(node.error).toHaveBeenCalledWith('Invalid FRBC configuration: storage.provides_leakage_behaviour is true, but no leakage behaviour is configured')
    expect(node.status).toHaveBeenCalledWith({ fill: 'red', shape: 'dot', text: 'invalid config' })
    expect(handlers.input).toBeUndefined()
  })

  it('sends commands on output 2 and events on output 1', () => {
    const { node, handlers } = setupNode()
    const done = jest.fn()
    handlers.input({ topic: 'StorageStatus', payload: { fillLevel: 30 } }, jest.fn(), done)
    handlers.input({ cemId: 'cem-1', payload: { message_type: 'SelectControlType', message_id: 'x', control_type: 'FILL_RATE_BASED_CONTROL' } }, jest.fn(), done)
    expect(done).toHaveBeenCalledTimes(2)
    const calls = (node.send as jest.Mock).mock.calls.map(c => c[0])
    expect(calls[0][0]).toBeNull()
    expect(calls[0][1].payload).toMatchObject({ command: 'SystemDescription', cemId: 'cem-1' })
    expect(calls[1][1].payload).toMatchObject({ command: 'UpdateStatus', frbc: { storageStatus: { presentFillLevel: 30 } } })
    expect(calls[2]).toEqual([{ topic: 'Selected', payload: { controlType: 'FILL_RATE_BASED_CONTROL' }, cemId: 'cem-1' }, null])
  })

  it('asks s2-rm to replay the FRBC selection once it has started, and not after being closed first', () => {
    jest.useFakeTimers()
    try {
      const { node } = setupNode()
      expect(node.send).not.toHaveBeenCalled()
      jest.runAllTimers()
      expect(node.send).toHaveBeenCalledWith([null, { payload: { command: 'ReplaySelection', controlType: 'FILL_RATE_BASED_CONTROL' } }])

      const second = setupNode()
      const closed = jest.fn()
      second.handlers.close(closed)
      jest.runAllTimers()
      expect(closed).toHaveBeenCalled()
      expect(second.node.send).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })
})
