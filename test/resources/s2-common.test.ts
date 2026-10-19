import { readFileSync } from 'fs'
import { join } from 'path'
import { runInNewContext } from 'vm'

interface EditorNode { id: string, type: string, resourceId?: string }

interface S2Common {
  generateUuid: () => string
  resourceIdNeedsReplacing: (RED: unknown, node: EditorNode) => boolean
  watchResourceIds: (RED: unknown) => void
  isUuid: (value: string) => boolean
  isEnvRef: (value: string) => boolean
  validateResourceId: (RED: unknown, node: EditorNode, value: string) => true | string
}

// Runs the shipped editor script as the browser would, against a bare window.
function loadS2Common (window: Record<string, unknown> = {}): S2Common {
  runInNewContext(readFileSync(join(__dirname, '../../resources/s2-common.js'), 'utf8'), { window })
  return window.__s2Common as S2Common
}

function fakeRED (nodes: EditorNode[], configs: EditorNode[] = []) {
  const each = (list: EditorNode[]) => (cb: (n: EditorNode) => unknown) => {
    for (const n of list) {
      if (cb(n) === false) return
    }
  }
  return { nodes: { eachNode: each(nodes), eachConfig: each(configs) } }
}

describe('s2-common - generateUuid', () => {
  it('returns distinct v4 UUIDs', () => {
    const { generateUuid } = loadS2Common()
    const a = generateUuid()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(generateUuid()).not.toBe(a)
  })
})

describe('s2-common - resourceIdNeedsReplacing', () => {
  const { resourceIdNeedsReplacing } = loadS2Common()

  it('is true for an empty resource ID', () => {
    const node = { id: 'n1', type: 's2-resource', resourceId: '' }
    expect(resourceIdNeedsReplacing(fakeRED([node]), node)).toBe(true)
  })

  it('is false when only the node itself holds the resource ID', () => {
    const node = { id: 'n1', type: 's2-resource', resourceId: 'rid-1' }
    expect(resourceIdNeedsReplacing(fakeRED([node]), node)).toBe(false)
  })

  it('is true when another s2-resource holds the resource ID', () => {
    const original = { id: 'n1', type: 's2-resource', resourceId: 'rid-1' }
    const pasted = { id: 'n2', type: 's2-resource', resourceId: 'rid-1' }
    expect(resourceIdNeedsReplacing(fakeRED([original, pasted]), pasted)).toBe(true)
  })

  it('is true when an s2-rm-config holds the resource ID', () => {
    const node = { id: 'n1', type: 's2-resource', resourceId: 'rid-1' }
    const config = { id: 'c1', type: 's2-rm-config', resourceId: 'rid-1' }
    expect(resourceIdNeedsReplacing(fakeRED([node], [config]), node)).toBe(true)
  })

  it('ignores other node types that happen to have a resourceId property', () => {
    const node = { id: 'n1', type: 's2-resource', resourceId: 'rid-1' }
    const other = { id: 'x1', type: 'some-other-node', resourceId: 'rid-1' }
    expect(resourceIdNeedsReplacing(fakeRED([node, other], [other]), node)).toBe(false)
  })
})

// Mimics the editor pieces watchResourceIds relies on: the event bus and the node lists.
function fakeEditor () {
  const nodes: EditorNode[] = []
  const configs: EditorNode[] = []
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
  const RED = {
    ...fakeRED(nodes, configs),
    events: {
      on: (event: string, cb: (...args: unknown[]) => void) => { (listeners[event] ||= []).push(cb) },
      emit: (event: string, ...args: unknown[]) => { (listeners[event] || []).forEach(cb => cb(...args)) }
    }
  }
  // Same order as the editor's RED.nodes.add: store the node, then emit nodes:add. User additions
  // (palette, paste, imports) arrive marked changed; loads and reloads of the deployed flows don't.
  const add = (node: EditorNode & { changed?: boolean }, isConfig = false) => {
    (isConfig ? configs : nodes).push(node)
    RED.events.emit('nodes:add', node)
    return node
  }
  return { RED, add, listeners }
}

