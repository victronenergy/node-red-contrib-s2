## 1. Before

- [x] 1.1 Measure contrast and take screenshots of the `s2-resource` dialog (Connection, RM, Control tabs, WebSocket ID warning) under `dark-modern` on main: hint and active tab are white blocks; inactive tabs and section labels are at 2.87:1.

## 2. Fix

- [x] 2.1 Replace the editor-surface colours in `resources/s2-styles.css` with `--red-ui-*` variables, keeping the current colours as fallbacks; merge the three warning-box rules.

## 3. Verify

- [x] 3.1 Same measurements and screenshots under `dark-modern`: no white blocks, every measured text at 4.5:1 or more.
- [x] 3.2 Same under the default theme: unchanged look, every measured text at 4.5:1 or more.
- [x] 3.3 Spot-check a second dark theme (`midnight-red`) and the `s2-ombc-config`, `s2-pebc-config` and `s2-rm-config` dialogs. (All S2-styled text at 5.45:1 or more; the only lower value, 3.9:1, is Node-RED's own editableList "add" button, coloured by the theme.)

## 4. Docs and validation

- [x] 4.1 CHANGELOG.
- [x] 4.2 `npm test`, `npm run build` pass; `openspec validate dark-mode-dialogs --strict` passes.
