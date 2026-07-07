/* global $ */

window.__s2Common = window.__s2Common || {}

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
