/* global $ */

window.__s2Common = window.__s2Common || {}

// Pre-fill handoff for a new config node's Name, keyed per config type to avoid cross-type leaks.
window.__s2Common._pendingConfigNames = window.__s2Common._pendingConfigNames || {}

window.__s2Common.setPendingConfigName = function (configType, name) {
  window.__s2Common._pendingConfigNames[configType] = name
}

window.__s2Common.takePendingConfigName = function (configType) {
  const name = window.__s2Common._pendingConfigNames[configType]
  delete window.__s2Common._pendingConfigNames[configType]
  return name
}

window.__s2Common.generateUuid = function () {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

// Same pattern Node-RED uses to substitute a whole property value from the node's environment
// (e.g. a subflow instance property) before the node starts.
window.__s2Common.isEnvRef = function (value) {
  return /^\$\{\S+\}$/.test(value)
}

// A CEM tells resources apart by resource ID only, and copy-paste or a repeated import copies the
// ID along with the rest of the node - so an ID another S2 node already holds must be replaced.
// An environment variable reference resolves per subflow instance at runtime, so it is kept.
window.__s2Common.resourceIdNeedsReplacing = function (RED, node) {
  if (!node.resourceId) return true
  if (window.__s2Common.isEnvRef(node.resourceId)) return false
  let taken = false
  const check = function (other) {
    if (other.id !== node.id &&
        (other.type === 's2-resource' || other.type === 's2-rm-config') &&
        other.resourceId === node.resourceId) {
      taken = true
      return false
    }
  }
  RED.nodes.eachNode(check)
  if (!taken) RED.nodes.eachConfig(check)
  return taken
}

// Any UUID version: s2python types resource_id as Python's uuid.UUID, which accepts them all.
window.__s2Common.isUuid = function (value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

// The S2 ID schema's pattern, anchored - the schema's own is unanchored, so taken literally it
// accepts any string containing two valid characters. Empty is allowed: oneditsave fills it in.
window.__s2Common.validateResourceId = function (RED, node, value) {
  if (!value || window.__s2Common.isEnvRef(value)) return true
  if (!/^[a-zA-Z0-9\-_:]{2,64}$/.test(value)) {
    return 'Resource ID must be 2-64 characters: letters, digits, "-", "_" or ":"'
  }
  if (window.__s2Common.resourceIdNeedsReplacing(RED, { id: node.id, resourceId: value })) {
    return 'Resource ID is already used by another S2 resource'
  }
  return true
}

// nodes:add rather than a node definition's onadd: onadd only runs for nodes landing on the
// active tab, so an import that brings its own tab (every shipped example, any exported flow)
// would keep duplicate IDs. nodes:add also fires when the editor loads or reloads the deployed
// flows, which must be left alone - a deployed duplicate is reported by the runtime instead. Only
// user additions arrive marked changed: the palette sets it, and paste and imports use markChanged.
window.__s2Common.watchResourceIds = function (RED) {
  if (window.__s2Common._watchingResourceIds) return
  window.__s2Common._watchingResourceIds = true

  RED.events.on('nodes:add', function (node) {
    if (!node.changed) return
    if (node.type !== 's2-resource' && node.type !== 's2-rm-config') return
    if (window.__s2Common.resourceIdNeedsReplacing(RED, node)) {
      node.resourceId = window.__s2Common.generateUuid()
    }
  })
}

window.__s2Common.initializeTooltips = function () {
  $('.s2-tooltip-container').remove()
  $('.s2-form .tooltip-icon').off('mouseenter.s2 mouseleave.s2')

  $('.s2-form .tooltip-icon').on('mouseenter.s2', function () {
    const $icon = $(this)
    const tooltipText = $icon.attr('data-tooltip')
    if (!tooltipText) return

    const $tooltip = $('<div class="s2-tooltip-container"></div>').text(tooltipText)
    $('body').append($tooltip)

    const iconOffset = $icon.offset()
    const tooltipHeight = $tooltip.outerHeight()
    const tooltipWidth = $tooltip.outerWidth()

    $tooltip.css({
      top: iconOffset.top - tooltipHeight - 8,
      left: iconOffset.left - (tooltipWidth / 2) + ($icon.outerWidth() / 2)
    })

    $icon.data('s2-tooltip', $tooltip)
  })

  $('.s2-form .tooltip-icon').on('mouseleave.s2', function () {
    const $icon = $(this)
    const $tooltip = $icon.data('s2-tooltip')
    if ($tooltip) {
      $tooltip.remove()
      $icon.removeData('s2-tooltip')
    }
  })
}
