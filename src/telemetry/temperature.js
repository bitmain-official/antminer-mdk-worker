'use strict'

const withDevice = require('../with-device')

module.exports = withDevice(async (device) => {
  const stats = await device.fetchDeviceData(device.getStats)
  const chipTemps = stats.hashboards.flatMap((board) => board.temp_chip || [])
  return chipTemps.length ? Math.max(...chipTemps) : 0
})
