import { NodeRedApp, NodeConfig } from '../../types/node-red'
import { S2CemConfigNode } from '../../types/config-nodes'

export = function (RED: NodeRedApp): void {
  function S2CemConfigNodeConstructor (this: S2CemConfigNode, config: NodeConfig): void {
    RED.nodes.createNode(this, config)
    this.url = config.url as string
    // credentials are populated automatically by Node-RED
  }

  RED.nodes.registerType('s2-cem-config', S2CemConfigNodeConstructor, {
    credentials: {
      username: { type: 'text' },
      password: { type: 'password' }
    }
  })
}
