import { readFileSync } from 'fs'
import { join } from 'path'
import { runInNewContext } from 'vm'
import registerNode from '../../src/nodes/s2-frbc-config/index'

type ValidateHandler = (req: { body?: unknown }, res: { json: jest.Mock }) => void

function setupNode () {
  const node: Record<string, unknown> = { id: 'node-test-id' }
  let validateHandler: ValidateHandler | null = null
  let Constructor: ((this: Record<string, unknown>, config: Record<string, unknown>) => void) | null = null

  const RED = {
    nodes: {
      createNode: jest.fn((n: Record<string, unknown>) => { Object.assign(n, node) }),
      registerType: jest.fn((_type: string, ctor: typeof Constructor) => { Constructor = ctor })
    },
    httpAdmin: { post: jest.fn((_path: string, _permission: unknown, handler: ValidateHandler) => { validateHandler = handler }) },
    auth: { needsPermission: jest.fn(() => 'permission-middleware') }
  }

  registerNode(RED as never)
  Constructor!.call(node, { id: 'node-test-id', systemDescription: '{"a":1}', leakageBehaviour: '' } as never)
  return { node, RED, validateHandler: validateHandler! }
}

function callValidate (handler: ValidateHandler, body: unknown) {
  const res = { json: jest.fn() }
  handler({ body }, res)
  return res.json.mock.calls[0][0] as { valid: boolean, errors: string[] }
}

// The example a new s2-frbc-config starts with, from the shipped editor script.
function loadEditorExample (): { systemDescription: string, leakageBehaviour: string } {
  const window: Record<string, unknown> = {}
  runInNewContext(readFileSync(join(__dirname, '../../resources/s2-frbc-editor.js'), 'utf8'), { window })
  const editor = window.__s2FrbcEditor as { exampleSystemDescription: () => string, exampleLeakageBehaviour: () => string }
  return { systemDescription: editor.exampleSystemDescription(), leakageBehaviour: editor.exampleLeakageBehaviour() }
}

describe('s2-frbc-config', () => {
  it('stores both JSON fields on the config node', () => {
    const { node } = setupNode()
    expect(node.systemDescription).toBe('{"a":1}')
    expect(node.leakageBehaviour).toBe('')
  })

  it('registers /s2/validate-frbc-config behind its write permission', () => {
    const { RED } = setupNode()
    expect(RED.auth.needsPermission).toHaveBeenCalledWith('s2-frbc-config.write')
    expect(RED.httpAdmin.post).toHaveBeenCalledWith('/s2/validate-frbc-config', 'permission-middleware', expect.any(Function))
  })

  it('accepts the example a new node starts with', () => {
    const { validateHandler } = setupNode()
    expect(callValidate(validateHandler, loadEditorExample())).toEqual({ valid: true, errors: [] })
  })

  it('reports invalid JSON naming the field', () => {
    const { validateHandler } = setupNode()
    const result = callValidate(validateHandler, { systemDescription: '{', leakageBehaviour: '' })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(/^System description: invalid JSON/)
  })

  it('reports cross-reference problems of an otherwise schema-valid configuration', () => {
    const { validateHandler } = setupNode()
    const example = loadEditorExample()
    const result = callValidate(validateHandler, { systemDescription: example.systemDescription, leakageBehaviour: '' })
    expect(result).toEqual({ valid: false, errors: ['storage.provides_leakage_behaviour is true, but no leakage behaviour is configured'] })
  })

  it('reports schema errors in the leakage behaviour', () => {
    const { validateHandler } = setupNode()
    const example = loadEditorExample()
    const result = callValidate(validateHandler, { systemDescription: example.systemDescription, leakageBehaviour: '{"elements":[{"leakage_rate":1}]}' })
    expect(result.valid).toBe(false)
    expect(result.errors.every(e => e.startsWith('Leakage behaviour: '))).toBe(true)
  })
})
