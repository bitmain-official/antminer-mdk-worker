'use strict'

const withDevice = require('../with-device')
const { computeStatus } = require('../../lib/antminer-api-client')

module.exports = withDevice(async (device) => {
  const [warnings, summary, stats] = await Promise.all([
    device.fetchDeviceData(device.getWarnings),
    device.fetchDeviceData(device.getSummary),
    device.fetchDeviceData(device.getStats)
  ])
  return computeStatus({ warnings, summary, stats })
})
