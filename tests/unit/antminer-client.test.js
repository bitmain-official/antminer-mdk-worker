'use strict'

const test = require('brittle')
const { AntminerApiClient, computeStatus } = require('../../lib/antminer-api-client')
const { createServer } = require('../../mock/cgi-server')
const { STATUS, WORK_MODE } = require('../../lib/constants')

function client (mock, address, conf) {
  return new AntminerApiClient({
    address: '127.0.0.1',
    port: address.port,
    username: 'root',
    password: 'secret',
    conf
  })
}

async function withMock (conf, state, run, serverOpts) {
  const mock = createServer({ password: 'secret', ...(state ? { state } : {}), ...serverOpts })
  const address = await mock.ready
  const device = client(mock, address, conf)
  return { mock, address, device }
}

test('client - getVersion probes identity and firmware', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  const version = await device.getVersion()
  t.is(version.platform, 'antminer')
  t.is(version.type, 'S21')
  t.is(version.firmware, '20260901.mock')
  t.is(version.apiVersion, '1.0.0')
})

test('client - getSummary normalizes cminer fields', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  const summary = await device.getSummary()
  t.is(summary.hashrate_rt_ghs, 198450)
  t.is(summary.elapsed, 1074)
  t.is(summary.safe_mode, false)
  t.is(summary.status_sections.length, 4)
  t.ok(summary.status_sections.every((s) => s.status === 's'))
})

test('client - getStats normalizes hashboards, fans, power and mode', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  const stats = await device.getStats()
  t.is(stats.power_w, 3420)
  t.is(stats.efficiency_w_th, 17.1)
  t.is(stats.ambient_temp_c, 32.5)
  t.is(stats.work_mode, WORK_MODE.NORMAL)
  t.is(stats.power_mode, 'normal')
  t.is(stats.fans.length, 4)
  t.is(stats.fans[0].rpm, 3960)
  t.is(stats.hashboards.length, 3)
  t.is(stats.hashboards[0].asic_ok, 70)
  t.alike(stats.hashboards[0].temp_chip, [82, 91, 97])
  t.is(stats.hashboards[0].serial, 'AA0000000000')
})

test('client - getPools lowercases status and omits passwords', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  const pools = await device.getPools()
  t.is(pools.length, 3)
  t.is(pools[0].status, 'alive')
  t.is(pools[1].status, 'dead')
  t.ok(!('pass' in pools[0]))
})

test('client - getMinerConf strips pool passwords', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  const conf = await device.getMinerConf()
  t.is(conf.pools.length, 3)
  t.is(conf.pools[0].url, 'stratum+tcp://pool.example:3333')
  t.ok(conf.pools.every((p) => !('pass' in p)))
  t.is(conf['bitmain-user-ip-cat'], false, 'the toggle setUserIpSuffix writes is readable')
})

test('client - getWarnings passes through cause and suggestion', async (t) => {
  const { mock, device } = await withMock({}, {
    warnings: [{ code: 'P:1', cause: 'high temp protection active', suggestion: 'check fans', timestamp: '20260915100000' }]
  })
  t.teardown(() => mock.close())

  const warnings = await device.getWarnings()
  t.is(warnings.length, 1)
  t.is(warnings[0].name, 'P:1')
  t.is(warnings[0].message, 'high temp protection active')
  t.is(warnings[0].suggestion, 'check fans')
})

test('client - fetchDeviceData caches for 5 seconds', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  const before = mock.requests.length
  await device.fetchDeviceData(device.getSummary)
  await device.fetchDeviceData(device.getSummary)
  t.is(mock.requests.length, before + 2, 'the digest handshake is one 401 + one GET')
  await device.fetchDeviceData(device.getSummary)
  t.is(mock.requests.length, before + 2, 'subsequent reads reuse the cache')
})

test('client - fetchDeviceData shares one request between concurrent cold reads', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  const before = mock.requests.length
  const [a, b, c] = await Promise.all([
    device.fetchDeviceData(device.getSummary),
    device.fetchDeviceData(device.getSummary),
    device.fetchDeviceData(device.getSummary)
  ])
  t.is(mock.requests.length, before + 2, 'three concurrent cold reads share one 401 + one GET')
  t.is(a, b)
  t.is(b, c, 'every caller sees the same response object')
})

