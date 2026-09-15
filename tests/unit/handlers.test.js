'use strict'

const path = require('node:path')
const test = require('brittle')
const { createServer } = require('../../mock/cgi-server')

const MDK_REPO = process.env.MDK_REPO
  ? path.resolve(process.env.MDK_REPO)
  : path.resolve(__dirname, '../../../mdk')
const { loadContract, createInstance } = require(path.join(MDK_REPO, 'backend/core/mdk-worker'))

const PKG_DIR = path.join(__dirname, '..', '..')

function buildInstance ({ port, deviceId, conf, password = 'secret' }) {
  return createInstance({
    dir: PKG_DIR,
    entries: loadContract(PKG_DIR).entries,
    device: {
      id: deviceId,
      opts: {
        address: '127.0.0.1',
        port,
        username: 'root',
        password,
        ...(conf ? { conf } : {})
      },
      env: {},
      config: {}
    }
  })
}

test('handlers - the contract has 22 telemetry channels and 9 commands', (t) => {
  const loaded = loadContract(PKG_DIR)
  t.is(loaded.entries.telemetry.size, 22)
  t.is(loaded.entries.commands.size, 9)
  for (const entry of loaded.publishedContract.capabilities.telemetry) {
    t.is(entry.handler, undefined, `${entry.name} handler path stripped from published contract`)
  }
})

test('handlers - every declared handler loads to a function', (t) => {
  const loaded = loadContract(PKG_DIR)
  const instance = createInstance({
    dir: PKG_DIR,
    entries: loaded.entries,
    device: { id: 'ant-boot', opts: { address: '127.0.0.1', port: 1 }, env: {}, config: {} }
  })
  for (const fn of instance.telemetry.values()) t.is(typeof fn, 'function')
  for (const fn of instance.commands.values()) t.is(typeof fn, 'function')
})

test('handlers - telemetry reads the mock through the digest path', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const instance = buildInstance({ port: address.port, deviceId: 'ant-0' })

  t.is(await instance.telemetry.get('hashrate_rt')(), 198.45)
  t.is(await instance.telemetry.get('hashrate_avg')(), 199.61)
  t.is(await instance.telemetry.get('hashrate_ideal')(), 200)
  t.is(await instance.telemetry.get('power')(), 3420)
  t.is(await instance.telemetry.get('efficiency')(), 17.1)
  t.is(await instance.telemetry.get('temperature')(), 97)
  t.is(await instance.telemetry.get('ambient_temp')(), 32.5)
  t.is(await instance.telemetry.get('uptime')(), 1074)
  t.is(await instance.telemetry.get('status')(), 'mining')
  t.is(await instance.telemetry.get('power_mode')(), 'normal')
  t.is(await instance.telemetry.get('safe_mode')(), false)
  t.is(await instance.telemetry.get('accepted_shares')(), 8523)
  t.is(await instance.telemetry.get('rejected_shares')(), 41)
  t.is(await instance.telemetry.get('pool_url')(), 'stratum+tcp://pool.example:3333')

  const fans = await instance.telemetry.get('fans')()
  t.is(fans.length, 4)
  t.is(fans[0].rpm, 3960)

  const boards = await instance.telemetry.get('hashboards')()
  t.is(boards.length, 3)
  t.is(boards[0].asic_ok, 70)

  const pools = await instance.telemetry.get('pools')()
  t.is(pools[0].status, 'alive')
  t.ok(pools.every((p) => !('pass' in p)))

  t.alike(await instance.telemetry.get('errors')(), [])

  const deviceInfo = await instance.telemetry.get('device_info')()
  t.is(deviceInfo.serial_number, 'SN-MOCK-0001')

  const firmware = await instance.telemetry.get('firmware_info')()
  t.is(firmware.firmware, '20260901.mock')

  const snap = await instance.telemetry.get('snap')()
  t.is(snap.success, true)
  t.is(snap.stats.hashrate_ths.rt, 198.45)
})

test('handlers - status reflects warnings from the device', async (t) => {
  const mock = createServer({
    password: 'secret',
    state: { warnings: [{ code: 'P:1', cause: 'high temp protection', suggestion: 'check fans', timestamp: '20260915100000' }] }
  })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const instance = buildInstance({ port: address.port, deviceId: 'ant-warn' })
  t.is(await instance.telemetry.get('status')(), 'error')
  const errors = await instance.telemetry.get('errors')()
  t.is(errors.length, 1)
  t.is(errors[0].name, 'P:1')
})

test('handlers - setLED validates and reaches the mock', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const instance = buildInstance({ port: address.port, deviceId: 'ant-led' })

  const result = await instance.commands.get('setLED')({ enabled: true })
  t.is(result.success, true)
  t.is(mock.state.blink, true)

  await instance.commands.get('setLED')({ enabled: false })
  t.is(mock.state.blink, false)

  await t.exception(() => instance.commands.get('setLED')({ enabled: 'yes' }), /ERR_SET_LED_ENABLED_INVALID/)
})

