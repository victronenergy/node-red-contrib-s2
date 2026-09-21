import registerNode from '../../src/nodes/s2-pebc-config/index'

function setupNode () {
  const node: Record<string, unknown> = { id: 'node-test-id' }

  let validateHandler: ((req: { body?: unknown }, res: { json: jest.Mock }) => void) | null = null

  const RED = {
    nodes: {
      createNode: jest.fn((n: Record<string, unknown>) => { Object.assign(n, node) }),
      registerType: jest.fn()
    },
    httpAdmin: {
      post: jest.fn((_path: string, _permission: unknown, handler: typeof validateHandler) => {
        validateHandler = handler
      })
    },
    auth: {
      needsPermission: jest.fn(() => jest.fn())
    }
  }

  let Constructor: ((this: Record<string, unknown>, config: Record<string, unknown>) => void) | null = null
  RED.nodes.registerType.mockImplementation((_type: string, ctor: typeof Constructor) => {
    Constructor = ctor
  })

  registerNode(RED as never)
  Constructor!.call(node, { id: 'node-test-id' } as never)

  return { node, validateHandler: validateHandler! }
}

function callValidate (validateHandler: (req: { body?: unknown }, res: { json: jest.Mock }) => void, constraints: unknown) {
  const res = { json: jest.fn() }
  validateHandler({ body: { constraints } }, res)
  return res.json.mock.calls[0][0] as { valid: boolean, errors?: string[] }
}

describe('s2-pebc-config: constructor', () => {
  it('defaults constraints to an empty string when not set', () => {
    const RED = {
      nodes: { createNode: jest.fn((n: Record<string, unknown>) => { Object.assign(n, { id: 'x' }) }), registerType: jest.fn() },
      httpAdmin: { post: jest.fn() },
      auth: { needsPermission: jest.fn(() => jest.fn()) }
    }
    let Constructor: ((this: Record<string, unknown>, config: Record<string, unknown>) => void) | null = null
    RED.nodes.registerType.mockImplementation((_type: string, ctor: typeof Constructor) => { Constructor = ctor })
    registerNode(RED as never)
    const node: Record<string, unknown> = {}
    Constructor!.call(node, { gridConnection: '3x25A' } as never)
    expect(node.constraints).toBe('')
  })

  it('stores a configured constraints string', () => {
    const RED = {
      nodes: { createNode: jest.fn((n: Record<string, unknown>) => { Object.assign(n, { id: 'x' }) }), registerType: jest.fn() },
      httpAdmin: { post: jest.fn() },
      auth: { needsPermission: jest.fn(() => jest.fn()) }
    }
    let Constructor: ((this: Record<string, unknown>, config: Record<string, unknown>) => void) | null = null
    RED.nodes.registerType.mockImplementation((_type: string, ctor: typeof Constructor) => { Constructor = ctor })
    registerNode(RED as never)
    const node: Record<string, unknown> = {}
    const raw = JSON.stringify({ commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', minPower: -3000, maxPower: 6000 })
    Constructor!.call(node, { constraints: raw } as never)
    expect(node.constraints).toBe(raw)
  })
})

describe('s2-pebc-config: /s2/validate-pebc-constraints', () => {
  it('registers the endpoint behind RED.auth.needsPermission', () => {
    const RED = {
      nodes: { createNode: jest.fn(), registerType: jest.fn() },
      httpAdmin: { post: jest.fn() },
      auth: { needsPermission: jest.fn(() => 'permission-middleware') }
    }
    registerNode(RED as never)
    expect(RED.auth.needsPermission).toHaveBeenCalledWith('s2-pebc-config.write')
    expect(RED.httpAdmin.post).toHaveBeenCalledWith('/s2/validate-pebc-constraints', 'permission-middleware', expect.any(Function))
  })

  it('accepts a valid symmetric PEBC.PowerConstraints', () => {
    const { validateHandler } = setupNode()
    const constraints = JSON.stringify({ commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', minPower: -3000, maxPower: 3000 })
    const result = callValidate(validateHandler, constraints)
    expect(result.valid).toBe(true)
  })

  it('accepts a valid asymmetric range', () => {
    const { validateHandler } = setupNode()
    const constraints = JSON.stringify({ commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', minPower: -3000, maxPower: 6000 })
    const result = callValidate(validateHandler, constraints)
    expect(result.valid).toBe(true)
  })

  it('rejects malformed JSON with a specific error', () => {
    const { validateHandler } = setupNode()
    const result = callValidate(validateHandler, '{ "commodityQuantity": ')
    expect(result.valid).toBe(false)
    expect(result.errors?.[0]).toMatch(/Invalid JSON/)
  })

  it('rejects a non-object payload', () => {
    const { validateHandler } = setupNode()
    const result = callValidate(validateHandler, '42')
    expect(result.valid).toBe(false)
    expect(result.errors?.[0]).toMatch(/must be a JSON object/)
  })

  it('rejects an object missing required fields', () => {
    const { validateHandler } = setupNode()
    const result = callValidate(validateHandler, JSON.stringify({ commodityQuantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC' }))
    expect(result.valid).toBe(false)
    expect(result.errors?.[0]).toMatch(/commodityQuantity.*minPower.*maxPower/)
  })

  it('rejects a value that fails real S2 schema validation', () => {
    const { validateHandler } = setupNode()
    // Not a recognized commodity_quantity enum value.
    const constraints = JSON.stringify({ commodityQuantity: 'not.a.real.commodity', minPower: -3000, maxPower: 3000 })
    const result = callValidate(validateHandler, constraints)
    expect(result.valid).toBe(false)
    expect(result.errors?.length).toBeGreaterThan(0)
  })
})
