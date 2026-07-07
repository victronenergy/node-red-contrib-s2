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
  /** How often (ms) to poll for due pending instructions. Defaults to 2000 if not set. */
  instructionPollIntervalMs: number
  /** When true, skip sending InstructionStatusUpdate(ACCEPTED/STARTED) automatically.
   * ReceptionStatus and OMBC.Status are still sent. Use when the CEM does not require
   * acknowledgment messages and the extra D-Bus traffic causes CPU load. */
  skipInstructionStatus: boolean
}

/**
 * Server-side shape of the s2-cem-config config node.
 * Use RED.nodes.getNode(id) and cast to this type.
 */
export interface S2CemConfigNode extends NodeRedNode {
  url: string
  apiPrefix: string | undefined // optional path prefix for the CEM REST API, e.g. '/s2-message-handler'
  credentials: {
    username: string
    password: string
  }
}
