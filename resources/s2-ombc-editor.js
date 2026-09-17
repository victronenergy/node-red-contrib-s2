/* global $ */

// Shared OMBC friendly-editor widget, loaded by both s2-ombc-config and
// s2-resource (Control Type: OMBC tab) so there is exactly one copy of this
// logic - see openspec/changes/2026-09-07-s2-resource-composite-node.

window.__s2OmbcEditor = window.__s2OmbcEditor || (function () {
  function generateUuid () {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })
  }

  // FNV-1a, used only to seed deriveTimerId's PRNG below - not a general hash utility.
  function hashSeed (str) {
    let h = 0x811c9dc5
    for (let i = 0; i < str.length; i++) {
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
    let state = hashSeed(modeId)
    function next () {
      state |= 0
      state = (state + 0x6D2B79F5) | 0
      let t = Math.imul(state ^ (state >>> 15), 1 | state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = next() * 16 | 0
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })
  }

  // Every configured mode able to transition to every other configured mode.
  // `modes` here is [{ id, timerId }] - timerId is the id of the mode's
  // minimum-duration timer (started on entry, blocking on exit), or null.
  function buildTransitions (modes) {
    const transitions = []
    for (let i = 0; i < modes.length; i++) {
      for (let j = 0; j < modes.length; j++) {
        if (i === j) continue
        const from = modes[i]
        const to = modes[j]
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
    const operationModes = modes.map(function (m) {
      let powerRanges
      if (m.symmetric) {
        const symFrom = m.modulate ? m.valueSymmetricFrom : m.valueSymmetric
        const symTo = m.modulate ? m.valueSymmetricTo : m.valueSymmetric
        powerRanges = [{
          commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC',
          start_of_range: symFrom,
          end_of_range: symTo
        }]
      } else {
        const l1From = m.modulate ? m.valueL1From : m.valueL1
        const l1To = m.modulate ? m.valueL1To : m.valueL1
        const l2From = m.modulate ? m.valueL2From : m.valueL2
        const l2To = m.modulate ? m.valueL2To : m.valueL2
        const l3From = m.modulate ? m.valueL3From : m.valueL3
        const l3To = m.modulate ? m.valueL3To : m.valueL3
        powerRanges = [
          { commodity_quantity: 'ELECTRIC.POWER.L1', start_of_range: l1From, end_of_range: l1To },
          { commodity_quantity: 'ELECTRIC.POWER.L2', start_of_range: l2From, end_of_range: l2To },
          { commodity_quantity: 'ELECTRIC.POWER.L3', start_of_range: l3From, end_of_range: l3To }
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
    const timers = []
    const modesWithTimerId = modes.map(function (m) {
      const minDurationMs = (Number(m.minDurationMinutes) || 0) * 60000 + (Number(m.minDurationSeconds) || 0) * 1000
      let timerId = null
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

  // A range's start_of_range/end_of_range may differ (a genuine, modulating power range) - only
  // the structural shape (1 symmetric range, or 3 per-phase ranges covering exactly L1/L2/L3) is
  // required, not that both bounds are equal.
  function isFriendlyPowerRanges (ranges) {
    if (!Array.isArray(ranges)) return false
    if (ranges.length === 1) {
      const r = ranges[0]
      return !!r && r.commodity_quantity === 'ELECTRIC.POWER.3_PHASE_SYMMETRIC' &&
        typeof r.start_of_range === 'number' && typeof r.end_of_range === 'number'
    }
    if (ranges.length === 3) {
      const byCq = {}
      for (let i = 0; i < ranges.length; i++) {
        const rr = ranges[i]
        if (!rr || typeof rr.start_of_range !== 'number' || typeof rr.end_of_range !== 'number') return false
        byCq[rr.commodity_quantity] = true
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
    const modes = sysDesc.operationModes
    if (!Array.isArray(modes) || modes.length === 0) return false

    const modeIds = []
    for (let i = 0; i < modes.length; i++) {
      const m = modes[i]
      if (!m || typeof m.id !== 'string' || !m.id || modeIds.indexOf(m.id) !== -1) return false
      if (!isFriendlyPowerRanges(m.power_ranges)) return false
      modeIds.push(m.id)
    }

    const transitions = sysDesc.transitions
    if (!Array.isArray(transitions) || transitions.length !== modeIds.length * (modeIds.length - 1)) return false

    // Per mode: the single timer id (if any) that every transition into it
    // shares in start_timers, and that every transition out of it shares in
    // blocking_timers - populated as transitions are walked below.
    const inboundTimerId = {}
    const outboundTimerId = {}
    const seenPairs = {}
    for (let j = 0; j < transitions.length; j++) {
      const t = transitions[j]
      if (!t || modeIds.indexOf(t.from) === -1 || modeIds.indexOf(t.to) === -1 || t.from === t.to) return false
      if (!isSingleOrEmptyTimerRef(t.start_timers) || !isSingleOrEmptyTimerRef(t.blocking_timers)) return false
      if (t.abnormal_condition_only) return false
      const key = t.from + '>' + t.to
      if (seenPairs[key]) return false
      seenPairs[key] = true

      const startId = t.start_timers.length ? t.start_timers[0] : null
      if (!consistentTimerRef(inboundTimerId, t.to, startId)) return false
      const blockId = t.blocking_timers.length ? t.blocking_timers[0] : null
      if (!consistentTimerRef(outboundTimerId, t.from, blockId)) return false
    }
    for (let a = 0; a < modeIds.length; a++) {
      for (let b = 0; b < modeIds.length; b++) {
        if (a === b) continue
        if (!seenPairs[modeIds[a] + '>' + modeIds[b]]) return false
      }
    }

    // A mode's minimum-duration timer must be wired symmetrically: the same
    // id started on every transition in and blocked on every transition out.
    const timerIdByMode = {}
    for (let c = 0; c < modeIds.length; c++) {
      const modeId = modeIds[c]
      const inb = inboundTimerId[modeId] || null
      const outb = outboundTimerId[modeId] || null
      if (inb !== outb) return false
      if (inb) timerIdByMode[modeId] = inb
    }

    const timers = sysDesc.timers
    if (!Array.isArray(timers)) return false
    const expectedTimerIds = {}
    for (const modeKey in timerIdByMode) expectedTimerIds[timerIdByMode[modeKey]] = true
    const expectedCount = Object.keys(expectedTimerIds).length
    if (timers.length !== expectedCount) return false

    const seenTimerIds = {}
    for (let k = 0; k < timers.length; k++) {
      const timer = timers[k]
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
    const durationById = {}
    ;(sysDesc.timers || []).forEach(function (timer) { durationById[timer.id] = timer.duration })
    const result = {}
    ;(sysDesc.transitions || []).forEach(function (t) {
      if (t.start_timers && t.start_timers.length) {
        result[t.to] = durationById[t.start_timers[0]]
      }
    })
    return result
  }

  // Only called after isFriendlyRepresentable has passed.
  function systemDescriptionToFriendlyState (sysDesc) {
    const durationByMode = modeTimerDurations(sysDesc)
    return sysDesc.operationModes.map(function (m) {
      const duration = durationByMode[m.id] || 0
      const minDurationMinutes = Math.floor(duration / 60000)
      const minDurationSeconds = Math.floor((duration % 60000) / 1000)
      const ranges = m.power_ranges
      if (ranges.length === 1) {
        const symModulate = ranges[0].start_of_range !== ranges[0].end_of_range
        return {
          id: m.id,
          protected: false,
          label: m.diagnostic_label || '',
          symmetric: true,
          modulate: symModulate,
          valueSymmetric: ranges[0].start_of_range,
          valueSymmetricFrom: ranges[0].start_of_range,
          valueSymmetricTo: ranges[0].end_of_range,
          valueL1: 0,
          valueL2: 0,
          valueL3: 0,
          valueL1From: 0,
          valueL1To: 0,
          valueL2From: 0,
          valueL2To: 0,
          valueL3From: 0,
          valueL3To: 0,
          minDurationMinutes: minDurationMinutes,
          minDurationSeconds: minDurationSeconds
        }
      }
      const byCqFrom = {}
      const byCqTo = {}
      ranges.forEach(function (r) { byCqFrom[r.commodity_quantity] = r.start_of_range; byCqTo[r.commodity_quantity] = r.end_of_range })
      const phaseModulate = ranges.some(function (r) { return r.start_of_range !== r.end_of_range })
      return {
        id: m.id,
        protected: false,
        label: m.diagnostic_label || '',
        symmetric: false,
        modulate: phaseModulate,
        valueSymmetric: 0,
        valueSymmetricFrom: 0,
        valueSymmetricTo: 0,
        valueL1: byCqFrom['ELECTRIC.POWER.L1'],
        valueL2: byCqFrom['ELECTRIC.POWER.L2'],
        valueL3: byCqFrom['ELECTRIC.POWER.L3'],
        valueL1From: byCqFrom['ELECTRIC.POWER.L1'],
        valueL1To: byCqTo['ELECTRIC.POWER.L1'],
        valueL2From: byCqFrom['ELECTRIC.POWER.L2'],
        valueL2To: byCqTo['ELECTRIC.POWER.L2'],
        valueL3From: byCqFrom['ELECTRIC.POWER.L3'],
        valueL3To: byCqTo['ELECTRIC.POWER.L3'],
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
      modulate: false,
      valueSymmetric: 0,
      valueSymmetricFrom: 0,
      valueSymmetricTo: 0,
      valueL1: 0,
      valueL2: 0,
      valueL3: 0,
      valueL1From: 0,
      valueL1To: 0,
      valueL2From: 0,
      valueL2To: 0,
      valueL3From: 0,
      valueL3To: 0
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

    const row1 = $('<div/>', { class: 's2-ombc-mode-row' }).appendTo(container)
    $('<input/>', { type: 'text', class: 's2-ombc-mode-label', placeholder: 'Mode label' })
      .val(opt.label || '')
      .appendTo(row1)

    const row2 = $('<div/>', { class: 's2-ombc-mode-row' }).appendTo(container)
    const symLabel = $('<label/>', { class: 's2-ombc-mode-checkbox-label' }).appendTo(row2)
    const symCheckbox = $('<input/>', { type: 'checkbox', class: 's2-ombc-mode-symmetric' })
      .prop('checked', opt.symmetric !== false)
      .appendTo(symLabel)
    symLabel.append(' Same value on all phases')

    const row2b = $('<div/>', { class: 's2-ombc-mode-row' }).appendTo(container)
    const modulateLabel = $('<label/>', { class: 's2-ombc-mode-checkbox-label' }).appendTo(row2b)
    const modulateCheckbox = $('<input/>', { type: 'checkbox', class: 's2-ombc-mode-modulate' })
      .prop('checked', !!opt.modulate)
      .appendTo(modulateLabel)
    modulateLabel.append(' Support power modulation (a range instead of a fixed value)')

    const row3 = $('<div/>', { class: 's2-ombc-mode-row' }).appendTo(container)
    const symWrap = $('<span/>', { class: 's2-ombc-mode-value-wrap' }).appendTo(row3)
    const symValue = $('<input/>', { type: 'number', class: 's2-ombc-mode-value-sym', step: '1' })
      .val(opt.valueSymmetric != null ? opt.valueSymmetric : 0)
      .appendTo(symWrap)
    symWrap.append($('<span/>', { class: 's2-unit-label' }).text('W'))

    const symModWrap = $('<span/>', { class: 's2-ombc-mode-value-wrap' }).appendTo(row3)
    symModWrap.append('From ')
    const symFrom = $('<input/>', { type: 'number', class: 's2-ombc-mode-value-sym-from', step: '1' })
      .val(opt.valueSymmetricFrom != null ? opt.valueSymmetricFrom : 0)
      .appendTo(symModWrap)
    symModWrap.append(' to ')
    const symTo = $('<input/>', { type: 'number', class: 's2-ombc-mode-value-sym-to', step: '1' })
      .val(opt.valueSymmetricTo != null ? opt.valueSymmetricTo : 0)
      .appendTo(symModWrap)
    symModWrap.append($('<span/>', { class: 's2-unit-label' }).text('W'))

    const phaseWrap = $('<span/>', { class: 's2-ombc-mode-value-wrap' }).appendTo(row3)
    // Each phase's label+input is wrapped in its own group so setActivePhase() can dim/disable
    // whichever ones don't apply (e.g. a single-phase D-Bus device wired to just L2) as a unit.
    const l1Group = $('<span/>', { class: 's2-ombc-mode-phase-group s2-ombc-mode-phase-l1' }).appendTo(phaseWrap)
    l1Group.append('L1 ')
    const l1 = $('<input/>', { type: 'number', class: 's2-ombc-mode-value-l1', step: '1' }).val(opt.valueL1 || 0).appendTo(l1Group)
    const l2Group = $('<span/>', { class: 's2-ombc-mode-phase-group s2-ombc-mode-phase-l2' }).appendTo(phaseWrap)
    l2Group.append(' L2 ')
    const l2 = $('<input/>', { type: 'number', class: 's2-ombc-mode-value-l2', step: '1' }).val(opt.valueL2 || 0).appendTo(l2Group)
    const l3Group = $('<span/>', { class: 's2-ombc-mode-phase-group s2-ombc-mode-phase-l3' }).appendTo(phaseWrap)
    l3Group.append(' L3 ')
    const l3 = $('<input/>', { type: 'number', class: 's2-ombc-mode-value-l3', step: '1' }).val(opt.valueL3 || 0).appendTo(l3Group)
    phaseWrap.append($('<span/>', { class: 's2-unit-label' }).text('W'))

    const phaseModWrap = $('<span/>', { class: 's2-ombc-mode-value-wrap' }).appendTo(row3)
    const l1ModGroup = $('<span/>', { class: 's2-ombc-mode-phase-group s2-ombc-mode-phase-l1' }).appendTo(phaseModWrap)
    l1ModGroup.append('L1 ')
    const l1From = $('<input/>', { type: 'number', class: 's2-ombc-mode-value-l1-from', step: '1' }).val(opt.valueL1From || 0).appendTo(l1ModGroup)
    l1ModGroup.append('–')
    const l1To = $('<input/>', { type: 'number', class: 's2-ombc-mode-value-l1-to', step: '1' }).val(opt.valueL1To || 0).appendTo(l1ModGroup)
    const l2ModGroup = $('<span/>', { class: 's2-ombc-mode-phase-group s2-ombc-mode-phase-l2' }).appendTo(phaseModWrap)
    l2ModGroup.append(' L2 ')
    const l2From = $('<input/>', { type: 'number', class: 's2-ombc-mode-value-l2-from', step: '1' }).val(opt.valueL2From || 0).appendTo(l2ModGroup)
    l2ModGroup.append('–')
    const l2To = $('<input/>', { type: 'number', class: 's2-ombc-mode-value-l2-to', step: '1' }).val(opt.valueL2To || 0).appendTo(l2ModGroup)
    const l3ModGroup = $('<span/>', { class: 's2-ombc-mode-phase-group s2-ombc-mode-phase-l3' }).appendTo(phaseModWrap)
    l3ModGroup.append(' L3 ')
    const l3From = $('<input/>', { type: 'number', class: 's2-ombc-mode-value-l3-from', step: '1' }).val(opt.valueL3From || 0).appendTo(l3ModGroup)
    l3ModGroup.append('–')
    const l3To = $('<input/>', { type: 'number', class: 's2-ombc-mode-value-l3-to', step: '1' }).val(opt.valueL3To || 0).appendTo(l3ModGroup)
    phaseModWrap.append($('<span/>', { class: 's2-unit-label' }).text('W'))

    function updateValueVisibility () {
      const isSymmetric = symCheckbox.prop('checked')
      const isModulating = modulateCheckbox.prop('checked')
      symWrap.toggle(isSymmetric && !isModulating)
      symModWrap.toggle(isSymmetric && isModulating)
      phaseWrap.toggle(!isSymmetric && !isModulating)
      phaseModWrap.toggle(!isSymmetric && isModulating)
    }
    symCheckbox.on('change', updateValueVisibility)
    modulateCheckbox.on('change', updateValueVisibility)
    updateValueVisibility()

    const row4 = $('<div/>', { class: 's2-ombc-mode-row' }).appendTo(container)
    row4.append('Minimum time in this mode: ')
    const minDurWrap = $('<span/>', { class: 's2-ombc-mode-value-wrap' }).appendTo(row4)
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
    const modes = []
    $(listSel).editableList('items').each(function () {
      const $item = $(this)
      const data = $item.data('data') || {}
      modes.push({
        id: data.id,
        protected: !!data.protected,
        label: $item.find('.s2-ombc-mode-label').val(),
        symmetric: $item.find('.s2-ombc-mode-symmetric').prop('checked'),
        modulate: $item.find('.s2-ombc-mode-modulate').prop('checked'),
        valueSymmetric: Number($item.find('.s2-ombc-mode-value-sym').val()) || 0,
        valueSymmetricFrom: Number($item.find('.s2-ombc-mode-value-sym-from').val()) || 0,
        valueSymmetricTo: Number($item.find('.s2-ombc-mode-value-sym-to').val()) || 0,
        valueL1: Number($item.find('.s2-ombc-mode-value-l1').val()) || 0,
        valueL2: Number($item.find('.s2-ombc-mode-value-l2').val()) || 0,
        valueL3: Number($item.find('.s2-ombc-mode-value-l3').val()) || 0,
        valueL1From: Number($item.find('.s2-ombc-mode-value-l1-from').val()) || 0,
        valueL1To: Number($item.find('.s2-ombc-mode-value-l1-to').val()) || 0,
        valueL2From: Number($item.find('.s2-ombc-mode-value-l2-from').val()) || 0,
        valueL2To: Number($item.find('.s2-ombc-mode-value-l2-to').val()) || 0,
        valueL3From: Number($item.find('.s2-ombc-mode-value-l3-from').val()) || 0,
        valueL3To: Number($item.find('.s2-ombc-mode-value-l3-to').val()) || 0,
        minDurationMinutes: Number($item.find('.s2-ombc-mode-min-duration-minutes').val()) || 0,
        minDurationSeconds: Number($item.find('.s2-ombc-mode-min-duration-seconds').val()) || 0
      })
    })
    return modes
  }

  // Hides and disables the per-phase L1/L2/L3 label+input group(s) that don't match
  // activePhase (1, 2, or 3) across every mode row in the given editableList - for a
  // single-phase device wired to one specific line, the other two phases' fields are never
  // actually used. Pass null/undefined for activePhase to re-show all phases (e.g. when
  // the device reports more than one phase, or no such constraint applies). Hidden rather
  // than just dimmed - with power modulation's from/to pair per phase, three dimmed-but-still-
  // shown groups made the row too wide to read.
  function setActivePhase (listSel, activePhase) {
    $(listSel).find('.s2-ombc-mode-phase-group').each(function () {
      const $group = $(this)
      const isActive = activePhase == null || $group.hasClass('s2-ombc-mode-phase-l' + activePhase)
      $group.toggle(isActive)
      $group.find('input').prop('disabled', !isActive)
    })
  }

  // Hides (not just disables) "Same value on all phases" when forced non-null; forced/null is computed by refreshActivePhase() in s2-resource/index.html.
  function setSymmetricLock (listSel, forced) {
    $(listSel).find('.s2-ombc-mode-symmetric').each(function () {
      const $checkbox = $(this)
      const isForced = forced !== null
      $checkbox.prop('disabled', isForced)
      if (isForced && $checkbox.prop('checked') !== forced) {
        $checkbox.prop('checked', forced).trigger('change')
      }
      $checkbox.closest('.s2-ombc-mode-row').toggle(!isForced)
    })
  }

  // Validates raw Advanced-mode systemDescription JSON against the real OMBC.SystemDescription
  // S2 schema, server-side (the generated validator is a Node.js module and can't run in the
  // browser without a bundler - see src/nodes/s2-ombc-config/index.ts, which registers this
  // endpoint). callback receives { valid, errors? } - always calls back valid:true on a transport
  // failure (offline, server restarting) so a save is never blocked by an unrelated network issue.
  function validateSystemDescription (rawJson, callback) {
    $.ajax({
      url: (RED.settings.apiRootUrl || '') + 's2/validate-system-description',
      type: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ systemDescription: rawJson })
    }).done(function (result) {
      callback(result)
    }).fail(function () {
      callback({ valid: true })
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
    setActivePhase: setActivePhase,
    setSymmetricLock: setSymmetricLock,
    validateSystemDescription: validateSystemDescription
  }
})()
