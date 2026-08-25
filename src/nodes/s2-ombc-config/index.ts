import { NodeRedApp, NodeConfig } from '../../types/node-red'
import { S2OmbcConfigNode } from '../../types/config-nodes'

export = function (RED: NodeRedApp): void {
  function S2OmbcConfigNodeConstructor (this: S2OmbcConfigNode, config: NodeConfig): void {
    RED.nodes.createNode(this, config)
    this.systemDescription = config.systemDescription as string
  }

  RED.nodes.registerType('s2-ombc-config', S2OmbcConfigNodeConstructor)
}
