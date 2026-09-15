'use strict'

const commandResult = require('./command-result')
const withDevice = require('../with-device')
const normalizeNetworkConfig = require('../../lib/utils/network')

module.exports = withDevice(async (device, params) => {
  normalizeNetworkConfig(params?.network)
  return commandResult(await device.setNetworkInformation(params.network))
})
