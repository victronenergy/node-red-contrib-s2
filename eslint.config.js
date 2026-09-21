'use strict'

const js = require('@eslint/js')
const tsPlugin = require('@typescript-eslint/eslint-plugin')
const globals = require('globals')

module.exports = [
  {
    // Auto-generated/vendored by scripts/generate-schema-validators.js - not hand-written, not
    // meant to be lint-clean (minified ajv-generated validator code, and vendored ajv/ajv-formats
    // runtime helper files copied verbatim from their own packages).
    ignores: ['src/lib/s2/schema-validators.generated.js', 'src/lib/s2/ajv-runtime/']
  },
  js.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-this-alias': 'off'
    }
  }
]
