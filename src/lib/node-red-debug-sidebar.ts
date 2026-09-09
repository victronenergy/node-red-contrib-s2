import { NodeRedApp, NodeRedNode } from '../types/node-red'

/**
 * Publishes a message straight into the Node-RED editor's Debug sidebar - the same channel
 * (RED.comms.publish('debug', ...)) the core Debug node's own sidebar view uses - so raw S2
 * protocol traffic shows up somewhere every Node-RED user already knows to look, without
 * requiring a separate Debug node wired into the flow. Regular node.log() output only reaches
 * the runtime console/log file, which most users deploying to a GX device never open.
 *
 * `msg` is sent as-is (not JSON-stringified) so the sidebar's tree view can expand it, matching
 * how a Debug node set to "complete msg object" renders a parsed payload.
 */
export function publishToDebugSidebar (RED: NodeRedApp, node: NodeRedNode, topic: string, msg: unknown): void {
  RED.comms.publish('debug', {
    id: node.id,
    z: node.z,
    // Only set when nested inside a subflow - matches the core Debug node's own field exactly,
    // so the sidebar's breadcrumb and click-to-reveal work the same way for a subflow instance.
    path: node._flow?.path,
    name: node.name,
    topic,
    msg
  }, false)
}

/** Best-effort JSON.parse for nicer sidebar rendering - falls back to the raw string if it isn't
 * valid JSON (defensive; every caller here only ever passes already-serialized S2 messages). */
export function parseForDebugSidebar (raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
