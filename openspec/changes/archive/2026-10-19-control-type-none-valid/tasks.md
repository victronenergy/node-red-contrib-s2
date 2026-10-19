## 1. Reproduce

- [x] 1.1 With Playwright on a throwaway editor: a palette-dropped `s2-resource` set to Control type None is invalid after Done (red), as reported in #69.

## 2. Fix

- [x] 2.1 `required: false` on `systemDescription` in `src/nodes/s2-resource/index.html`.
- [x] 2.2 Re-run 1.1: the node is valid and deploy shows no warning (green); malformed JSON in the system description is still flagged.

## 3. Docs and validation

- [x] 3.1 CHANGELOG (Fixed, referencing #69).
- [x] 3.2 `npm test` and `npm run build` pass; `openspec validate control-type-none-valid --strict` passes.
