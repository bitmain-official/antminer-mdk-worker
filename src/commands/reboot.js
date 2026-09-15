'use strict'

const withDevice = require('../with-device')
const { id } = require('@tetherto/mdk-worker/device')
const { DEFAULTS } = require('../../lib/constants')

const COOLDOWN_MS = DEFAULTS.REBOOT_COOLDOWN_MS

// Module-level, not keyed by device: WorkerRuntimeV2 loads this file into a
// private registry per device, so this state is already scoped to the one
// device this instance was built for.
let lastAttemptAt = 0
let running = false

function audit (outcome, errorCode) {
  console.info(
    JSON.stringify({
      event: 'physical_command',
      command: 'reboot',
      deviceId: id,
      outcome,
      ...(errorCode ? { errorCode } : {})
    })
  )
}

module.exports = withDevice(async (device) => {
  const now = Date.now()

  if (running) {
    audit('rejected', 'ERR_COMMAND_IN_PROGRESS')
    throw new Error('ERR_COMMAND_IN_PROGRESS: reboot')
  }

  const remaining = COOLDOWN_MS - (now - lastAttemptAt)
  if (remaining > 0) {
    audit('rejected', 'ERR_COMMAND_COOLDOWN')
    throw new Error(`ERR_COMMAND_COOLDOWN: reboot ${remaining}ms`)
  }

  // Record the attempt before device I/O: a timed-out reboot still consumes
  // the cooldown because the device may have accepted the command.
  lastAttemptAt = now
  running = true
  audit('started')
  try {
    const result = await device.reboot()
    audit('succeeded')
    return result
  } catch (err) {
    audit('failed', /ERR_[A-Z0-9_]+/.exec(err?.message)?.[0] || 'ERR_HTTP_CONNECTION')
    throw err
  } finally {
    running = false
  }
})
