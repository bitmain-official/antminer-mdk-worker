'use strict'

const withDevice = require('../with-device')

module.exports = withDevice(async (device) => {
  const [summary, stats] = await Promise.all([
    device.fetchDeviceData(device.getSummary),
    device.fetchDeviceData(device.getStats)
  ])
  return { summary, stats }
})