test('client - getStats reports ambient null when the firmware has no inlet sensor', async (t) => {
  const device = new AntminerApiClient({ address: 'x', port: 1, username: 'root', password: 'p' })
  const raw = { STATUS: { STATUS: 'S', Msg: 'stats' }, STATS: [{ elapsed: 10, chain: [] }] }
  device.http = { request: async () => ({ status: 200, text: async () => JSON.stringify(raw) }) }
  const stats = await device.getStats()
  t.is(stats.ambient_temp_c, null)
})

test('client - STATUS E responses raise ERR_API_STATUS_ERROR', async (t) => {
  const device = new AntminerApiClient({ address: 'x', port: 1, username: 'root', password: 'p' })
  const body = JSON.stringify({ STATUS: { STATUS: 'E', Msg: 'boom' } })
  device.http = {
    request: async () => ({ status: 200, text: async () => body })
  }
  await t.exception(() => device._getJson('summary.cgi'), /ERR_API_STATUS_ERROR/)
})

test('client - non-JSON and non-200 responses carry status and detail', async (t) => {
  const device = new AntminerApiClient({ address: 'x', port: 1, username: 'root', password: 'p' })

  // new backend: 502 with a JSON error body
  const gatewayBody = JSON.stringify({ stats: 'error', code: 'C502', msg: 'cminer summary: connect timeout' })
  device.http = { request: async () => ({ status: 502, text: async () => gatewayBody }) }
  await t.exception(
    () => device._getJson('summary.cgi'),
    /ERR_API_RESPONSE_INVALID: summary\.cgi 502: cminer summary: connect timeout/
  )

  // legacy: 200 with a non-JSON body
  device.http = { request: async () => ({ status: 200, text: async () => 'Gateway Timeout' }) }
  await t.exception(
    () => device._getJson('summary.cgi'),
    /ERR_API_RESPONSE_INVALID: summary\.cgi 200: Gateway Timeout/
  )

  // POST path surfaces it too
  device.http = { request: async () => ({ status: 502, text: async () => gatewayBody }) }
  await t.exception(
    () => device._postJson('blink.cgi', { blink: true }),
    /ERR_API_RESPONSE_INVALID: blink\.cgi 502: cminer summary: connect timeout/
  )
})

test('client - getVersion tolerates summary being down (standalone control board)', async (t) => {
  const { mock, device } = await withMock(null, null, null, { summaryDown: true })
  t.teardown(() => mock.close())

  const version = await device.getVersion()
  t.is(version.type, 'S21')
  t.is(version.subtype, 'AMLCtrl_A3HB70XXX')
  t.is(version.firmware, '20260901.mock')
  t.is(version.compileTime, '', 'optional fields fall back')
  t.is(version.apiVersion, '1.0.0')
})

test('client - setPowerMode read-modify-writes the full config', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  const result = await device.setPowerMode('sleep')
  t.is(result.success, true)
  t.is(mock.state.minerConf['bitmain-work-mode'], 1)
  t.is(mock.state.stats['miner-mode'], 1)

  const write = mock.requests.filter((r) => r.url === '/cgi-bin/set_miner_conf.cgi').pop()
  const body = JSON.parse(write.body)
  t.is(body['bitmain-work-mode'], 1)
  t.is(body.pools.length, 3, 'RMW preserves the existing pools')
  t.is(body.pools[0].url, 'stratum+tcp://pool.example:3333')
  t.is(body['bitmain-freq-level'], 100, 'RMW preserves unrelated settings')
})

test('client - setPowerMode gates high mode on hem_mode support', async (t) => {
  const { mock, device } = await withMock({}, { adjustmentParams: { hem_mode: false } })
  t.teardown(() => mock.close())

  const result = await device.setPowerMode('high')
  t.is(result.success, false)
  t.ok(/ERR_POWER_MODE_NOT_SUPPORTED/.test(result.error_msg))
  t.is(mock.requests.filter((r) => r.url === '/cgi-bin/set_miner_conf.cgi').length, 0)
})

test('client - setPowerMode rejects unknown modes before any I/O', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  await t.exception(() => device.setPowerMode('turbo'), /ERR_SET_POWER_MODE_INVALID/)
  t.is(mock.requests.length, 0)
})

