import { NodeRedApp, NodeConfig } from '../../types/node-red'
import { S2PebcConfigNode } from '../../types/config-nodes'

export = function (RED: NodeRedApp): void {
  function S2PebcConfigNodeConstructor (this: S2PebcConfigNode, config: NodeConfig): void {
    RED.nodes.createNode(this, config)
    this.gridConnection = config.gridConnection as string
    this.customMaxPowerW = config.customMaxPowerW != null ? Number(config.customMaxPowerW) : undefined
  }

  RED.nodes.registerType('s2-pebc-config', S2PebcConfigNodeConstructor)
}
