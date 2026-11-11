import { NodeRedApp, NodeConfig } from '../../types/node-red'
import { S2FrbcConfigNode } from '../../types/config-nodes'
import { FRBCConfig, parseFRBCConfig, validateFRBCConfig } from '../../lib/s2/frbc-controller'

export = function (RED: NodeRedApp): void {
  function S2FrbcConfigNodeConstructor (this: S2FrbcConfigNode, config: NodeConfig): void {
    RED.nodes.createNode(this, config)
    this.systemDescription = config.systemDescription as string
    this.leakageBehaviour = config.leakageBehaviour as string
  }

  RED.nodes.registerType('s2-frbc-config', S2FrbcConfigNodeConstructor)

  // Backs s2-frbc-config's save-time validation - the generated schema validator is a plain
  // Node.js module and can't run in the browser without a bundler, so the editor calls this.
  RED.httpAdmin.post('/s2/validate-frbc-config', RED.auth.needsPermission('s2-frbc-config.write'), function (req, res) {
    const body = req.body as { systemDescription?: unknown, leakageBehaviour?: unknown } | undefined
    let config: FRBCConfig
    try {
      config = parseFRBCConfig(
        typeof body?.systemDescription === 'string' ? body.systemDescription : '',
        typeof body?.leakageBehaviour === 'string' ? body.leakageBehaviour : ''
      )
    } catch (err) {
      res.json({ valid: false, errors: [(err as Error).message] })
      return
    }
    const errors = validateFRBCConfig(config)
    res.json({ valid: errors.length === 0, errors })
  })
}
