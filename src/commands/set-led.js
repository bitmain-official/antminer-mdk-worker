'use strict'

const commandResult = require('./command-result')
const withDevice = require('../with-device')

module.exports = withDevice(async (device, params) => {
  if (typeof params.enabled !== 'boolean') {
    throw new Error('ERR_SET_LED_ENABLED_INVALID')
  }
  return commandResult(await device.setLED(params.enabled))
})
