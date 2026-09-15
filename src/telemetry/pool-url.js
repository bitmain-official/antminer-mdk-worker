'use strict'

const withDevice = require('../with-device')

module.exports = withDevice(async (device) => {
  const pools = await device.fetchDeviceData(device.getPools)
  const active = pools.find((pool) => pool.status === 'alive') || pools[0]
  return active?.url || ''
})
