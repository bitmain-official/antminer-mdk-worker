'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

// Tiered live test: safe commands run by default; reboot/setNetwork/updateFirmware
// and real pool writes require explicit flags because they change physical state.
// usage: node scripts/test-live-commands.js <address> [port]
//        [--with-reboot] [--with-network '<json>'] [--pools '<json>'] [--firmware <file>]
//        [--save-logs <dir>] [--power-mode <mode[,mode...]>] [--ip-suffix <on|off>]
// env:   LIVE_MINER_IP (when no address argument is passed)
//        ANTMINER_USERNAME / ANTMINER_PASSWORD (default root/root)

const args = process.argv.slice(2)
const flags = {}
const positional = []
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--with-reboot') flags.reboot = true
  else if (arg === '--with-network') flags.network = args[++i]
  else if (arg === '--pools') flags.pools = args[++i]
  else if (arg === '--firmware') flags.firmware = args[++i]
  else if (arg === '--save-logs') flags.saveLogs = args[++i]
  else if (arg === '--power-mode') flags.powerMode = args[++i]
  else if (arg === '--ip-suffix') flags.ipSuffix = args[++i]
  else positional.push(arg)
}

const address = positional[0] || process.env.LIVE_MINER_IP
const port = positional[1] ? Number(positional[1]) : undefined
const username = process.env.ANTMINER_USERNAME || 'root'
const password = process.env.ANTMINER_PASSWORD || 'root'
const mdkRepo = path.resolve(process.env.MDK_REPO || path.resolve(__dirname, '../../mdk'))

if (flags.ipSuffix !== undefined && !/^(on|off)$/i.test(flags.ipSuffix || '')) {
  console.error('--ip-suffix expects on or off')
  process.exit(1)
}

if (!address || (port !== undefined && !Number.isInteger(port))) {
  console.error('usage: node scripts/test-live-commands.js <address> [port] [--with-reboot] [--with-network <json>] [--pools <json>] [--firmware <file>] [--save-logs <dir>] [--power-mode <mode[,mode...]>] [--ip-suffix <on|off>]')
  process.exit(1)
}

if (!process.env.LIVE_MINER_IP && !address) {
  console.log('LIVE_MINER_IP not set — skipping live command test')
  process.exit(0)
}

const WorkerRuntimeV2 = require(path.join(mdkRepo, 'backend/core/mdk-worker/lib/worker-runtime-v2'))
const workerDir = path.resolve(__dirname, '..')
const deviceId = `antminer-${address.replaceAll('.', '-')}`

