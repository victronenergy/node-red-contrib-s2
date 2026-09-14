import { ValidateFunction } from 'ajv'

/**
 * Type declaration for the auto-generated schema-validators.generated.js (see that file's own
 * header, and scripts/generate-schema-validators.js) - one exported precompiled validator
 * function per vendored message schema, keyed by a sanitized export name, plus a map from the
 * real S2 message_type string to that export name.
 */
interface GeneratedValidators {
  messageTypeToExport: Record<string, string>
  [exportName: string]: ValidateFunction | Record<string, string>
}

declare const validators: GeneratedValidators
export = validators
