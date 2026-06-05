import { NodeRedApp, NodeConfig } from '../../types/node-red'
import { S2RmConfigNode } from '../../types/config-nodes'

export = function (RED: NodeRedApp): void {
  function S2RmConfigNodeConstructor (this: S2RmConfigNode, config: NodeConfig): void {
    RED.nodes.createNode(this, config)
    this.resourceId = config.resourceId as string
    this.rmName = config.rmName as string
    this.roles = config.roles as string
    this.serialNumber = config.serialNumber as string
    this.manufacturer = config.manufacturer as string
    this.model = config.model as string
    this.firmwareVersion = config.firmwareVersion as string
    this.controlTypes = config.controlTypes as string
    this.gridConnection = config.gridConnection as string
    this.customMaxPowerW = config.customMaxPowerW != null ? Number(config.customMaxPowerW) : undefined
    this.instructionPollIntervalMs = config.instructionPollIntervalMs != null ? Number(config.instructionPollIntervalMs) : 2000
  }

  RED.nodes.registerType('s2-rm-config', S2RmConfigNodeConstructor)
}
