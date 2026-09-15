'use strict'

const commandResult = require('./command-result')
const withDevice = require('../with-device')
const { POWER_MODE } = require('../../lib/constants')

module.exports = withDevice(async (device, params) => {
  if (!Object.values(POWER_MODE).includes(params.mode)) {
    throw new Error('ERR_SET_POWER_MODE_INVALID')
  }
  const result = commandResult(await device.setPowerMode(params.mode))
  return { ...result, mode: params.mode }
})