describe('s2-common - watchResourceIds', () => {
  it('replaces a duplicate resource ID of an s2-resource the user adds', () => {
    const { watchResourceIds } = loadS2Common()
    const { RED, add } = fakeEditor()
    watchResourceIds(RED)

    add({ id: 'n1', type: 's2-resource', resourceId: 'rid-1' })
    const copy = add({ id: 'n2', type: 's2-resource', resourceId: 'rid-1', changed: true })

    expect(copy.resourceId).not.toBe('rid-1')
    expect(copy.resourceId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('replaces a duplicate resource ID of an s2-rm-config the user adds', () => {
    const { watchResourceIds } = loadS2Common()
    const { RED, add } = fakeEditor()
    watchResourceIds(RED)

    add({ id: 'c1', type: 's2-rm-config', resourceId: 'rid-1' }, true)
    const copy = add({ id: 'c2', type: 's2-rm-config', resourceId: 'rid-1', changed: true }, true)

    expect(copy.resourceId).not.toBe('rid-1')
  })

  it('fills in an empty resource ID of a node the user adds', () => {
    const { watchResourceIds } = loadS2Common()
    const { RED, add } = fakeEditor()
    watchResourceIds(RED)

    const dropped = add({ id: 'n1', type: 's2-resource', resourceId: '', changed: true })

    expect(dropped.resourceId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('keeps a unique resource ID, e.g. after a cut-and-paste', () => {
    const { watchResourceIds } = loadS2Common()
    const { RED, add } = fakeEditor()
    watchResourceIds(RED)

    const moved = add({ id: 'n1', type: 's2-resource', resourceId: 'rid-1', changed: true })

    expect(moved.resourceId).toBe('rid-1')
  })

  it('keeps an environment variable reference when the node is copied', () => {
    const { watchResourceIds } = loadS2Common()
    const { RED, add } = fakeEditor()
    watchResourceIds(RED)

    add({ id: 'n1', type: 's2-resource', resourceId: '${S2_RESOURCE_ID}' })
    const copy = add({ id: 'n2', type: 's2-resource', resourceId: '${S2_RESOURCE_ID}', changed: true })

    expect(copy.resourceId).toBe('${S2_RESOURCE_ID}')
  })

  it('leaves nodes from loading or reloading the deployed flows alone, even duplicates', () => {
    const { watchResourceIds } = loadS2Common()
    const { RED, add } = fakeEditor()
    watchResourceIds(RED)

    add({ id: 'n1', type: 's2-resource', resourceId: 'rid-1' })
    const deployedDuplicate = add({ id: 'n2', type: 's2-resource', resourceId: 'rid-1' })

    expect(deployedDuplicate.resourceId).toBe('rid-1')
  })

  it('registers its listener only once when both editor scripts load s2-common', () => {
    const window: Record<string, unknown> = {}
    const { RED, listeners } = fakeEditor()
    loadS2Common(window).watchResourceIds(RED)
    loadS2Common(window).watchResourceIds(RED)

    expect(listeners['nodes:add']).toHaveLength(1)
  })
})

describe('s2-common - isEnvRef', () => {
  const { isEnvRef } = loadS2Common()

  it('recognises a whole-value ${NAME} reference, as Node-RED substitutes it', () => {
    expect(isEnvRef('${S2_RESOURCE_ID}')).toBe(true)
  })

  it('rejects anything Node-RED would not substitute', () => {
    expect(isEnvRef('prefix-${S2_RESOURCE_ID}')).toBe(false)
    expect(isEnvRef('${}')).toBe(false)
    expect(isEnvRef('${A B}')).toBe(false)
    expect(isEnvRef('my-heatpump-01')).toBe(false)
  })
})

describe('s2-common - isUuid', () => {
  const { isUuid } = loadS2Common()

  it('accepts a UUID of any version, in either case', () => {
    expect(isUuid('3e9f140d-e08f-4ece-87fc-8929b5811858')).toBe(true)
    expect(isUuid('3E9F140D-E08F-1ECE-87FC-8929B5811858')).toBe(true)
  })

  it('rejects anything that is not a UUID', () => {
    expect(isUuid('my-heatpump-01')).toBe(false)
    expect(isUuid('3e9f140d-e08f-4ece-87fc-8929b581185')).toBe(false)
    expect(isUuid('')).toBe(false)
  })
})

describe('s2-common - validateResourceId', () => {
  const { validateResourceId } = loadS2Common()
  const self = { id: 'n1', type: 's2-resource' }

  it('accepts an empty value (filled in on save) and a UUID', () => {
    expect(validateResourceId(fakeRED([self]), self, '')).toBe(true)
    expect(validateResourceId(fakeRED([self]), self, '3e9f140d-e08f-4ece-87fc-8929b5811858')).toBe(true)
  })

  it('accepts a non-UUID within the S2 ID format', () => {
    expect(validateResourceId(fakeRED([self]), self, 'my-heatpump_01:a')).toBe(true)
  })

  it('rejects characters outside the S2 ID format', () => {
    expect(validateResourceId(fakeRED([self]), self, 'my heatpump')).toEqual(expect.any(String))
  })

  it('rejects IDs shorter than 2 or longer than 64 characters', () => {
    expect(validateResourceId(fakeRED([self]), self, 'a')).toEqual(expect.any(String))
    expect(validateResourceId(fakeRED([self]), self, 'a'.repeat(65))).toEqual(expect.any(String))
    expect(validateResourceId(fakeRED([self]), self, 'a'.repeat(64))).toBe(true)
  })

  it('rejects an ID another s2-resource or s2-rm-config already uses', () => {
    const other = { id: 'n2', type: 's2-resource', resourceId: 'taken-id' }
    const config = { id: 'c1', type: 's2-rm-config', resourceId: 'config-id' }
    const RED = fakeRED([self, other], [config])
    expect(validateResourceId(RED, self, 'taken-id')).toEqual(expect.stringContaining('already'))
    expect(validateResourceId(RED, self, 'config-id')).toEqual(expect.stringContaining('already'))
  })

  it('accepts the ID the node itself already holds', () => {
    const node = { id: 'n1', type: 's2-resource', resourceId: 'my-id' }
    expect(validateResourceId(fakeRED([node]), node, 'my-id')).toBe(true)
  })
})

describe('s2-common - environment variable references', () => {
  const { resourceIdNeedsReplacing, validateResourceId } = loadS2Common()
  const self = { id: 'n1', type: 's2-resource' }

  it('never asks to replace an environment variable reference, even a shared one', () => {
    const node = { id: 'n2', type: 's2-resource', resourceId: '${S2_RESOURCE_ID}' }
    const other = { id: 'n1', type: 's2-resource', resourceId: '${S2_RESOURCE_ID}' }
    expect(resourceIdNeedsReplacing(fakeRED([other, node]), node)).toBe(false)
  })

  it('accepts an environment variable reference, even when another node uses the same one', () => {
    const other = { id: 'n2', type: 's2-resource', resourceId: '${S2_RESOURCE_ID}' }
    expect(validateResourceId(fakeRED([self, other]), self, '${S2_RESOURCE_ID}')).toBe(true)
  })

  it('rejects a malformed reference', () => {
    expect(validateResourceId(fakeRED([self]), self, '${}')).toEqual(expect.any(String))
    expect(validateResourceId(fakeRED([self]), self, '${A B}')).toEqual(expect.any(String))
  })
})
