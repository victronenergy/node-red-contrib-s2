# Vendored ajv/ajv-formats runtime helpers

Auto-vendored by `scripts/generate-schema-validators.js` alongside `../schema-validators.generated.js`
- do not edit by hand, regenerate instead (`npm run generate-schema-validators`).

Each file here is a small runtime dependency the generated validators require directly (by
relative path, rewritten from the package they actually came from):

- `formats.js` - from `ajv-formats/dist/formats.js` (self-contained, no further requires of its
  own - used for format checks like `date-time`).
- Any `ajv/dist/runtime/*.js` file the generated code happens to need (none as of this writing -
  our schemas don't exercise the ajv features that need them).

This exists so the device this package ships to never needs the full `ajv` (~2.3M installed) or
`ajv-formats` (which itself depends on the full `ajv`) packages installed at all - see
`src/lib/s2/schema-validation.ts`'s header comment.
