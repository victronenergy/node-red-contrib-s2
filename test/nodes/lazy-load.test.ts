/**
 * Node-RED loads every installed node module at startup, also on systems whose flows contain no
 * S2 nodes at all. Registering the S2 nodes must therefore not load the heavy dependencies: ws,
 * the D-Bus libraries and the generated schema validators are only loaded once a node actually
 * connects or validates a message.
 */

const NODE_TYPES = [
  's2-cem-config',
  's2-dbus',
  's2-dbus-config',
  's2-ombc',
  's2-ombc-config',
  's2-pebc',
  's2-pebc-config',
  's2-resource',
  's2-rm',
  's2-rm-config',
  's2-websocket'
]

const HEAVY_MODULES = [
  'ws',
  'dbus-native-victron',
  'dbus-victron-virtual',
  '../../src/lib/s2/schema-validators.generated'
]

function stubRED () {
  return {
    nodes: { createNode: jest.fn(), registerType: jest.fn(), getNode: jest.fn() },
    httpAdmin: { get: jest.fn(), post: jest.fn() },
    auth: { needsPermission: jest.fn(() => jest.fn()) },
    events: { on: jest.fn(), removeListener: jest.fn() },
    comms: { publish: jest.fn() },
    settings: {},
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  }
}

describe('lazy loading of heavy dependencies', () => {
  it('registering all S2 nodes does not load ws, D-Bus or the schema validators', () => {
    const loaded: string[] = []

    jest.isolateModules(() => {
      for (const name of HEAVY_MODULES) {
        jest.doMock(name, () => {
          loaded.push(name)
          return {}
        })
      }

      for (const type of NODE_TYPES) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const registerNode = require(`../../src/nodes/${type}/index`)
        registerNode(stubRED())
      }
    })

    expect(loaded).toEqual([])
  })

  it('the detector does see a load', () => {
    const loaded: string[] = []

    jest.isolateModules(() => {
      jest.doMock('../../src/lib/s2/schema-validators.generated', () => {
        loaded.push('validators')
        return { messageTypeToExport: {} }
      })
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { validateS2Message } = require('../../src/lib/s2/schema-validation')
      validateS2Message({ message_type: 'Handshake' })
    })

    expect(loaded).toEqual(['validators'])
  })
})
