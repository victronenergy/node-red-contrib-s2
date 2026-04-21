import { NodeRedNode } from './node-red'

/**
 * Server-side shape of the s2-rm-config config node.
 * Use RED.nodes.getNode(id) and cast to this type.
 */
export interface S2RmConfigNode extends NodeRedNode {
  resourceId: string
  rmName: string
  roles: string // comma-separated list of role values (e.g. 'ENERGY_CONSUMER,ENERGY_PRODUCER')
  serialNumber: string
  manufacturer: string
  model: string
  firmwareVersion: string
  controlTypes: string // comma-separated list of control type values
  /** Hardware ceiling for battery charge power in Watts. 0 = no limit configured. */
  maxBatteryChargePower: number
  /** Hardware ceiling for battery discharge power in Watts. 0 = no limit configured. */
  maxBatteryDischargePower: number
  gridConnection: string // e.g. '3x25A' or 'custom'
  customMaxPowerW: number | undefined // only used when gridConnection === 'custom'
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
