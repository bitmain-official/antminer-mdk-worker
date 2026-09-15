'use strict'

const commandResult = require('./command-result')
const withDevice = require('../with-device')
const { id } = require('@tetherto/mdk-worker/device')

let running = false

function audit (outcome, errorCode) {
  console.info(
    JSON.stringify({
      event: 'physical_command',
      command: 'downloadLogs',
      deviceId: id,
      outcome,
      ...(errorCode ? { errorCode } : {})
    })
  )
}

module.exports = withDevice(async (device, params) => {
  if (running) {
    audit('rejected', 'ERR_COMMAND_IN_PROGRESS')
    throw new Error('ERR_COMMAND_IN_PROGRESS: downloadLogs')
  }
  if (params?.dates !== undefined &&
      (!Array.isArray(params.dates) || !params.dates.every((d) => typeof d === 'string'))) {
    throw new Error('ERR_LOG_DATES_INVALID')
  }

  running = true
  audit('started')
  try {
    const result = commandResult(await device.downloadLogs(params?.dates))
    audit('succeeded')
    return result
  } catch (err) {
    audit('failed', /ERR_[A-Z0-9_]+/.exec(err?.message)?.[0] || 'ERR_COMMAND_FAILED')
    throw err
  } finally {
    running = false
  }
})
