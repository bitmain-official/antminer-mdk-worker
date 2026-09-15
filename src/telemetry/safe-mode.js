'use strict'

const withDevice = require('../with-device')

module.exports = withDevice(async (device) =>
  (await device.fetchDeviceData(device.getSummary)).safe_mode === true)