test('handlers - setPowerMode validates before any I/O and writes the device', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const instance = buildInstance({ port: address.port, deviceId: 'ant-mode' })

  await t.exception(() => instance.commands.get('setPowerMode')({ mode: 'turbo' }), /ERR_SET_POWER_MODE_INVALID/)

  const result = await instance.commands.get('setPowerMode')({ mode: 'sleep' })
  t.is(result.success, true)
  t.is(mock.state.minerConf['bitmain-work-mode'], 1)
})

test('handlers - setUserIpSuffix read-modify-writes bitmain-user-ip-cat', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const instance = buildInstance({ port: address.port, deviceId: 'ant-ipcat' })

  await t.exception(() => instance.commands.get('setUserIpSuffix')({ enabled: 'yes' }), /ERR_SET_USER_IP_SUFFIX_INVALID/)

  const on = await instance.commands.get('setUserIpSuffix')({ enabled: true })
  t.is(on.success, true)
  t.is(on.enabled, true)
  t.is(mock.state.minerConf['bitmain-user-ip-cat'], true)
  t.alike(mock.state.minerConf.pools[0], { url: 'stratum+tcp://pool.example:3333', user: 'worker.1', pass: 'x' },
    'read-modify-write preserves the pool list')

  const off = await instance.commands.get('setUserIpSuffix')({ enabled: false })
  t.is(off.success, true)
  t.is(mock.state.minerConf['bitmain-user-ip-cat'], false)
})

test('handlers - ambient_temp reports null when the firmware has no inlet sensor', async (t) => {
  const mock = createServer({ password: 'secret', state: { stats: { ambient_temp: null } } })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const instance = buildInstance({ port: address.port, deviceId: 'ant-ambient' })
  t.is(await instance.telemetry.get('ambient_temp')(), null)
})

test('handlers - setupPools reaches the mock and validates entries', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const instance = buildInstance({ port: address.port, deviceId: 'ant-pools' })

  await t.exception(() => instance.commands.get('setupPools')({ pools: 'x' }), /ERR_INVALID_ARG_TYPE/)
  await t.exception(() => instance.commands.get('setupPools')({ pools: [] }), /ERR_POOLS_INVALID/)
  await t.exception(
    () => instance.commands.get('setupPools')({ pools: [{ user: 'no-url' }] }),
    /ERR_POOLS_INVALID/
  )

  const result = await instance.commands.get('setupPools')({
    pools: [{ url: 'stratum+tcp://new.example:3333', worker_name: 'w', worker_password: 'p' }]
  })
  t.is(result.success, true)
  t.is(mock.state.minerConf.pools[0].url, 'stratum+tcp://new.example:3333')
})

test('handlers - setHashratePercent validates type and range', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const instance = buildInstance({ port: address.port, deviceId: 'ant-pct' })

  await t.exception(() => instance.commands.get('setHashratePercent')({ pct: '80' }), /ERR_INVALID_ARG_TYPE/)

  const result = await instance.commands.get('setHashratePercent')({ pct: 90 })
  t.is(result.success, true)
  t.is(mock.state.minerConf['bitmain-freq-level'], 90)
})

test('handlers - setNetwork validates the configuration', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const instance = buildInstance({ port: address.port, deviceId: 'ant-net' })

  await t.exception(() => instance.commands.get('setNetwork')({ network: {} }), /ERR_NETWORK_CONFIG_INVALID/)

  const result = await instance.commands.get('setNetwork')({ network: { dhcp: true } })
  t.is(result.success, true)
  t.is(mock.state.networkInfo.conf_nettype, 'DHCP')
})

test('handlers - downloadLogs returns the archive with metadata', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const instance = buildInstance({ port: address.port, deviceId: 'ant-logs' })

  const result = await instance.commands.get('downloadLogs')({})
  t.is(result.success, true)
  t.is(result.filename, 'antminer_log_20260915.tar')
  t.is(Buffer.from(result.data, 'base64').toString(), mock.state.logData.toString())
})

test('handlers - updateFirmware decodes and uploads the payload', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const instance = buildInstance({ port: address.port, deviceId: 'ant-fw' })

  await t.exception(
    () => instance.commands.get('updateFirmware')({ firmware: { filename: 'x.bin' } }),
    /ERR_FIRMWARE_/
  )

  const content = Buffer.from('antminer-firmware-image')
  const result = await instance.commands.get('updateFirmware')({
    firmware: {
      filename: 'antminer-s21.bin',
      encoding: 'base64',
      size: content.length,
      sha256: require('node:crypto').createHash('sha256').update(content).digest('hex'),
      data: content.toString('base64')
    }
  })
  t.is(result.success, true)
  t.alike(mock.state.firmwareData, content)
  t.is(result.filename, 'antminer-s21.bin')
})

