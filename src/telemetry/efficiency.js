'use strict'

const withDevice = require('../with-device')
const { round2 } = require('../../lib/constants')

module.exports = withDevice(async (device) =>
  round2((await device.fetchDeviceData(device.getStats)).efficiency_w_th))
