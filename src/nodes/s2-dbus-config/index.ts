import { NodeRedApp, NodeConfig } from '../../types/node-red'
import { S2DbusConfigNode } from '../../types/config-nodes'

export = function (RED: NodeRedApp): void {
  function S2DbusConfigNodeConstructor (this: S2DbusConfigNode, config: NodeConfig): void {
    RED.nodes.createNode(this, config)
    this.connectionMode = (config.connectionMode as 'auto' | 'system' | 'tcp') || 'auto'
    this.tcpAddress = config.tcpAddress as string | undefined
    this.deviceType = (config.deviceType as string) || 'acload'
    this.nrOfPhases = Number(config.nrOfPhases ?? 1)
    this.position = (Number(config.position ?? 0) as 0 | 1)
    this.phaseSetting = Number(config.phaseSetting ?? 1)
    const configuredMeasurementType = (config.measurementType as S2DbusConfigNode['measurementType']) ?? 'L1_L2_L3'
    this.measurementType = configuredMeasurementType === '3_PHASE_SYMMETRIC' && this.nrOfPhases !== 3
      ? 'L1_L2_L3'
      : configuredMeasurementType
    this.autoCalculateEnergy = config.autoCalculateEnergy !== false
  }

  RED.nodes.registerType('s2-dbus-config', S2DbusConfigNodeConstructor)
}
