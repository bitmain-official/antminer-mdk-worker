'use strict'

const path = require('node:path')

const address = process.argv[2]
const port = process.argv[3] ? Number(process.argv[3]) : undefined
const username = process.env.ANTMINER_USERNAME || 'root'
const password = process.env.ANTMINER_PASSWORD
const mdkRepo = path.resolve(process.env.MDK_REPO || path.resolve(__dirname, '../../mdk'))

if (!address || !password || (port !== undefined && !Number.isInteger(port))) {
  console.error('usage: ANTMINER_PASSWORD=... node scripts/test-live-readonly.js <address> [port]')
  process.exit(1)
}

const WorkerRuntimeV2 = require(path.join(mdkRepo, 'backend/core/mdk-worker/lib/worker-runtime-v2'))
const workerDir = path.resolve(__dirname, '..')
const deviceId = `antminer-${address.replaceAll('.', '-')}`

const envelope = (type) => ({
  id: `readonly-${type}`,
  version: '0.2.0',
  type: 'request',
  action: 'telemetry.pull',
  sender: 'antminer-live-readonly',
  target: 'antminer-live-readonly',
  deviceId,
  timestamp: Date.now(),
  payload: { query: { type } }
})

const main = async () => {
  const config = { address, username, password }
  if (port !== undefined) config.port = port
  if (process.env.ANTMINER_TYPE) config.type = process.env.ANTMINER_TYPE
  const runtime = new WorkerRuntimeV2(workerDir, {
    workerId: 'antminer-live-readonly',
    devices: [{ deviceId, config }]
  })

  try {
    await runtime.start()
    const response = await runtime.handleRequest(envelope('metrics'))
    const metrics = response.payload.metrics
    const failed = Object.entries(metrics).filter(([, value]) => value && typeof value === 'object' && value.error)
    if (failed.length > 0) {
      throw new Error(`ERR_READONLY_CHANNELS_FAILED: ${failed.map(([name, value]) => `${name}=${value.error}`).join(', ')}`)
    }
    const snapResponse = await runtime.handleRequest(envelope('snap'))
    const snap = snapResponse.payload.value
    if (!snap.success) {
      throw new Error('ERR_READONLY_SNAP_FAILED')
    }
    console.log(JSON.stringify({
      address,
      requestedPort: port || 80,
      type: config.type,
      firmware: metrics.firmware_info,
      model: metrics.device_info?.model,
      serial: metrics.device_info?.serial_number,
      hashrateRtTHs: metrics.hashrate_rt,
      hashrateAvgTHs: metrics.hashrate_avg,
      hashrateIdealTHs: metrics.hashrate_ideal,
      powerW: metrics.power,
      efficiencyWTh: metrics.efficiency,
      nominalEfficiencyWTh: snap.stats.nominal_efficiency_w_th,
      temperatureC: metrics.temperature,
      ambientTempC: metrics.ambient_temp,
      fans: metrics.fans,
      safeMode: metrics.safe_mode,
      powerMode: metrics.power_mode,
      uptimeS: metrics.uptime,
      hashboards: metrics.hashboards.length,
      pools: metrics.pools.map((pool) => ({ url: pool.url, status: pool.status })),
      errors: metrics.errors
    }, null, 2))
  } finally {
    await runtime.stop()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
