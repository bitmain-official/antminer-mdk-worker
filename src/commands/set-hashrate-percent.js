'use strict'

const commandResult = require('./command-result')
const withDevice = require('../with-device')

module.exports = withDevice(async (device, params) => {
  if (typeof params.pct !== 'number' || !Number.isFinite(params.pct)) {
    throw new Error('ERR_INVALID_ARG_TYPE')
  }
  const result = commandResult(await device.setHashratePercent(params.pct))
  return { ...result, pct: params.pct }
})
