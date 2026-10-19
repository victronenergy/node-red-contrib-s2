## Why

With a dark Node-RED editor theme (e.g. `dark-modern` from `@node-red-contrib-themes/theme-collection`, the collection Venus's `settings.js` points to), the S2 edit dialogs keep light colours on the dark tray:
- the hint box and the active tabs are white blocks;
- the code snippets in the hint are light grey on white;
- inactive tabs and section labels are #666 text on near-black (contrast 2.87:1, below the 4.5:1 WCAG minimum for body text).

Node-RED themes work by redefining the editor's `--red-ui-*` CSS variables, and `resources/s2-styles.css` uses none of them: about 30 colours are hardcoded.

## What Changes

- Every colour in `resources/s2-styles.css` that belongs to the editor surface (text, backgrounds, borders, shadows, the tooltip) uses the matching `--red-ui-*` variable. The current colour stays as the fallback, so the default light theme looks the same or nearly the same.
- The three identical warning-box rules are merged into one, and their background becomes a translucent amber that works on light and dark trays.
- Brand colours stay as they are: the `#00BCFF` tooltip icon, and the white label on `s2-resource`'s blue palette entry.

## Capabilities

### New Capabilities
- `editor-dialogs`: S2 edit dialogs follow the Node-RED editor theme.

### Modified Capabilities
(none)

## Impact

- `resources/s2-styles.css` only. No markup, runtime or behaviour change.
- CHANGELOG.
