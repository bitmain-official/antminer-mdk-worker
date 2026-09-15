'use strict'

const commandResult = require('./command-result')
const withDevice = require('../with-device')

module.exports = withDevice(async (device, params) => {
  if (params.pools !== undefined && !Array.isArray(params.pools)) {
    throw new Error('ERR_INVALID_ARG_TYPE')
  }
  if (Array.isArray(params.pools)) {
    if (params.pools.length === 0 || params.pools.length > 3) {
      throw new Error('ERR_POOLS_INVALID')
    }
    const valid = params.pools.every((pool) =>
      pool && typeof pool === 'object' &&
      typeof pool.url === 'string' && pool.url &&
      typeof (pool.user || pool.worker_name) === 'string')
    if (!valid) throw new Error('ERR_POOLS_INVALID')
    return commandResult(await device.setPools(params.pools))
  }
  return commandResult(await device.setupPools())
})
