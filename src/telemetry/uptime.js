'use strict'

const withDevice = require('../with-device')

module.exports = withDevice(async (device) =>
  (await device.fetchDeviceData(device.getSummary)).elapsed || 0)
