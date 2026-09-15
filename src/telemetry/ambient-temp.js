'use strict'

const withDevice = require('../with-device')
const { round2 } = require('../../lib/constants')

module.exports = withDevice(async (device) => {
  const ambient = (await device.fetchDeviceData(device.getStats)).ambient_temp_c
  // not every firmware reports an inlet sensor; null, not 0, means absent
  return ambient == null ? null : round2(ambient)
})
