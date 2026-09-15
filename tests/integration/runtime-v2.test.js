'use strict'

const path = require('node:path')
const test = require('brittle')
const { createServer } = require('../../mock/cgi-server')

const MDK_REPO = process.env.MDK_REPO
  ? path.resolve(process.env.MDK_REPO)
  : path.resolve(__dirname, '../../../mdk')
const WorkerRuntimeV2 = require(path.join(MDK_REPO, 'backend/core/mdk-worker/lib/worker-runtime-v2'))
const { build } = require(path.join(MDK_REPO, 'backend/core/kernel/lib/protocol/envelope'))
const { ACTIONS, MESSAGE_TYPES } = require(path.join(MDK_REPO, 'backend/core/kernel/lib/protocol/actions'))

const WORKER_DIR = path.resolve(__dirname, '../..')

const request = (action, deviceId, payload = {}) => build({
  action,
  type: MESSAGE_TYPES.REQUEST,
  sender: 'runtime-v2-test',
  target: 'antminer-test',
  deviceId,
  payload
})

test('WorkerRuntimeV2 loads the package and serves an Antminer miner', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  const runtime = new WorkerRuntimeV2(WORKER_DIR, {
    workerId: 'antminer-test',
    devices: [{
      deviceId: 'ant-0',
      config: { address: '127.0.0.1', port: address.port, username: 'root', password: 'secret', type: 'miner-am-s21' }
    }]
  })

  t.teardown(async () => {
    await runtime.stop()
    await mock.close()
  })
  await runtime.start()

  const identity = await runtime.handleRequest(request(ACTIONS.IDENTITY_REQUEST, null))
  t.is(identity.payload.workerId, 'antminer-test')
  t.is(identity.payload.devices[0].deviceId, 'ant-0')

  const capability = await runtime.handleRequest(request(ACTIONS.CAPABILITY_REQUEST, null))
  t.is(capability.payload.contract.metadata.provider, 'bitmain')
  t.is(capability.payload.contract.capabilities.telemetry.length, 22)
  t.is(capability.payload.contract.capabilities.commands.length, 9)
  for (const entry of capability.payload.contract.capabilities.telemetry) {
    t.is(entry.handler, undefined, 'handler paths are stripped from the published contract')
  }

  const single = await runtime.handleRequest(request(ACTIONS.TELEMETRY_PULL, 'ant-0', {
    query: { type: 'hashrate_rt' }
  }))
  t.is(single.payload.name, 'hashrate_rt')
  t.is(single.payload.value, 198.45)

  const metrics = await runtime.handleRequest(request(ACTIONS.TELEMETRY_PULL, 'ant-0', {
    query: { type: 'metrics' }
  }))
  t.is(metrics.payload.metrics.status, 'mining')
  t.is(metrics.payload.metrics.hashboards.length, 3)
  t.is(metrics.payload.metrics.pools[0].url, 'stratum+tcp://pool.example:3333')
  t.is(metrics.payload.metrics.fans.length, 4)
  t.is(metrics.payload.metrics.power, 3420)
  t.is(metrics.payload.metrics.temperature, 97)

  const snap = await runtime.handleRequest(request(ACTIONS.TELEMETRY_PULL, 'ant-0', {
    query: { type: 'snap' }
  }))
  t.is(snap.payload.value.stats.nominal_efficiency_w_th, 17.5, 'type tag resolves rated J/TH from the default table')

  const led = await runtime.handleRequest(request(ACTIONS.COMMAND_REQUEST, 'ant-0', {
    commandId: 'cmd-1',
    command: 'setLED',
    params: { enabled: true }
  }))
  t.is(led.payload.status, 'SUCCESS')
  t.is(mock.state.blink, true)

  const invalid = await runtime.handleRequest(request(ACTIONS.COMMAND_REQUEST, 'ant-0', {
    commandId: 'cmd-2',
    command: 'setLED',
    params: { enabled: 'yes' }
  }))
  t.is(invalid.payload.status, 'FAILED')
  t.ok(/ERR_SET_LED_ENABLED_INVALID/.test(invalid.payload.error))
})

test('WorkerRuntimeV2 isolates errors per telemetry channel', async (t) => {
  const mock = createServer({
    password: 'secret',
    state: { warnings: [{ code: 'P:1', cause: 'high temp protection', suggestion: 'check fans', timestamp: '20260915100000' }] }
  })
  const address = await mock.ready
  const runtime = new WorkerRuntimeV2(WORKER_DIR, {
    workerId: 'antminer-test',
    devices: [{
      deviceId: 'ant-warn',
      config: { address: '127.0.0.1', port: address.port, username: 'root', password: 'secret' }
    }]
  })

  t.teardown(async () => {
    await runtime.stop()
    await mock.close()
  })
  await runtime.start()

  const metrics = await runtime.handleRequest(request(ACTIONS.TELEMETRY_PULL, 'ant-warn', {
    query: { type: 'metrics' }
  }))
  t.is(metrics.payload.metrics.status, 'error')
  t.is(metrics.payload.metrics.errors.length, 1)
  t.is(metrics.payload.metrics.hashrate_rt, 198.45, 'other channels still report')
})

test('WorkerRuntimeV2 reports unknown devices and commands', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  const runtime = new WorkerRuntimeV2(WORKER_DIR, {
    workerId: 'antminer-test',
    devices: [{
      deviceId: 'ant-0',
      config: { address: '127.0.0.1', port: address.port, username: 'root', password: 'secret' }
    }]
  })

  t.teardown(async () => {
    await runtime.stop()
    await mock.close()
  })
  await runtime.start()

  const unknownDevice = await runtime.handleRequest(request(ACTIONS.TELEMETRY_PULL, 'nope', {
    query: { type: 'metrics' }
  }))
  t.ok(/ERR_DEVICE_NOT_FOUND/.test(unknownDevice.payload.error))

  const unknownCommand = await runtime.handleRequest(request(ACTIONS.COMMAND_REQUEST, 'ant-0', {
    commandId: 'cmd-3',
    command: 'setFanSpeed',
    params: {}
  }))
  t.is(unknownCommand.payload.status, 'FAILED')
  t.ok(/ERR_UNKNOWN_COMMAND/.test(unknownCommand.payload.error))
})
