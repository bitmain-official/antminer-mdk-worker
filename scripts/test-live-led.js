'use strict'

const path = require('node:path')

const address = process.argv[2]
const port = process.argv[3] ? Number(process.argv[3]) : undefined
const username = process.env.ANTMINER_USERNAME || 'root'
const password = process.env.ANTMINER_PASSWORD
const mdkRepo = path.resolve(process.env.MDK_REPO || path.resolve(__dirname, '../../mdk'))

if (!address || !password || (port !== undefined && !Number.isInteger(port))) {
  console.error('usage: ANTMINER_PASSWORD=... node scripts/test-live-led.js <address> [port]')
  process.exit(1)
}

const WorkerRuntimeV2 = require(path.join(mdkRepo, 'backend/core/mdk-worker/lib/worker-runtime-v2'))
const workerDir = path.resolve(__dirname, '..')
const deviceId = `antminer-${address.replaceAll('.', '-')}`

const telemetry = (runtime, type) => runtime.handleRequest({
  id: `led-${type}-${Date.now()}`,
  version: '0.2.0',
  type: 'request',
  action: 'telemetry.pull',
  sender: 'antminer-live-led',
  target: 'antminer-live-led',
  deviceId,
  timestamp: Date.now(),
  payload: { query: { type } }
})

const command = (runtime, params) => runtime.handleRequest({
  id: `led-cmd-${Date.now()}`,
  version: '0.2.0',
  type: 'request',
  action: 'command.request',
  sender: 'antminer-live-led',
  target: 'antminer-live-led',
  deviceId,
  timestamp: Date.now(),
  payload: { commandId: `led-${Date.now()}`, command: 'setLED', params }
})

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const main = async () => {
  const config = { address, username, password }
  if (port !== undefined) config.port = port
  const runtime = new WorkerRuntimeV2(workerDir, {
    workerId: 'antminer-live-led',
    devices: [{ deviceId, config }]
  })

  let enabled
  let restored
  try {
    await runtime.start()

    const enable = await command(runtime, { enabled: true })
    if (enable.payload.status !== 'SUCCESS') throw new Error(`ERR_LED_ENABLE_FAILED: ${enable.payload.error}`)
    await wait(5000)
    enabled = (await telemetry(runtime, 'health')).payload.value

    const disable = await command(runtime, { enabled: false })
    if (disable.payload.status !== 'SUCCESS') throw new Error(`ERR_LED_DISABLE_FAILED: ${disable.payload.error}`)
    await wait(5000)
    restored = (await telemetry(runtime, 'health')).payload.value

    console.log(JSON.stringify({
      address,
      ok: enabled.opts !== undefined && restored.opts !== undefined,
      note: 'LED state is not exposed as a telemetry channel; this smoke test verifies both commands succeed against the live device'
    }, null, 2))
  } finally {
    try {
      await command(runtime, { enabled: false })
    } catch {}
    await runtime.stop()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
