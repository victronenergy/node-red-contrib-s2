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
  /** Commodity quantity list for power measurement, or '' for none. */
  providesPowerMeasurement: string
  /** Whether this RM provides power forecasts to the CEM. */
  providesForecast: boolean
  /** How often (ms) to poll for due pending instructions. Defaults to 2000 if not set. */
  instructionPollIntervalMs: number
  /** When true, skip sending the automatic InstructionStatusUpdate(STARTED) when a pending
   * instruction's execution_time arrives. ReceptionStatus and InstructionStatusUpdate(ACCEPTED)
   * are always sent - the S2 spec requires them for every instruction regardless of this
   * setting. Use when the CEM does not need STARTED updates and the extra traffic causes
   * CPU load. */
  skipInstructionStatus: boolean
}

/**
 * Server-side shape of the s2-ombc-config config node.
 * Use RED.nodes.getNode(id) and cast to this type.
 */
export interface S2OmbcConfigNode extends NodeRedNode {
  /** JSON-encoded OMBCSystemDescriptionConfig: { operationModes, transitions, timers } */
  systemDescription: string
}

/**
 * Server-side shape of the s2-pebc-config config node.
 * Use RED.nodes.getNode(id) and cast to this type.
 */
export interface S2PebcConfigNode extends NodeRedNode {
  gridConnection: string // e.g. '3x25A' or 'custom'
  customMaxPowerW: number | undefined // only used when gridConnection === 'custom'
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

/**
 * Server-side shape of the s2-dbus-config config node.
 * Use RED.nodes.getNode(id) and cast to this type.
 */
export interface S2DbusConfigNode extends NodeRedNode {
  connectionMode: 'auto' | 'system' | 'tcp'
  tcpAddress: string | undefined
  deviceType: string // a product type dbus-victron-virtual recognizes, e.g. 'acload' or 'heatpump'
  measurementType: '' | '3_PHASE_SYMMETRIC' | 'L1_L2_L3'
  /** 1-3. Declares the full minimal-meter D-Bus shape for this many phases. */
  nrOfPhases: number
  /** AC output (0) or AC input (1), matching node-red-contrib-victron's own Position property. */
  position: 0 | 1
  /** Which physical line (1-3) a single-phase device (nrOfPhases 1) is wired to. Ignored when nrOfPhases > 1. */
  phaseSetting: number
  /** Integrates each tracked Power property over time into a running Energy Forward total. */
  autoCalculateEnergy: boolean
}
