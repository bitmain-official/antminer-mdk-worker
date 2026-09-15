'use strict'

const { id, opts, logger } = require('@tetherto/mdk-worker/device')
const { AntminerApiClient } = require('../lib/antminer-api-client')
const { DEFAULTS } = require('../lib/constants')

let devicePromise

const deviceConfig = () => {
  const address = opts.address || opts.host
  if (!address) throw new Error('ERR_DEVICE_CONFIG_INVALID')
  const port = opts.port || DEFAULTS.PORT
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('ERR_DEVICE_CONFIG_INVALID')
  }
  const username = opts.username || DEFAULTS.USERNAME
  const password = opts.password || DEFAULTS.PASSWORD
  if (username === 'root' && password === 'root') {
    logger('device %s uses factory default credentials root/root; set username/password in the device config', id)
  }
  return {
    ...opts,
    address,
    port,
    username,
    password,
    id,
    conf: opts.conf || {}
  }
}

const connect = async () => {
  const config = deviceConfig()
  const device = new AntminerApiClient(config)
  const version = await device.fetchDeviceData(device.getVersion)
  logger('device %s connected: %s firmware %s', id, version.type, version.firmware)
  return device
}

const getDevice = () => {
  if (!devicePromise) {
    devicePromise = connect().catch((error) => {
      devicePromise = null
      throw error
    })
  }
  return devicePromise
}

module.exports = { getDevice }