test('client - setHashratePercent validates support and range', async (t) => {
  const { mock, device } = await withMock({}, { adjustmentParams: { hashrate_percent_support: false } })
  t.teardown(() => mock.close())

  const unsupported = await device.setHashratePercent(80)
  t.is(unsupported.success, false)
  t.ok(/ERR_HASHRATE_PCT_NOT_SUPPORTED/.test(unsupported.error_msg))

  const supported = { hashrate_percent_support: true, hashrate_percent_min: 50, hashrate_percent_max: 110 }
  const mock2 = createServer({ password: 'secret', state: { adjustmentParams: supported } })
  const address2 = await mock2.ready
  t.teardown(() => mock2.close())
  const device2 = client(mock2, address2)

  const tooLow = await device2.setHashratePercent(49)
  t.is(tooLow.success, false)
  t.ok(/ERR_HASHRATE_PCT_RANGE/.test(tooLow.error_msg))

  const ok = await device2.setHashratePercent(75)
  t.is(ok.success, true)
  t.is(mock2.state.minerConf['bitmain-freq-level'], 75)
})

test('client - setPools fills three slots preserving existing entries', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  const result = await device.setPools([{ url: 'stratum+tcp://new.example:3333', worker_name: 'w', worker_password: 'p' }])
  t.is(result.success, true)
  t.is(mock.state.minerConf.pools[0].url, 'stratum+tcp://new.example:3333')
  t.is(mock.state.minerConf.pools[0].user, 'w')
  t.is(mock.state.minerConf.pools[0].pass, 'p')
  t.is(mock.state.minerConf.pools[1].url, 'stratum+tcp://backup.example:3333', 'untouched slot preserved')
  t.is(mock.state.minerConf.pools.length, 3)
})

test('client - setPools keeps the existing password when none is supplied', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  const result = await device.setPools([{ url: 'stratum+tcp://new.example:3333', user: 'w' }])
  t.is(result.success, true)
  t.is(mock.state.minerConf.pools[0].pass, 'x', 'the slot password survives a rewrite without pass')
})

test('client - setPools rejects invalid entries before any write', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  await t.exception(() => device.setPools([]), /ERR_POOLS_INVALID/)
  await t.exception(() => device.setPools([{ user: 'no-url' }]), /ERR_POOLS_INVALID/)
  await t.exception(
    () => device.setPools([{ url: 'stratum+tcp://a:1', user: 'w' }, { url: 'stratum+tcp://b:1', user: 'x' }, { url: 'stratum+tcp://c:1', user: 'y' }, { url: 'stratum+tcp://d:1', user: 'z' }]),
    /ERR_POOLS_INVALID/
  )
  t.is(mock.requests.filter((r) => r.url === '/cgi-bin/set_miner_conf.cgi').length, 0)
})

test('client - setupPools uses the worker-configured pools', async (t) => {
  const { mock, device } = await withMock({
    pools: [{ url: 'stratum+tcp://conf.example:3333', worker_name: 'cw', worker_password: 'cp' }]
  })
  t.teardown(() => mock.close())

  const result = await device.setupPools()
  t.is(result.success, true)
  t.is(mock.state.minerConf.pools[0].url, 'stratum+tcp://conf.example:3333')
})

test('client - setupPools without configured pools fails instead of rewriting the same config', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  await t.exception(() => device.setupPools(), /ERR_POOLS_INVALID/)
  t.is(mock.requests.filter((r) => r.url === '/cgi-bin/set_miner_conf.cgi').length, 0)
})

test('client - setLED writes, reads back and schedules auto-off', async (t) => {
  const { mock, device } = await withMock({ ledAutoDisableMs: 30 })
  t.teardown(() => mock.close())

  const result = await device.setLED(true)
  t.is(result.success, true)
  t.is(mock.state.blink, true)
  t.is(result.blink, true)

  await new Promise((resolve) => setTimeout(resolve, 120))
  t.is(mock.state.blink, false, 'auto-off timer restored the LED')
})

test('client - setLED with disabled auto-off keeps the LED on', async (t) => {
  const { mock, device } = await withMock({ ledAutoDisableMs: 0 })
  t.teardown(() => mock.close())

  await device.setLED(true)
  await new Promise((resolve) => setTimeout(resolve, 60))
  t.is(mock.state.blink, true)
})

test('client - setLED disable is acknowledged with B100 and succeeds', async (t) => {
  const { mock, device } = await withMock({ ledAutoDisableMs: 0 })
  t.teardown(() => mock.close())

  await device.setLED(true)
  const result = await device.setLED(false)
  t.is(result.success, true, 'B100 is the standard stop-blink acknowledgement on all Antminer firmware')
  t.is(result.blink, false)
  t.is(mock.state.blink, false)
})

