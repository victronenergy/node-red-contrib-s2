# editor-dialogs Specification

## Purpose
Defines how the S2 nodes' edit dialogs look in the Node-RED editor, independent of what each dialog contains: they follow the editor's theme, light or dark, and keep their text readable in it.

## Requirements

### Requirement: Edit dialogs follow the editor theme
The S2 nodes' edit dialogs and their tooltips SHALL take their text, background and border colours from the Node-RED editor theme's `--red-ui-*` variables, falling back to the current colours when a variable is not defined. Text in them SHALL have a contrast ratio of at least 4.5:1 against its background in both the default theme and a dark theme. Brand colours (the tooltip icon, the `s2-resource` palette label) MAY stay fixed.

#### Scenario: Dark editor theme
- **WHEN** the editor uses a dark theme such as `dark-modern` and an `s2-resource` dialog is opened
- **THEN** the hint box, tabs, section labels and warning boxes use the theme's dark surfaces, with no white blocks, and their text has a contrast ratio of at least 4.5:1

#### Scenario: Default editor theme
- **WHEN** the editor uses Node-RED's default theme
- **THEN** the dialogs look as before, apart from shades that now come from the theme's own variables, and their text still has a contrast ratio of at least 4.5:1
