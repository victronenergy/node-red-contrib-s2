import { NodeRedApp, NodeConfig, NodeRedNode } from '../../types/node-red'

// NOTE: s2-websocket is not yet implemented.
// It will use S2Session + S2WebSocketTransport once the acload D-Bus
// testing phase is complete.

export = function (RED: NodeRedApp): void {
  function S2WebSocketNode (this: NodeRedNode, config: NodeConfig): void {
    RED.nodes.createNode(this, config)
    const node = this
    node.status({ fill: 'grey', shape: 'ring', text: 'not implemented' })
  }

  RED.nodes.registerType('s2-websocket', S2WebSocketNode)
}