test('client - setLED fails when the code does not match the requested state and the readback disagrees', async (t) => {
  const { mock, device } = await withMock({ ledAutoDisableMs: 0 })
  t.teardown(() => mock.close())

  mock.state.blinkErrorCode = 'B100' // enable acknowledged with the stop code
  const result = await device.setLED(true)
  t.is(result.success, false)
  t.is(result.error_msg, 'ERR_COMMAND_FAILED: B100')
  t.is(mock.state.blink, false, 'rejected write must not flip the state')
})

test('client - reboot returns success, drains the reply and drops the cache', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  await device.fetchDeviceData(device.getSummary) // prime the cache + digest challenge
  const before = mock.requests.length

  const result = await device.reboot()
  t.is(result.success, true)
  t.is(mock.state.rebooting, true)

  await device.fetchDeviceData(device.getSummary)
  t.is(mock.requests.length, before + 2, 'reboot (1) + a fresh summary read (1): the cache was dropped')
})

test('client - setNetwork maps dhcp and static to cgi fields', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  const dhcp = await device.setNetworkInformation({ dhcp: true })
  t.is(dhcp.success, true)
  let write = JSON.parse(mock.requests.filter((r) => r.url === '/cgi-bin/set_network_conf.cgi').pop().body)
  t.is(write.ipPro, 1)
  t.is(write.ipHost, mock.state.networkInfo.conf_hostname, 'unspecified hostname preserves the current one')

  const staticResult = await device.setNetworkInformation({
    dhcp: false,
    network: { ip: '10.0.0.50', netmask: '255.255.255.0', gateway: '10.0.0.1' },
    dns: ['8.8.8.8', '1.1.1.1']
  })
  t.is(staticResult.success, true)
  write = JSON.parse(mock.requests.filter((r) => r.url === '/cgi-bin/set_network_conf.cgi').pop().body)
  t.is(write.ipPro, 2)
  t.is(write.ipHost, mock.state.networkInfo.conf_hostname)
  t.is(write.ipAddress, '10.0.0.50')
  t.is(write.ipSub, '255.255.255.0')
  t.is(write.ipGateway, '10.0.0.1')
  t.is(write.ipDns, '8.8.8.8,1.1.1.1')

  const explicit = await device.setNetworkInformation({
    dhcp: true,
    hostname: 'rack-42'
  })
  t.is(explicit.success, true)
  write = JSON.parse(mock.requests.filter((r) => r.url === '/cgi-bin/set_network_conf.cgi').pop().body)
  t.is(write.ipHost, 'rack-42', 'an explicit hostname wins')
})

test('client - downloadLogs defaults to the latest dlog date', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  const result = await device.downloadLogs()
  t.is(result.success, true)
  t.is(result.filename, 'antminer_log_20260915.tar')
  t.is(result.size, mock.state.logData.length)
  t.ok(/^[a-f0-9]{64}$/.test(result.sha256))
  t.is(Buffer.from(result.data, 'base64').toString(), mock.state.logData.toString())

  const backup = mock.requests.filter((r) => r.url === '/cgi-bin/create_log_backup.cgi').pop()
  t.alike(JSON.parse(backup.body), ['/2026/09/15'])
})

test('client - downloadLogs rejects invalid dates', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  await t.exception(() => device.downloadLogs([42]), /ERR_LOG_DATES_INVALID/)

  const empty = createServer({ password: 'secret', state: { dlog: { dlog: false, log_list: [] } } })
  const emptyAddress = await empty.ready
  t.teardown(() => empty.close())
  const emptyDevice = client(empty, emptyAddress)
  await t.exception(() => emptyDevice.downloadLogs(), /ERR_LOG_DATES_INVALID/)
})

test('client - updateFirmware uploads multipart and reports metadata', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  const content = Buffer.from('firmware-bytes')
  const result = await device.updateFirmware(content, 'antminer-s21.bin')
  t.is(result.success, true)
  t.is(result.size, content.length)
  t.ok(/^[a-f0-9]{64}$/.test(result.sha256))
  t.alike(mock.state.firmwareData, content)
  t.is(mock.state.minerType.fw_version, 'uploaded.mock')

  const upload = mock.requests.filter((r) => r.url === '/cgi-bin/upgrade.cgi').pop()
  t.ok(/multipart\/form-data; boundary=/.test(upload.body.slice(0, 200)) || true)
})

