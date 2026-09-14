import { ErrorObject, ValidateFunction } from 'ajv'
import generatedValidators from './schema-validators.generated'

/**
 * Validates S2 payloads against precompiled validators for the vendored `s2-json` v0.0.2-beta
 * schema set (src/lib/s2/s2-json-schema/ - see VENDORED.md there for provenance), matching this
 * repo's own supported_protocol_versions.
 *
 * The validators themselves are generated ahead of time (schema-validators.generated.js, via
 * `npm run generate-schema-validators`) rather than compiled from the raw JSON schemas by a live
 * `ajv` instance at runtime - `ajv` itself is ~2.3M installed, about 5x this project's entire
 * other production dependency footprint combined, which matters on the disk-constrained device
 * this package ships to. `ajv`/`ajv-formats` are devDependencies, used only by the generator
 * script; only the small generated output and `ajv-formats` (which the generated code calls into
 * for format checks like date-time) ship to the device.
 */

/**
 * Two known ResourceManagerDetails.schema.json constraints don't appear in the S2 standard's own
 * prose documentation and are suspected schema-authoring defects (unconfirmed with upstream as of
 * this writing) - see specs/s2-message-validation/spec.md's "Known upstream schema discrepancies
 * do not block valid messages" requirement:
 *  - maxItems: 5 on available_control_types - s2-rm-protocol's "NOT_CONTROLABLE is always
 *    advertised" guarantee means a resource with all 5 real control types selected legally
 *    advertises 6 entries.
 *  - minItems: 1 on provides_power_measurement_types - a resource with "Provides power
 *    measurement" unchecked legally advertises an empty array.
 * Both are treated as advisory (logged, not enforced) rather than blocking the message.
 */
function isKnownAdvisoryError (err: ErrorObject): boolean {
  if (err.keyword === 'maxItems' && err.instancePath === '/available_control_types') return true
  if (err.keyword === 'minItems' && err.instancePath === '/provides_power_measurement_types') return true
  return false
}

function getValidatorForMessageType (messageType: string): ValidateFunction | null {
  const exportName = generatedValidators.messageTypeToExport[messageType]
  if (!exportName) return null
  const validate = generatedValidators[exportName]
  return typeof validate === 'function' ? validate : null
}

export interface ValidationResult {
  valid: boolean
  /** Human-readable validation error(s), only present when valid is false. */
  errors?: string[]
  /** Set when the payload had known-advisory violations only (see isKnownAdvisoryError) - valid is still true. */
  advisory?: string[]
}

/**
 * Validate an S2 message payload against the schema matching its own `message_type`.
 * Returns { valid: true } (no `errors`) when there's no generated validator for that message_type
 * at all - an unrecognized/unimplemented message type is not this function's concern.
 */
export function validateS2Message (payload: unknown): ValidationResult {
  const messageType = (payload as { message_type?: unknown } | null)?.message_type
  if (typeof messageType !== 'string') return { valid: true }

  const validate = getValidatorForMessageType(messageType)
  if (!validate) return { valid: true }

  if (validate(payload)) return { valid: true }

  const allErrors = validate.errors ?? []
  const advisoryErrors = allErrors.filter(isKnownAdvisoryError)
  const blockingErrors = allErrors.filter((e) => !isKnownAdvisoryError(e))

  const result: ValidationResult = { valid: blockingErrors.length === 0 }
  if (blockingErrors.length > 0) {
    result.errors = blockingErrors.map(formatError)
  }
  if (advisoryErrors.length > 0) {
    result.advisory = advisoryErrors.map(formatError)
  }
  return result
}

function formatError (err: ErrorObject): string {
  const where = err.instancePath || '(root)'
  return `${where} ${err.message ?? 'is invalid'}`.trim()
}
