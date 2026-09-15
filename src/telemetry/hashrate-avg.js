'use strict'

const withDevice = require('../with-device')
const { toThs } = require('../../lib/constants')

module.exports = withDevice(async (device) =>
  toThs((await device.fetchDeviceData(device.getSummary)).hashrate_avg_ghs))
