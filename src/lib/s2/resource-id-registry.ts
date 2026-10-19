export type ResourceIdClaim = { claimed: true } | { claimed: false, holder: string }

/** An RM speaks for the resource; a transport carries its ID to a CEM (e.g. in the WebSocket
 * URL). One of each per resource ID: an s2-rm and its s2-websocket legitimately share an ID. */
export type ResourceIdClaimKind = 'rm' | 'transport'

// Module-level rather than per-RED: Node-RED hands every node file its own RED object, so this
// is the only state s2-rm and s2-resource share. Safe across redeploys because Node-RED closes
// all stopped nodes before starting their replacements.
const holders = new Map<string, string>()

/**
 * Claim a resource ID for one running node. A CEM identifies a Resource Manager by its
 * resource_id, so two RMs with the same ID would look like one resource to it.
 */
export function claimResourceId (resourceId: string, ownerNodeId: string, kind: ResourceIdClaimKind = 'rm'): ResourceIdClaim {
  const key = `${kind}:${resourceId}`
  const holder = holders.get(key)
  if (holder !== undefined && holder !== ownerNodeId) {
    return { claimed: false, holder }
  }
  holders.set(key, ownerNodeId)
  return { claimed: true }
}

export function releaseResourceId (resourceId: string, ownerNodeId: string, kind: ResourceIdClaimKind = 'rm'): void {
  const key = `${kind}:${resourceId}`
  if (holders.get(key) === ownerNodeId) {
    holders.delete(key)
  }
}

/**
 * Node-RED substitutes a property whose whole value is ${NAME} from the node's environment
 * (subflow instance, flow, global) before the node starts, but leaves it as-is when NAME is not
 * set - which the S2 ID schema's unanchored pattern would then accept as a resource ID.
 * Returns NAME for such a leftover reference, null otherwise.
 */
export function unresolvedEnvVar (resourceId: string): string | null {
  const m = /^\$\{(\S+)\}$/.exec(resourceId)
  return m ? m[1] : null
}
