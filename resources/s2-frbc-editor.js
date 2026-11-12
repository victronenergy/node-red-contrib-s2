/* global $, RED */

// Editor helpers for s2-frbc-config: the example configuration a new node starts with, and the
// save-time validation call (served by s2-frbc-config/index.ts - the generated schema validators
// can't run in the browser).

window.__s2FrbcEditor = window.__s2FrbcEditor || (function () {
  // A heat pump heating a buffer tank, fill level in % of the tank's usable heat. Fill rates and
  // leakage are in fill-level units (%) per second, as S2 defines them. Minimum on/off timers keep
  // the CEM from cycling the compressor faster than every 5 minutes. All ids are UUIDs: the S2
  // schema allows any 2-64 character id, but CEMs built on s2python or the s2energy Rust crate
  // (e.g. the Rust EMS) reject anything else - diagnostic_label carries the readable name.
  const EXAMPLE_SYSTEM_DESCRIPTION = {
    actuators: [{
      id: '5f0c3a62-8d1e-4b7a-9c35-2e6f1a7b8c90',
      diagnostic_label: 'Heat pump',
      supported_commodities: ['ELECTRICITY'],
      operation_modes: [{
        id: 'a3d2e1f0-6b5c-4d7e-8f91-0a1b2c3d4e5f',
        diagnostic_label: 'Off',
        abnormal_condition_only: false,
        elements: [{
          fill_level_range: { start_of_range: 0, end_of_range: 100 },
          fill_rate: { start_of_range: 0, end_of_range: 0 },
          power_ranges: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', start_of_range: 0, end_of_range: 0 }]
        }]
      }, {
        id: 'b4e3f2a1-7c6d-4e8f-9a02-1b2c3d4e5f60',
        diagnostic_label: 'Heating',
        abnormal_condition_only: false,
        elements: [{
          fill_level_range: { start_of_range: 0, end_of_range: 100 },
          fill_rate: { start_of_range: 0.001, end_of_range: 0.005 },
          power_ranges: [{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', start_of_range: 500, end_of_range: 2000 }]
        }]
      }],
      transitions: [
        { id: 'c5f4a3b2-8d7e-4f90-ab13-2c3d4e5f6071', from: 'a3d2e1f0-6b5c-4d7e-8f91-0a1b2c3d4e5f', to: 'b4e3f2a1-7c6d-4e8f-9a02-1b2c3d4e5f60', start_timers: ['e7b6c5d4-af90-4b12-8d35-4e5f60718293'], blocking_timers: ['f8c7d6e5-b0a1-4c23-9e46-5f60718293a4'], abnormal_condition_only: false },
        { id: 'd6a5b4c3-9e8f-4a01-bc24-3d4e5f607182', from: 'b4e3f2a1-7c6d-4e8f-9a02-1b2c3d4e5f60', to: 'a3d2e1f0-6b5c-4d7e-8f91-0a1b2c3d4e5f', start_timers: ['f8c7d6e5-b0a1-4c23-9e46-5f60718293a4'], blocking_timers: ['e7b6c5d4-af90-4b12-8d35-4e5f60718293'], abnormal_condition_only: false }
      ],
      timers: [
        { id: 'e7b6c5d4-af90-4b12-8d35-4e5f60718293', diagnostic_label: 'Minimum on time', duration: 300000 },
        { id: 'f8c7d6e5-b0a1-4c23-9e46-5f60718293a4', diagnostic_label: 'Minimum off time', duration: 300000 }
      ]
    }],
    storage: {
      diagnostic_label: 'Buffer tank',
      fill_level_label: '%',
      provides_leakage_behaviour: true,
      provides_fill_level_target_profile: false,
      provides_usage_forecast: false,
      fill_level_range: { start_of_range: 0, end_of_range: 100 }
    }
  }

  const EXAMPLE_LEAKAGE_BEHAVIOUR = {
    elements: [{ fill_level_range: { start_of_range: 0, end_of_range: 100 }, leakage_rate: 0.002 }]
  }

  function exampleSystemDescription () {
    return JSON.stringify(EXAMPLE_SYSTEM_DESCRIPTION, null, 2)
  }

  function exampleLeakageBehaviour () {
    return JSON.stringify(EXAMPLE_LEAKAGE_BEHAVIOUR, null, 2)
  }

  function validateConfig (systemDescription, leakageBehaviour, callback) {
    $.ajax({
      url: (RED.settings.apiRootUrl || '') + 's2/validate-frbc-config',
      type: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ systemDescription: systemDescription, leakageBehaviour: leakageBehaviour })
    }).done(function (result) {
      callback(result)
    }).fail(function () {
      // Don't lock the user out of saving when the endpoint is unreachable; the runtime still
      // refuses an invalid configuration at deploy time.
      callback({ valid: true })
    })
  }

  return {
    exampleSystemDescription: exampleSystemDescription,
    exampleLeakageBehaviour: exampleLeakageBehaviour,
    validateConfig: validateConfig
  }
})()