const envelope = (action, payload) => ({
  id: `${action}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
  version: '0.2.0',
  type: 'request',
  action,
  sender: 'antminer-live-commands',
  target: 'antminer-live-commands',
  deviceId,
  timestamp: Date.now(),
  payload
})

const telemetry = (runtime, type) =>
  runtime.handleRequest(envelope('telemetry.pull', { query: { type } }))

const command = (runtime, name, params) =>
  runtime.handleRequest(envelope('command.request', { commandId: `cmd-${name}-${Date.now()}`, command: name, params }))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const results = []
const record = (name, outcome, ms, details) => {
  results.push({ command: name, outcome, ms, ...(details ? { details } : {}) })
  console.log(JSON.stringify(results[results.length - 1]))
}

async function runCommand (runtime, name, params, verify) {
  const started = Date.now()
  const response = await command(runtime, name, params)
  if (response.payload.status !== 'SUCCESS') {
    record(name, 'failed', Date.now() - started, { error: response.payload.error })
    return false
  }
  if (verify) {
    const problem = await verify(response.payload.result)
    if (problem) {
      record(name, 'verify-failed', Date.now() - started, { problem })
      return false
    }
  }
  record(name, 'succeeded', Date.now() - started)
  return true
}

async function waitForRecovery (runtime, timeoutMs = 4 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs
  // The controller web answers again within ~1 min, but cminer reports
  // elapsed 0 for several minutes while the hash boards initialize, so a
  // fresh boot is "summary answers with a small uptime" — not "uptime > 0".
  // Require at least one failed poll first so a slow-to-reboot device is not
  // mistaken for a recovered one.
  let sawDown = false
  while (Date.now() < deadline) {
    let uptime
    try {
      uptime = (await telemetry(runtime, 'uptime')).payload.value
    } catch {
      uptime = undefined
    }
    if (typeof uptime !== 'number') sawDown = true
    else if (sawDown && uptime < 300) return true
    await wait(15000)
  }
  return false
}

// A mode change restarts the miner process: set_miner_conf.cgi is briefly
// unreadable right after a previous mode change, so retry the write.
async function writePowerMode (runtime, mode) {
  for (let attempt = 0; ; attempt++) {
    const response = await command(runtime, 'setPowerMode', { mode })
    if (response.payload.status === 'SUCCESS' ||
        attempt >= 2 ||
        !/ERR_API_RESPONSE_INVALID|ERR_MINER_CONF_READ_FAILED/.test(response.payload.error || '')) {
      return response
    }
    await wait(10000)
  }
}

// The new mode only shows up in stats once the restarted miner settles; poll
// instead of a single read. First check at >=10s after the write.
async function waitForPowerMode (runtime, mode, timeoutMs = 90 * 1000) {
  const deadline = Date.now() + timeoutMs
  let last
  await wait(10000)
  while (true) {
    try {
      last = (await telemetry(runtime, 'power_mode')).payload.value
      if (last === mode) return { ok: true, last }
    } catch {}
    if (Date.now() >= deadline) return { ok: false, last }
    await wait(5000)
  }
}

async function main () {
  const config = { address, username, password }
  if (port !== undefined) config.port = port
  const runtime = new WorkerRuntimeV2(workerDir, {
    workerId: 'antminer-live-commands',
    devices: [{ deviceId, config }]
  })

  let failures = 0
  const fail = () => { failures++ }

  try {
    await runtime.start()
    console.log(JSON.stringify({ device: address, port: port || 80, user: username }))

    // ---- safe tier (default) ----

    const metrics = (await telemetry(runtime, 'metrics')).payload.metrics
    record('telemetry:metrics', 'succeeded', 0, {
      model: metrics.device_info?.model,
      firmware: metrics.firmware_info?.firmware,
      hashrateRtTHs: metrics.hashrate_rt,
      powerW: metrics.power,
      temperatureC: metrics.temperature
    })

    if (!(await runCommand(runtime, 'setLED', { enabled: true },
      (result) => (result.blink === true ? null : 'readback did not report blink=true')))) fail()
    if (!(await runCommand(runtime, 'setLED', { enabled: false },
      (result) => (result.blink === false ? null : 'readback did not report blink=false')))) fail()

    // metrics.power_mode is an error object when the telemetry channel failed
    // (e.g. cminer down on a standalone control board) — not a mode to write
    const currentMode = typeof metrics.power_mode === 'string' ? metrics.power_mode : null
    if (flags.powerMode) {
      // explicit mode test: write each requested mode, wait for it to settle,
      // verify via telemetry, then restore the original mode
      const modes = flags.powerMode.split(',').map((m) => m.trim()).filter(Boolean)
      for (const mode of modes) {
        const started = Date.now()
        const response = await writePowerMode(runtime, mode)
        if (response.payload.status === 'SUCCESS') {
          const { ok, last } = await waitForPowerMode(runtime, mode)
          if (ok) {
            record('setPowerMode', 'succeeded', Date.now() - started, { mode })
          } else {
            record('setPowerMode', 'verify-failed', Date.now() - started, { expected: mode, actual: last })
            fail()
          }
        } else if (/ERR_POWER_MODE_NOT_SUPPORTED/.test(response.payload.error || '')) {
          record('setPowerMode', 'skipped', Date.now() - started, { mode, reason: 'firmware does not support this mode' })
        } else {
          record('setPowerMode', 'failed', Date.now() - started, { mode, error: response.payload.error })
          fail()
        }
      }
      if (currentMode && currentMode !== 'unknown' && modes[modes.length - 1] !== currentMode) {
        const started = Date.now()
        const response = await writePowerMode(runtime, currentMode)
        if (response.payload.status === 'SUCCESS') {
          const { ok, last } = await waitForPowerMode(runtime, currentMode)
          record('setPowerMode:restore', ok ? 'succeeded' : 'verify-failed', Date.now() - started,
            { mode: currentMode, actual: last })
          if (!ok) fail()
        } else {
          record('setPowerMode:restore', 'failed', Date.now() - started, { mode: currentMode, error: response.payload.error })
          fail()
        }
      }
    } else if (currentMode && currentMode !== 'unknown') {
      if (!(await runCommand(runtime, 'setPowerMode', { mode: currentMode },
        null))) fail()
      const after = (await telemetry(runtime, 'power_mode')).payload.value
      if (after !== currentMode) {
        record('setPowerMode', 'verify-failed', 0, { expected: currentMode, actual: after })
        fail()
      }
    } else {
      record('setPowerMode', 'skipped', 0, {
        reason: currentMode === null
          ? 'power_mode telemetry unavailable (cminer down?)'
          : 'device reports unknown power mode'
      })
    }

    // freq_level being present does not mean percent scaling is supported —
    // a NOT_SUPPORTED reply is the device's capability answer, not a command
    // failure
    const minerStats = (await telemetry(runtime, 'miner_stats')).payload.value
    const currentLevel = minerStats?.stats?.freq_level
    if (Number.isFinite(currentLevel) && currentLevel > 0) {
      const started = Date.now()
      const response = await command(runtime, 'setHashratePercent', { pct: currentLevel })
      if (response.payload.status === 'SUCCESS') {
        record('setHashratePercent', 'succeeded', Date.now() - started)
      } else if (/ERR_HASHRATE_PCT_NOT_SUPPORTED/.test(response.payload.error || '')) {
        record('setHashratePercent', 'skipped', Date.now() - started, { reason: 'device reports hashrate_percent_support: false' })
      } else {
        record('setHashratePercent', 'failed', Date.now() - started, { error: response.payload.error })
        fail()
      }
    }

    // negative validation path only: a real pool write needs --pools because
    // telemetry never exposes pool passwords, so a write-back would wipe them
    {
      const started = Date.now()
      const response = await command(runtime, 'setupPools', { pools: [] })
      if (response.payload.status === 'FAILED' && /ERR_POOLS_INVALID/.test(response.payload.error || '')) {
        record('setupPools:validation', 'succeeded', Date.now() - started)
      } else {
        record('setupPools:validation', 'failed', Date.now() - started, { error: response.payload.error })
        fail()
      }
    }

    // default writes back the CURRENT value so the default run never changes
    // how pool-side worker names look; --ip-suffix on|off writes that value
    {
      const snap = (await telemetry(runtime, 'snap')).payload.value
      const enabled = flags.ipSuffix !== undefined
        ? /^on$/i.test(flags.ipSuffix)
        : snap?.config?.user_ip_suffix === true
      const started = Date.now()
      const response = await command(runtime, 'setUserIpSuffix', { enabled })
      if (response.payload.status !== 'SUCCESS') {
        record('setUserIpSuffix', 'failed', Date.now() - started, { error: response.payload.error })
        fail()
      } else {
        record('setUserIpSuffix', 'succeeded', Date.now() - started, {
          enabled,
          note: enabled
            ? 'cminer appends .<ip with dots as X> to pool worker names after the next config reload'
            : undefined
        })
      }
    }

    let logs
    if (!(await runCommand(runtime, 'downloadLogs', {}, (result) => {
      logs = result
      return result.size > 0 && Buffer.from(result.data, 'base64').length === result.size
        ? null
        : 'archive size/base64 mismatch'
    }))) fail()
    if (flags.saveLogs && logs) {
      fs.mkdirSync(flags.saveLogs, { recursive: true })
      const target = path.join(flags.saveLogs, path.basename(logs.filename))
      fs.writeFileSync(target, Buffer.from(logs.data, 'base64'))
      console.log(JSON.stringify({ event: 'logs_saved', command: 'downloadLogs', file: target, size: logs.size, sha256: logs.sha256 }))
    }

    // ---- dangerous tier (explicit flags) ----

    if (flags.pools) {
      let pools
      try {
        pools = JSON.parse(flags.pools)
      } catch {
        record('setupPools', 'skipped', 0, { reason: '--pools is not valid JSON' })
        fail()
      }
      if (pools) {
        if (!(await runCommand(runtime, 'setupPools', { pools }, null))) fail()
      }
    }

    if (flags.network) {
      let network
      try {
        network = JSON.parse(flags.network)
      } catch {
        record('setNetwork', 'skipped', 0, { reason: '--with-network is not valid JSON' })
        fail()
      }
      if (network) {
        const started = Date.now()
        try {
          const response = await command(runtime, 'setNetwork', { network })
          record('setNetwork', response.payload.status === 'SUCCESS' ? 'succeeded' : 'failed',
            Date.now() - started, { error: response.payload.error, note: 'connection drops and the miner reboots — verify reachability at the new address manually' })
          if (response.payload.status !== 'SUCCESS') fail()
        } catch (err) {
          record('setNetwork', 'outcome-unknown', Date.now() - started, { error: err.message })
        }
        // the connection may be gone; nothing after this is reachable
        console.log(JSON.stringify({ summary: { total: results.length, failures }, note: 'setNetwork ran last because it reboots the miner' }))
        process.exitCode = failures ? 1 : 0
        return
      }
    }

    if (flags.reboot) {
      const started = Date.now()
      const response = await command(runtime, 'reboot', {})
      if (response.payload.status !== 'SUCCESS') {
        record('reboot', 'failed', Date.now() - started, { error: response.payload.error })
        fail()
      } else {
        record('reboot', 'succeeded', Date.now() - started, { note: 'waiting for the controller to come back (2-3 minutes)' })
        const recovered = await waitForRecovery(runtime)
        record('reboot:recovery', recovered ? 'succeeded' : 'timeout', Date.now() - started)
        if (!recovered) fail()
      }
    }

    // ---- destructive tier (explicit firmware file) ----

    if (flags.firmware) {
      const started = Date.now()
      try {
        const content = fs.readFileSync(flags.firmware)
        const response = await command(runtime, 'updateFirmware', {
          firmware: {
            filename: path.basename(flags.firmware),
            encoding: 'base64',
            size: content.length,
            sha256: crypto.createHash('sha256').update(content).digest('hex'),
            data: content.toString('base64')
          }
        })
        if (response.payload.status !== 'SUCCESS') {
          record('updateFirmware', 'failed', Date.now() - started, { error: response.payload.error })
          fail()
        } else {
          record('updateFirmware', 'succeeded', Date.now() - started, {
            note: 'the miner reboots into the new image — verify firmware_info after it reconnects'
          })
        }
      } catch (err) {
        record('updateFirmware', 'error', Date.now() - started, { error: err.message })
        fail()
      }
    }

    console.log(JSON.stringify({ summary: { total: results.length, failures } }))
    process.exitCode = failures ? 1 : 0
  } finally {
    await runtime.stop().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
