import { NodeRedApp, NodeConfig } from '../../types/node-red'
import { S2PebcConfigNode } from '../../types/config-nodes'
import { makePEBCPowerConstraints, parsePEBCPowerConstraintsInput } from '../../lib/s2/messages'
import { validateS2Message } from '../../lib/s2/schema-validation'

export = function (RED: NodeRedApp): void {
  function S2PebcConfigNodeConstructor (this: S2PebcConfigNode, config: NodeConfig): void {
    RED.nodes.createNode(this, config)
    this.gridConnection = config.gridConnection as string
    this.customMaxPowerW = config.customMaxPowerW != null ? Number(config.customMaxPowerW) : undefined
    this.constraints = (config.constraints as string) || ''
  }

  RED.nodes.registerType('s2-pebc-config', S2PebcConfigNodeConstructor)

  // Backs the Advanced-mode JSON editor's save-time validation (see s2-pebc-config/index.html) -
  // the generated schema validator (schema-validators.generated.js) is a plain Node.js CommonJS
  // module and can't run in the browser without a bundler, so the editor calls this endpoint
  // instead of validating client-side.
  RED.httpAdmin.post('/s2/validate-pebc-constraints', RED.auth.needsPermission('s2-pebc-config.write'), function (req, res) {
    const body = req.body as { constraints?: unknown } | undefined
    const raw = typeof body?.constraints === 'string' ? body.constraints : ''
    let parsedRaw: unknown
    try {
      parsedRaw = JSON.parse(raw)
    } catch (err) {
      res.json({ valid: false, errors: ['Invalid JSON: ' + (err as Error).message] })
      return
    }
    if (typeof parsedRaw !== 'object' || parsedRaw === null || Array.isArray(parsedRaw)) {
      res.json({ valid: false, errors: ['Constraints must be a JSON object'] })
      return
    }
    const input = parsePEBCPowerConstraintsInput(raw)
    if (!input) {
      res.json({ valid: false, errors: ['Must have a string "commodityQuantity" and numeric "minPower"/"maxPower"'] })
      return
    }
    const message = makePEBCPowerConstraints(input)
    const result = validateS2Message(message)
    res.json({ valid: result.valid, errors: result.errors })
  })
}
