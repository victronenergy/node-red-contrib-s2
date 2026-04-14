import { NodeRedNode } from './node-red'

/**
 * Server-side shape of the s2-rm-config config node.
 * Use RED.nodes.getNode(id) and cast to this type.
 */
export interface S2RmConfigNode extends NodeRedNode {
  resourceId: string
  rmName: string
  manufacturer: string
  model: string
  firmwareVersion: string
  controlTypes: string // comma-separated list of control type values
}

/**
 * Server-side shape of the s2-cem-config config node.
 * Use RED.nodes.getNode(id) and cast to this type.
 */
export interface S2CemConfigNode extends NodeRedNode {
  url: string
  credentials: {
    username: string
    password: string
  }
}
