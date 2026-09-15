'use strict'

const commandResult = require('./command-result')
const withDevice = require('../with-device')

module.exports = withDevice(async (device, params) => {
  if (typeof params?.enabled !== 'boolean') {
    throw new Error('ERR_SET_USER_IP_SUFFIX_INVALID')
  }
  const result = commandResult(await device.setUserIpSuffix(params.enabled))
  return { ...result, enabled: params.enabled }
})
