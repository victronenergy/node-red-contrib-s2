import registerNode from '../../src/nodes/s2-ombc-config/index'

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

function callValidate (validateHandler: (req: { body?: unknown }, res: { json: jest.Mock }) => void, systemDescription: unknown) {
  const res = { json: jest.fn() }
  validateHandler({ body: { systemDescription } }, res)
  return res.json.mock.calls[0][0] as { valid: boolean, errors?: string[] }
}

describe('s2-ombc-config: /s2/validate-system-description', () => {
  it('registers the endpoint behind RED.auth.needsPermission', () => {
    const RED = {
      nodes: { createNode: jest.fn(), registerType: jest.fn() },
      httpAdmin: { post: jest.fn() },
      auth: { needsPermission: jest.fn(() => 'permission-middleware') }
    }
    registerNode(RED as never)
    expect(RED.auth.needsPermission).toHaveBeenCalledWith('s2-ombc-config.write')
    expect(RED.httpAdmin.post).toHaveBeenCalledWith('/s2/validate-system-description', 'permission-middleware', expect.any(Function))
  })

  it('accepts a valid OMBC.SystemDescription', () => {
    const { validateHandler } = setupNode()
    const systemDescription = JSON.stringify({
      operationModes: [{
        id: 'mode-1',
        power_ranges: [{ start_of_range: 0, end_of_range: 1000, commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC' }],
        abnormal_condition_only: false
      }],
      transitions: [],
      timers: []
    })
    const result = callValidate(validateHandler, systemDescription)
    expect(result.valid).toBe(true)
  })

  it('rejects malformed JSON with a specific error', () => {
    const { validateHandler } = setupNode()
    const result = callValidate(validateHandler, '{ "operationModes": [ ')
    expect(result.valid).toBe(false)
    expect(result.errors?.[0]).toMatch(/Invalid JSON/)
  })

  it('rejects JSON that violates the OMBC.SystemDescription schema', () => {
    const { validateHandler } = setupNode()
    // power_ranges is required and must have at least one entry.
    const systemDescription = JSON.stringify({
      operationModes: [{ id: 'mode-1', power_ranges: [], abnormal_condition_only: false }],
      transitions: [],
      timers: []
    })
    const result = callValidate(validateHandler, systemDescription)
    expect(result.valid).toBe(false)
    expect(result.errors?.length).toBeGreaterThan(0)
  })

  it('rejects a non-object payload', () => {
    const { validateHandler } = setupNode()
    const result = callValidate(validateHandler, '42')
    expect(result.valid).toBe(false)
    expect(result.errors?.[0]).toMatch(/must be a JSON object/)
  })

  it('reports schema errors against the editor field name (operationModes), not the wire name (operation_modes)', () => {
    const { validateHandler } = setupNode()
    // power_ranges must have at least 1 item.
    const systemDescription = JSON.stringify({
      operationModes: [{ id: 'mode-1', power_ranges: [], abnormal_condition_only: false }],
      transitions: [],
      timers: []
    })
    const result = callValidate(validateHandler, systemDescription)
    expect(result.valid).toBe(false)
    expect(result.errors?.some((e) => e.includes('/operationModes'))).toBe(true)
    expect(result.errors?.some((e) => e.includes('/operation_modes'))).toBe(false)
  })
})
