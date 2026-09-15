'use strict'

const withDevice = require('../with-device')

module.exports = withDevice(async (device) => {
  const pools = await device.fetchDeviceData(device.getPools)
  return pools.reduce((total, pool) => total + (Number(pool.accepted) || 0), 0)
})
