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

export function releaseAllResourceIds (ownerNodeId: string): void {
  for (const [key, holder] of holders) {
    if (holder === ownerNodeId) holders.delete(key)
  }
}

/**
 * Node-RED substitutes a property whose whole value is ${NAME} (or the older $(NAME)) from the
 * node's environment (subflow instance, flow, global) before the node starts, but leaves it as-is
 * when NAME is not set - which the S2 ID schema's unanchored pattern would then accept as a
 * resource ID. Returns NAME for such a leftover reference, null otherwise.
 */
export function unresolvedEnvVar (resourceId: string): string | null {
  const m = /^\$\{(\S+)\}$/.exec(resourceId) || /^\$\((\S+)\)$/.exec(resourceId)
  return m ? m[1] : null
}

export interface ResourceIdProblem {
  /** Red status text for the refusing node. */
  status: string
  /** Error message, without the node type prefix. */
  message: string
}

/**
 * Checks a resource ID as it arrives in a node's constructor, after Node-RED's environment
 * variable substitution. Empty can mean a blank variable as well as a node never opened in the
 * editor; a random ID per start would make the CEM see a new resource on every deploy, so it is
 * refused rather than generated. Returns null when the ID is usable.
 */
export function resourceIdProblem (value: unknown): ResourceIdProblem | null {
  const resourceId = value === undefined || value === null ? '' : String(value)
  if (resourceId === '') {
    return {
      status: 'resource ID missing',
      message: 'resource ID is empty. Open the node with the Resource ID and press Done to have one generated (in a subflow, give the variable used as resource ID a value), then deploy this node again.'
    }
  }
  const envVar = unresolvedEnvVar(resourceId)
  if (envVar) {
    return {
      status: 'resource ID variable not set',
      message: `resource ID is ${resourceId}, but environment variable ${envVar} is not set. Set it in the subflow instance's properties (or the flow or global environment), then deploy this node again.`
    }
  }
  // The S2 ID schema's pattern, anchored - the schema's own is unanchored.
  if (!/^[a-zA-Z0-9\-_:]{2,64}$/.test(resourceId)) {
    return {
      status: 'invalid resource ID',
      message: `resource ID "${resourceId}" must be 2-64 characters: letters, digits, "-", "_" or ":". Fix it (or the variable it comes from), then deploy this node again.`
    }
  }
  return null
}
