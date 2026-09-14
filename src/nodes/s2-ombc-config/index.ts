import { NodeRedApp, NodeConfig } from '../../types/node-red'
import { S2OmbcConfigNode } from '../../types/config-nodes'
import { makeOMBCSystemDescription, OMBCSystemDescriptionConfig } from '../../lib/s2/messages'
import { validateS2Message } from '../../lib/s2/schema-validation'

export = function (RED: NodeRedApp): void {
  function S2OmbcConfigNodeConstructor (this: S2OmbcConfigNode, config: NodeConfig): void {
    RED.nodes.createNode(this, config)
    this.systemDescription = config.systemDescription as string
  }

  RED.nodes.registerType('s2-ombc-config', S2OmbcConfigNodeConstructor)

  // Backs the Advanced-mode JSON editor's save-time validation on both s2-ombc-config and
  // s2-resource (its embedded OMBC editor uses the same systemDescription shape) - the generated
  // schema validator (schema-validators.generated.js) is a plain Node.js CommonJS module and
  // can't run in the browser without a bundler, so the editor calls this endpoint instead of
  // validating client-side.
  RED.httpAdmin.post('/s2/validate-system-description', RED.auth.needsPermission('s2-ombc-config.write'), function (req, res) {
    const body = req.body as { systemDescription?: unknown } | undefined
    let parsed: unknown
    try {
      parsed = JSON.parse(typeof body?.systemDescription === 'string' ? body.systemDescription : '')
    } catch (err) {
      res.json({ valid: false, errors: ['Invalid JSON: ' + (err as Error).message] })
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      res.json({ valid: false, errors: ['System description must be a JSON object'] })
      return
    }
    const message = makeOMBCSystemDescription(parsed as OMBCSystemDescriptionConfig)
    const result = validateS2Message(message)
    res.json({ valid: result.valid, errors: result.errors?.map(toEditorFieldNames) })
  })
}

// makeOMBCSystemDescription() renames the Advanced-mode JSON's top-level `operationModes` to the
// wire format's `operation_modes` (the only renamed field - transitions/timers keep their name
// both sides); validateS2Message() reports errors against that wire shape. Translate the path
// back before it reaches the editor, so an error points at the field name the user actually typed
// rather than one that only exists in the constructed S2 message.
function toEditorFieldNames (error: string): string {
  return error.replace('/operation_modes', '/operationModes')
}