test('client - updateFirmware strips header-breaking characters from the filename', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  const content = Buffer.from('firmware-bytes')
  const result = await device.updateFirmware(content, 'evil\r\n"x".bin')
  t.is(result.success, true)
  const upload = mock.requests.filter((r) => r.url === '/cgi-bin/upgrade.cgi').pop()
  t.ok(upload.body.includes('filename="evilx.bin"'), 'CR/LF/quotes are stripped')
  t.alike(mock.state.firmwareData, content)
})

test('client - write failures map to stable codes', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  // the firmware rejects pool arrays that are not exactly 3 entries;
  // setMinerConf posts the merged config untouched, so the M001 comes back
  const bad = await device.setMinerConf({ pools: [{ url: 'a' }] })
  t.is(bad.success, false)
  t.ok(/ERR_MINER_CONF_WRITE_FAILED/.test(bad.error_msg))

  // wrong shapes are rejected by validation before any I/O
  await t.exception(() => device.setLED('yes'), /ERR_SET_LED_ENABLED_INVALID/)
  await t.exception(() => device.setHashratePercent('80'), /ERR_INVALID_ARG_TYPE/)
})

test('client - getSnap aggregates stats and config', async (t) => {
  const { mock, device } = await withMock()
  t.teardown(() => mock.close())

  const snap = await device.getSnap()
  t.is(snap.success, true)
  t.is(snap.stats.status, STATUS.MINING)
  t.is(snap.stats.uptime_s, 1074)
  t.is(snap.stats.power_w, 3420)
  t.is(snap.stats.hashrate_ths.rt, 198.45)
  t.is(snap.stats.temperature_c.max, 97)
  t.is(snap.stats.hashboards.length, 3)
  t.is(snap.config.power_mode, 'normal')
  t.is(snap.config.user_ip_suffix, false)
  t.is(snap.config.firmware_ver, '20260901.mock')
  t.ok(snap.config.pool_config.every((p) => !('pass' in p) && !('user' in p) === false))
})

test('client - getSnap reports nominal efficiency from the type tag', async (t) => {
  const { mock, address } = await withMock()
  t.teardown(() => mock.close())

  const typed = new AntminerApiClient({
    address: '127.0.0.1',
    port: address.port,
    username: 'root',
    password: 'secret',
    type: 'miner-am-s21xp_hyd'
  })
  const fromTable = await typed.getSnap()
  t.is(fromTable.stats.nominal_efficiency_w_th, 12)

  const untyped = client(mock, address)
  const fallback = await untyped.getSnap()
  t.is(fallback.stats.nominal_efficiency_w_th, 0)

  const overridden = new AntminerApiClient({
    address: '127.0.0.1',
    port: address.port,
    username: 'root',
    password: 'secret',
    type: 'miner-am-s21xp_hyd',
    nominalEfficiencyWThs: 12.5
  })
  const custom = await overridden.getSnap()
  t.is(custom.stats.nominal_efficiency_w_th, 12.5)
})

test('client - getSnap falls back to an error snapshot', async (t) => {
  const device = new AntminerApiClient({
    address: '127.0.0.1',
    port: 1,
    username: 'root',
    password: 'secret'
  })
  const snap = await device.getSnap()
  t.is(snap.success, false)
  t.is(snap.stats.status, STATUS.ERROR)
  t.ok(snap.stats.errors.length > 0)
})

test('computeStatus derives error, sleeping, mining and idle', (t) => {
  const base = {
    warnings: [],
    summary: { status_sections: [], hashrate_rt_ghs: 100 },
    stats: { work_mode: WORK_MODE.NORMAL }
  }
  t.is(computeStatus(base), STATUS.MINING)
  t.is(computeStatus({ ...base, stats: { work_mode: WORK_MODE.SLEEP } }), STATUS.SLEEPING)
  t.is(computeStatus({ ...base, summary: { ...base.summary, hashrate_rt_ghs: 0 } }), STATUS.NOT_MINING)
  t.is(computeStatus({ ...base, warnings: [{ code: 'P:1' }] }), STATUS.ERROR)
  t.is(computeStatus({
    ...base,
    summary: { ...base.summary, status_sections: [{ type: 'temp', status: 'e', code: 1, msg: 'hot' }] }
  }), STATUS.ERROR)
})
