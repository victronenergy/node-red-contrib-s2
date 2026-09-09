/* global $ */

// Shared OMBC friendly-editor widget, loaded by both s2-ombc-config and
// s2-resource (Control Type: OMBC tab) so there is exactly one copy of this
// logic - see openspec/changes/2026-09-07-s2-resource-composite-node.

window.__s2OmbcEditor = window.__s2OmbcEditor || (function () {
  function generateUuid () {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })
  }

  // FNV-1a, used only to seed deriveTimerId's PRNG below - not a general hash utility.
  function hashSeed (str) {
    var h = 0x811c9dc5
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    return h >>> 0
  }

  // A per-mode minimum-duration timer needs a stable id, so unchanged config
  // re-saves byte-identical - but s2-python validates every S2 id as UUID4
  // and rejects any other format, so a custom string (e.g. 'min-duration:'
  // + modeId) isn't an option. This derives an id in generateUuid()'s exact
  // format (same version/variant nibble forcing), from a mulberry32 PRNG
  // seeded from the mode's own id instead of Math.random() - deterministic
  // per mode, but structurally indistinguishable from a real UUID4.
  function deriveTimerId (modeId) {
    var state = hashSeed(modeId)
    function next () {
      state |= 0
      state = (state + 0x6D2B79F5) | 0
      var t = Math.imul(state ^ (state >>> 15), 1 | state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = next() * 16 | 0
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })
  }

  // Every configured mode able to transition to every other configured mode.
  // `modes` here is [{ id, timerId }] - timerId is the id of the mode's
  // minimum-duration timer (started on entry, blocking on exit), or null.
  function buildTransitions (modes) {
    var transitions = []
    for (var i = 0; i < modes.length; i++) {
      for (var j = 0; j < modes.length; j++) {
        if (i === j) continue
        var from = modes[i]
        var to = modes[j]
        transitions.push({
          id: generateUuid(),
          from: from.id,
          to: to.id,
          start_timers: to.timerId ? [to.timerId] : [],
          blocking_timers: from.timerId ? [from.timerId] : [],
          abnormal_condition_only: false
        })
      }
    }
    return transitions
  }

  function friendlyStateToSystemDescription (modes) {
    var operationModes = modes.map(function (m) {
      var powerRanges
      if (m.symmetric) {
        powerRanges = [{
          commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC',
          start_of_range: m.valueSymmetric,
          end_of_range: m.valueSymmetric
        }]
      } else {
        powerRanges = [
          { commodity_quantity: 'ELECTRIC.POWER.L1', start_of_range: m.valueL1, end_of_range: m.valueL1 },
          { commodity_quantity: 'ELECTRIC.POWER.L2', start_of_range: m.valueL2, end_of_range: m.valueL2 },
          { commodity_quantity: 'ELECTRIC.POWER.L3', start_of_range: m.valueL3, end_of_range: m.valueL3 }
        ]
      }
      return {
        id: m.id,
        diagnostic_label: m.label,
        power_ranges: powerRanges,
        // Friendly mode's auto-derived transitions are always fully connected, so a
        // mode reachable only under abnormal conditions can never actually be
        // represented - always false here (see "No abnormal-condition-only toggle").
        abnormal_condition_only: false
      }
    })
    var timers = []
    var modesWithTimerId = modes.map(function (m) {
      var minDurationMs = (Number(m.minDurationMinutes) || 0) * 60000 + (Number(m.minDurationSeconds) || 0) * 1000
      var timerId = null
      if (minDurationMs > 0) {
        timerId = deriveTimerId(m.id)
        timers.push({ id: timerId, duration: minDurationMs })
      }
      return { id: m.id, timerId: timerId }
    })
    return {
      operationModes: operationModes,
      transitions: buildTransitions(modesWithTimerId),
      timers: timers
    }
  }

  function isFriendlyPowerRanges (ranges) {
    if (!Array.isArray(ranges)) return false
    if (ranges.length === 1) {
      var r = ranges[0]
      return !!r && r.commodity_quantity === 'ELECTRIC.POWER.3_PHASE_SYMMETRIC' &&
        typeof r.start_of_range === 'number' && r.start_of_range === r.end_of_range
    }
    if (ranges.length === 3) {
      var byCq = {}
      for (var i = 0; i < ranges.length; i++) {
        var rr = ranges[i]
        if (!rr || typeof rr.start_of_range !== 'number' || rr.start_of_range !== rr.end_of_range) return false
        byCq[rr.commodity_quantity] = rr.start_of_range
      }
      return ('ELECTRIC.POWER.L1' in byCq) && ('ELECTRIC.POWER.L2' in byCq) && ('ELECTRIC.POWER.L3' in byCq)
    }
    return false
  }

  // Reference is [] (no timer) or a single string id - anything else (a
  // bespoke multi-timer wiring) is only expressible in Advanced mode.
  function isSingleOrEmptyTimerRef (arr) {
    return Array.isArray(arr) && arr.length <= 1 && (arr.length === 0 || typeof arr[0] === 'string')
  }

  // Records modeId -> timerId|null the first time it's seen, then requires
  // every later reference for that same modeId to agree - the per-mode
  // minimum-duration timer must be wired identically into every transition
  // that shares that mode's inbound (or outbound) side.
  function consistentTimerRef (map, modeId, timerIdOrNull) {
    if (!(modeId in map)) {
      map[modeId] = timerIdOrNull
      return true
    }
    return map[modeId] === timerIdOrNull
  }

  // Strict structural check: true only when systemDescription is exactly what
  // friendly mode itself would produce, so switching modes never silently
  // narrows something Advanced mode expresses that friendly mode can't.
  function isFriendlyRepresentable (sysDesc) {
    if (!sysDesc || typeof sysDesc !== 'object') return false
    var modes = sysDesc.operationModes
    if (!Array.isArray(modes) || modes.length === 0) return false

    var modeIds = []
    for (var i = 0; i < modes.length; i++) {
      var m = modes[i]
      if (!m || typeof m.id !== 'string' || !m.id || modeIds.indexOf(m.id) !== -1) return false
      if (!isFriendlyPowerRanges(m.power_ranges)) return false
      modeIds.push(m.id)
    }

    var transitions = sysDesc.transitions
    if (!Array.isArray(transitions) || transitions.length !== modeIds.length * (modeIds.length - 1)) return false

    // Per mode: the single timer id (if any) that every transition into it
    // shares in start_timers, and that every transition out of it shares in
    // blocking_timers - populated as transitions are walked below.
    var inboundTimerId = {}
    var outboundTimerId = {}
    var seenPairs = {}
    for (var j = 0; j < transitions.length; j++) {
      var t = transitions[j]
      if (!t || modeIds.indexOf(t.from) === -1 || modeIds.indexOf(t.to) === -1 || t.from === t.to) return false
      if (!isSingleOrEmptyTimerRef(t.start_timers) || !isSingleOrEmptyTimerRef(t.blocking_timers)) return false
      if (t.abnormal_condition_only) return false
      var key = t.from + '>' + t.to
      if (seenPairs[key]) return false
      seenPairs[key] = true

      var startId = t.start_timers.length ? t.start_timers[0] : null
      if (!consistentTimerRef(inboundTimerId, t.to, startId)) return false
      var blockId = t.blocking_timers.length ? t.blocking_timers[0] : null
      if (!consistentTimerRef(outboundTimerId, t.from, blockId)) return false
    }
    for (var a = 0; a < modeIds.length; a++) {
      for (var b = 0; b < modeIds.length; b++) {
        if (a === b) continue
        if (!seenPairs[modeIds[a] + '>' + modeIds[b]]) return false
      }
    }

    // A mode's minimum-duration timer must be wired symmetrically: the same
    // id started on every transition in and blocked on every transition out.
    var timerIdByMode = {}
    for (var c = 0; c < modeIds.length; c++) {
      var modeId = modeIds[c]
      var inb = inboundTimerId[modeId] || null
      var outb = outboundTimerId[modeId] || null
      if (inb !== outb) return false
      if (inb) timerIdByMode[modeId] = inb
    }

    var timers = sysDesc.timers
    if (!Array.isArray(timers)) return false
    var expectedTimerIds = {}
    for (var modeKey in timerIdByMode) expectedTimerIds[timerIdByMode[modeKey]] = true
    var expectedCount = Object.keys(expectedTimerIds).length
    if (timers.length !== expectedCount) return false

    var seenTimerIds = {}
    for (var k = 0; k < timers.length; k++) {
      var timer = timers[k]
      if (!timer || typeof timer.id !== 'string' || !timer.id) return false
      if (seenTimerIds[timer.id] || !expectedTimerIds[timer.id]) return false
      seenTimerIds[timer.id] = true
      // Whole seconds only - friendly mode's UI offers minutes/seconds, so a
      // sub-second remainder can't have come from friendly mode and can't be
      // represented without silently rounding it away.
      if (typeof timer.duration !== 'number' || timer.duration <= 0 || timer.duration % 1000 !== 0) return false
    }

    return true
  }

  // modeId -> configured minimum-duration timer's duration (ms), read off
  // the `to` side of each transition's start_timers (only called after
  // isFriendlyRepresentable has confirmed inbound/outbound wiring agree).
  function modeTimerDurations (sysDesc) {
    var durationById = {}
    ;(sysDesc.timers || []).forEach(function (timer) { durationById[timer.id] = timer.duration })
    var result = {}
    ;(sysDesc.transitions || []).forEach(function (t) {
      if (t.start_timers && t.start_timers.length) {
        result[t.to] = durationById[t.start_timers[0]]
      }
    })
    return result
  }

  // Only called after isFriendlyRepresentable has passed.
  function systemDescriptionToFriendlyState (sysDesc) {
    var durationByMode = modeTimerDurations(sysDesc)
    return sysDesc.operationModes.map(function (m) {
      var duration = durationByMode[m.id] || 0
      var minDurationMinutes = Math.floor(duration / 60000)
      var minDurationSeconds = Math.floor((duration % 60000) / 1000)
      var ranges = m.power_ranges
      if (ranges.length === 1) {
        return {
          id: m.id,
          protected: false,
          label: m.diagnostic_label || '',
          symmetric: true,
          valueSymmetric: ranges[0].start_of_range,
          valueL1: 0,
          valueL2: 0,
          valueL3: 0,
          minDurationMinutes: minDurationMinutes,
          minDurationSeconds: minDurationSeconds
        }
      }
      var byCq = {}
      ranges.forEach(function (r) { byCq[r.commodity_quantity] = r.start_of_range })
      return {
        id: m.id,
        protected: false,
        label: m.diagnostic_label || '',
        symmetric: false,
        valueSymmetric: 0,
        valueL1: byCq['ELECTRIC.POWER.L1'],
        valueL2: byCq['ELECTRIC.POWER.L2'],
        valueL3: byCq['ELECTRIC.POWER.L3'],
        minDurationMinutes: minDurationMinutes,
        minDurationSeconds: minDurationSeconds
      }
    })
  }

  function defaultStandbyMode () {
    return {
      id: generateUuid(),
      protected: true,
      label: 'Standby/off',
      symmetric: true,
      valueSymmetric: 0,
      valueL1: 0,
      valueL2: 0,
      valueL3: 0
    }
  }

  // editableList 'addItem' callback: renders one operation-mode row into `container`.
  function addModeItem (container, index, opt) {
    opt = opt || {}
    if (!opt.id) opt.id = generateUuid()
    // Node-RED's default editableList item content is `display:grid;
    // grid-template-columns:50% 50%`, which grid-places our rows into
    // separate 50%-wide columns instead of stacking them - override back
    // to a normal block flow (core nodes like `switch` do the same thing
    // to get their own single-row flex layout instead of the grid default).
    container.css({ overflow: 'visible', display: 'block' })

    var row1 = $('<div/>', { class: 's2-ombc-mode-row' }).appendTo(container)
    $('<input/>', { type: 'text', class: 's2-ombc-mode-label', placeholder: 'Mode label' })
      .val(opt.label || '')
      .appendTo(row1)

    var row2 = $('<div/>', { class: 's2-ombc-mode-row' }).appendTo(container)
    var symLabel = $('<label/>', { class: 's2-ombc-mode-checkbox-label' }).appendTo(row2)
    var symCheckbox = $('<input/>', { type: 'checkbox', class: 's2-ombc-mode-symmetric' })
      .prop('checked', opt.symmetric !== false)
      .appendTo(symLabel)
    symLabel.append(' Same value on all phases')

    var row3 = $('<div/>', { class: 's2-ombc-mode-row' }).appendTo(container)
    var symWrap = $('<span/>', { class: 's2-ombc-mode-value-wrap' }).appendTo(row3)
    var symValue = $('<input/>', { type: 'number', class: 's2-ombc-mode-value-sym', step: '1' })
      .val(opt.valueSymmetric != null ? opt.valueSymmetric : 0)
      .appendTo(symWrap)
    symWrap.append($('<span/>', { class: 's2-unit-label' }).text('W'))

    var phaseWrap = $('<span/>', { class: 's2-ombc-mode-value-wrap' }).appendTo(row3)
    // Each phase's label+input is wrapped in its own group so setActivePhase() can dim/disable
    // whichever ones don't apply (e.g. a single-phase D-Bus device wired to just L2) as a unit.
    var l1Group = $('<span/>', { class: 's2-ombc-mode-phase-group s2-ombc-mode-phase-l1' }).appendTo(phaseWrap)
    l1Group.append('L1 ')
    var l1 = $('<input/>', { type: 'number', class: 's2-ombc-mode-value-l1', step: '1' }).val(opt.valueL1 || 0).appendTo(l1Group)
    var l2Group = $('<span/>', { class: 's2-ombc-mode-phase-group s2-ombc-mode-phase-l2' }).appendTo(phaseWrap)
    l2Group.append(' L2 ')
    var l2 = $('<input/>', { type: 'number', class: 's2-ombc-mode-value-l2', step: '1' }).val(opt.valueL2 || 0).appendTo(l2Group)
    var l3Group = $('<span/>', { class: 's2-ombc-mode-phase-group s2-ombc-mode-phase-l3' }).appendTo(phaseWrap)
    l3Group.append(' L3 ')
    var l3 = $('<input/>', { type: 'number', class: 's2-ombc-mode-value-l3', step: '1' }).val(opt.valueL3 || 0).appendTo(l3Group)
    phaseWrap.append($('<span/>', { class: 's2-unit-label' }).text('W'))

    function updateSymVisibility () {
      if (symCheckbox.prop('checked')) {
        symWrap.show()
        phaseWrap.hide()
      } else {
        symWrap.hide()
        phaseWrap.show()
      }
    }
    symCheckbox.on('change', updateSymVisibility)
    updateSymVisibility()

    var row4 = $('<div/>', { class: 's2-ombc-mode-row' }).appendTo(container)
    row4.append('Minimum time in this mode: ')
    var minDurWrap = $('<span/>', { class: 's2-ombc-mode-value-wrap' }).appendTo(row4)
    $('<input/>', { type: 'number', class: 's2-ombc-mode-min-duration-minutes', min: '0', step: '1' })
      .val(opt.minDurationMinutes || 0)
      .appendTo(minDurWrap)
    minDurWrap.append($('<span/>', { class: 's2-unit-label' }).text('min'))
    $('<input/>', { type: 'number', class: 's2-ombc-mode-min-duration-seconds', min: '0', max: '59', step: '1' })
      .val(opt.minDurationSeconds || 0)
      .appendTo(minDurWrap)
    minDurWrap.append($('<span/>', { class: 's2-unit-label' }).text('sec'))

    if (opt.protected) {
      $('<div/>', { class: 's2-ombc-mode-protected-note' }).text('Always present - remove via Advanced mode if not needed.').appendTo(container)
    }
  }

  // Reads the current editableList state (given its jQuery selector) back into
  // the same plain-object shape addModeItem/friendlyStateToSystemDescription use.
  function getFriendlyModes (listSel) {
    var modes = []
    $(listSel).editableList('items').each(function () {
      var $item = $(this)
      var data = $item.data('data') || {}
      modes.push({
        id: data.id,
        protected: !!data.protected,
        label: $item.find('.s2-ombc-mode-label').val(),
        symmetric: $item.find('.s2-ombc-mode-symmetric').prop('checked'),
        valueSymmetric: Number($item.find('.s2-ombc-mode-value-sym').val()) || 0,
        valueL1: Number($item.find('.s2-ombc-mode-value-l1').val()) || 0,
        valueL2: Number($item.find('.s2-ombc-mode-value-l2').val()) || 0,
        valueL3: Number($item.find('.s2-ombc-mode-value-l3').val()) || 0,
        minDurationMinutes: Number($item.find('.s2-ombc-mode-min-duration-minutes').val()) || 0,
        minDurationSeconds: Number($item.find('.s2-ombc-mode-min-duration-seconds').val()) || 0
      })
    })
    return modes
  }

  // Dims and disables the per-phase L1/L2/L3 label+input group(s) that don't match
  // activePhase (1, 2, or 3) across every mode row in the given editableList - for a
  // single-phase device wired to one specific line, the other two phases' fields are never
  // actually used. Pass null/undefined for activePhase to re-enable all phases (e.g. when
  // the device reports more than one phase, or no such constraint applies).
  function setActivePhase (listSel, activePhase) {
    $(listSel).find('.s2-ombc-mode-phase-group').each(function () {
      var $group = $(this)
      var isActive = activePhase == null || $group.hasClass('s2-ombc-mode-phase-l' + activePhase)
      $group.toggleClass('s2-ombc-mode-phase-dimmed', !isActive)
      $group.find('input').prop('disabled', !isActive)
    })
  }

  return {
    generateUuid: generateUuid,
    defaultStandbyMode: defaultStandbyMode,
    friendlyStateToSystemDescription: friendlyStateToSystemDescription,
    isFriendlyRepresentable: isFriendlyRepresentable,
    systemDescriptionToFriendlyState: systemDescriptionToFriendlyState,
    addModeItem: addModeItem,
    getFriendlyModes: getFriendlyModes,
    setActivePhase: setActivePhase
  }
})()