test('handlers - updateFirmware extracts the matching image from an N-in-1 container', async (t) => {
  const zlib = require('node:zlib')
  const { HEADER_SIZE, ITEM_SIZE } = require('../../lib/utils/firmware-container')
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const instance = buildInstance({ port: address.port, deviceId: 'ant-fw-nin1' })

  const writeU32 = (buf, offset, value) => buf.writeUInt32LE(value >>> 0, offset)
  const buildItem = (name, ctrlBoard, minerModel, dataOffset, dataSize) => {
    const item = Buffer.alloc(ITEM_SIZE)
    item[0] = Buffer.byteLength(name)
    item[2] = Buffer.byteLength(ctrlBoard)
    item[3] = Buffer.byteLength(minerModel)
    item.write(name, 4, 'latin1')
    item.write(ctrlBoard, 100, 'latin1')
    item.write(minerModel, 132, 'latin1')
    writeU32(item, 164, dataOffset)
    writeU32(item, 168, dataSize)
    return item
  }

  // mock device: miner_type S21, subtype AMLCtrl_A3HB70XXX (see cgi-server.js)
  const imageA = Buffer.alloc(2048, 0xAA)
  const imageB = Buffer.alloc(1024, 0xBB)
  const dataOffset = HEADER_SIZE + 2 * ITEM_SIZE
  const itemA = buildItem('S21_imgA', 'AMLCtrl_A3HB70XXX', 'S21', dataOffset, imageA.length)
  const itemB = buildItem('S19_imgB', 'AMLCtrl_ZXC197XX', 'S19', dataOffset + imageA.length, imageB.length)
  const header = Buffer.alloc(HEADER_SIZE)
  writeU32(header, 12, 2) // itemCount
  writeU32(header, 16, ITEM_SIZE)
  writeU32(header, 20, dataOffset)
  const container = Buffer.concat([header, itemA, itemB, imageA, imageB])
  const copy = Buffer.from(container)
  copy.fill(0, 24, 28)
  writeU32(container, 24, zlib.crc32(copy))

  const result = await instance.commands.get('updateFirmware')({
    firmware: {
      filename: 'antminer-combined.bin',
      encoding: 'base64',
      size: container.length,
      sha256: require('node:crypto').createHash('sha256').update(container).digest('hex'),
      data: container.toString('base64')
    }
  })
  t.is(result.success, true)
  t.alike(mock.state.firmwareData, imageA, 'only the slice for this control board is uploaded')
  t.is(result.filename, 'antminer-combined.bin')
  const upload = mock.requests.filter((r) => r.url === '/cgi-bin/upgrade.cgi').pop()
  const uploaded = upload.body
  t.ok(uploaded.includes('S21_imgA.bin'), 'extracted slice keeps the item name')

  // a container with no entry for this board must be refused
  const wrongBoard = Buffer.concat([
    header, itemB, imageB
  ])
  writeU32(wrongBoard, 12, 1)
  writeU32(wrongBoard, 20, HEADER_SIZE + ITEM_SIZE)
  writeU32(wrongBoard, 24, 0)
  const fixed = Buffer.from(wrongBoard)
  const fixedCopy = Buffer.from(fixed)
  fixedCopy.fill(0, 24, 28)
  writeU32(fixed, 24, zlib.crc32(fixedCopy))
  await t.exception(
    () => instance.commands.get('updateFirmware')({
      firmware: {
        filename: 'wrong-board.bin',
        encoding: 'base64',
        size: fixed.length,
        sha256: require('node:crypto').createHash('sha256').update(fixed).digest('hex'),
        data: fixed.toString('base64')
      }
    }),
    /ERR_FIRMWARE_NO_MATCHING_IMAGE/
  )
})

test('handlers - reboot enforces concurrency and cooldown after every attempt', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const instance = buildInstance({ port: address.port, deviceId: 'ant-reboot' })

  const first = instance.commands.get('reboot')()
  await t.exception(() => instance.commands.get('reboot')(), /ERR_COMMAND_IN_PROGRESS/)
  await first
  await t.exception(() => instance.commands.get('reboot')(), /ERR_COMMAND_COOLDOWN/)
})

test('handlers - a telemetry call against an unreachable device fails at call time', async (t) => {
  const instance = buildInstance({ port: 1, deviceId: 'ant-offline' })
  await t.exception.all(instance.telemetry.get('hashrate_rt')())
})

test('handlers - device instances are isolated', async (t) => {
  const mockA = createServer({ password: 'secret' })
  const mockB = createServer({ password: 'secret' })
  const [a, b] = await Promise.all([mockA.ready, mockB.ready])
  t.teardown(() => mockA.close())
  t.teardown(() => mockB.close())

  const instanceA = buildInstance({ port: a.port, deviceId: 'ant-a' })
  const instanceB = buildInstance({ port: b.port, deviceId: 'ant-b' })

  await instanceA.commands.get('setLED')({ enabled: true })
  t.is(mockA.state.blink, true)
  t.is(mockB.state.blink, false, 'a command on A never reaches B')

  const requestsToB = mockB.requests.filter((r) => r.url === '/cgi-bin/blink.cgi')
  t.is(requestsToB.length, 0)

  t.is(await instanceA.telemetry.get('pool_url')(), 'stratum+tcp://pool.example:3333')
  t.is(await instanceB.telemetry.get('pool_url')(), 'stratum+tcp://pool.example:3333')
})
