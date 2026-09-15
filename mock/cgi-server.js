'use strict'

const http = require('node:http')
const crypto = require('node:crypto')
const { parseAuthorization, expectedResponse } = require('./lib/digest-verify')

const REALM = 'antMiner Configuration'

function chain (index, overrides = {}) {
  return {
    index,
    freq_avg: 575,
    rate_ideal: 66.7,
    rate_real: 66.2,
    asic_num: 70,
    asic: 'o'.repeat(70),
    temp_pic: [45, 46],
    temp_pcb: [61, 64],
    temp_chip: [82, 91, 97],
    temp_in: [],
    temp_out: [],
    hw: 4,
    eeprom_loaded: true,
    sn: `AA000000000${index}`,
    hwp: 0.0014,
    eeprom_level: 7000,
    eeprom_vol: 1234,
    eeprom_freq: 575,
    eeprom_bin: 2,
    eeprom_ft: '20260101',
    tpl: [],
    ...overrides
  }
}

function DEFAULT_STATE () {
  return {
    summary: {
      elapsed: 1074,
      rate_5s: 198450,
      rate_30m: 200020,
      rate_avg: 199610,
      rate_ideal: 200000,
      rate_unit: 'GH/s',
      hw_all: 12,
      bestshare: 8391023,
      safe_mode: false,
      status: [
        { type: 'rate', status: 's', code: 0, msg: '' },
        { type: 'network', status: 's', code: 0, msg: '' },
        { type: 'fans', status: 's', code: 0, msg: '' },
        { type: 'temp', status: 's', code: 0, msg: '' }
      ]
    },
    stats: {
      elapsed: 1074,
      rate_5s: 198450,
      rate_30m: 200020,
      rate_avg: 199610,
      rate_ideal: 200000,
      rate_sale: 200000,
      rate_unit: 'GH/s',
      chain_num: 3,
      fan_num: 4,
      fan: [3960, 4020, 3980, 4010],
      hwp_total: 0.0043,
      'miner-mode': 0,
      'freq-level-mode': true,
      'freq-level-min': 50,
      'freq-level': 100,
      watt: 3420,
      jt: 17.1,
      ambient_temp: 32.5,
      chain: [chain(0), chain(1), chain(2)]
    },
    pools: [
      {
        index: 0,
        url: 'stratum+tcp://pool.example:3333',
        user: 'worker.1',
        status: 'Alive',
        priority: 0,
        getworks: 100,
        accepted: 8523,
        rejected: 41,
        discarded: 0,
        stale: 3,
        diff: '50000',
        diffa: 426150000,
        diffr: 2050000,
        diffs: 150000,
        lsdiff: '65536',
        lstime: '2026-09-15 10:00:00'
      },
      {
        index: 1,
        url: 'stratum+tcp://backup.example:3333',
        user: 'worker.1',
        status: 'Dead',
        priority: 1,
        getworks: 0,
        accepted: 0,
        rejected: 0,
        discarded: 0,
        stale: 0,
        diff: '50000',
        diffa: 0,
        diffr: 0,
        diffs: 0,
        lsdiff: '0',
        lstime: '1970-01-01 00:00:00'
      },
      {
        index: 2,
        url: '',
        user: '',
        status: 'Dead',
        priority: 2,
        getworks: 0,
        accepted: 0,
        rejected: 0,
        discarded: 0,
        stale: 0,
        diff: '50000',
        diffa: 0,
        diffr: 0,
        diffs: 0,
        lsdiff: '0',
        lstime: '1970-01-01 00:00:00'
      }
    ],
    warnings: [],
    systemInfo: {
      minertype: 'Antminer S21',
      nettype: 'DHCP',
      netdevice: 'eth0',
      macaddr: 'aa:bb:cc:dd:ee:ff',
      hostname: 'antminer',
      ipaddress: '192.168.1.99',
      netmask: '255.255.255.0',
      gateway: '192.168.1.1',
      dnsservers: '192.168.1.1',
      system_mode: 'GNU/Linux',
      system_kernel_version: '5.15.0',
      system_filesystem_version: 'FD-1.5(260901-S21)',
      firmware_type: 'Release',
      serinum: 'SN-MOCK-0001'
    },
    minerType: {
      miner_type: 'S21',
      subtype: 'AMLCtrl_A3HB70XXX',
      product_type: '',
      fw_version: '20260901.mock'
    },
    minerConf: {
      pools: [
        { url: 'stratum+tcp://pool.example:3333', user: 'worker.1', pass: 'x' },
        { url: 'stratum+tcp://backup.example:3333', user: 'worker.1', pass: 'x' },
        { url: '', user: '', pass: '' }
      ],
      'bitmain-user-ip-cat': false,
      'bitmain-fan-ctrl': false,
      'bitmain-fan-pwm': 100,
      'bitmain-freq': 575,
      'bitmain-voltage': 14,
      'bitmain-work-mode': 0,
      'bitmain-freq-level': 100,
      'bitmain-chip-temp-threshold': 95,
      'bitmain-drop-freq-scale': 100,
      'bitmain-power-off-delay': 0
    },
    adjustmentParams: {
      hashrate_percent_support: true,
      hashrate_percent_min: 50,
      hashrate_percent_max: 110,
      chip_temp_threshold_support: true,
      chip_temp_threshold_slider_min: 80,
      chip_temp_threshold_slider_max: 98,
      drop_freq_scale_support: true,
      drop_freq_scale_slider_min: 80,
      drop_freq_scale_slider_max: 100,
      power_off_delay_support: true,
      hem_mode: true,
      lem_mode: true
    },
    blink: false,
    // when set, blink.cgi replies with this code and leaves the state unchanged
    blinkErrorCode: null,
    networkInfo: {
      nettype: 'DHCP',
      netdevice: 'eth0',
      macaddr: 'aa:bb:cc:dd:ee:ff',
      ipaddress: '192.168.1.99',
      netmask: '255.255.255.0',
      conf_nettype: 'DHCP',
      conf_hostname: 'antminer',
      conf_ipaddress: '192.168.1.99',
      conf_netmask: '255.255.255.0',
      conf_gateway: '192.168.1.1',
      conf_dnsservers: '192.168.1.1'
    },
    dlog: { dlog: true, log_list: ['/2026/09/14', '/2026/09/15'] },
    logData: Buffer.from('mock Antminer diagnostic logs\n'),
    lastLogFilename: null,
    firmwareData: null,
    rebooting: false,
    networkRebooting: false
  }
}

function deepMerge (base, patch) {
  if (patch === undefined) return base
  if (Array.isArray(base) || Array.isArray(patch)) return patch
  if (base && typeof base === 'object' && patch && typeof patch === 'object') {
    const out = { ...base }
    for (const key of Object.keys(patch)) {
      out[key] = key in base ? deepMerge(base[key], patch[key]) : patch[key]
    }
    return out
  }
  return patch
}

function readBody (req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

function createServer (opts = {}) {
  const username = opts.username || 'root'
  const password = opts.password || 'root'
  // SHA-256 boards exist: the algorithm is part of the challenge
  const algorithm = opts.algorithm || 'MD5'
  const state = deepMerge(DEFAULT_STATE(), opts.state)
  const requests = []
  // nonce -> Set of consumed nc values. Set-based (not max-nc) because
  // browsers issue concurrent requests under one nonce whose nc values
  // arrive out of order — same rationale as webd's NonceStore.
  const nonces = new Map()
  const expiredNonces = new Set()

  const challenge = (res, stale = false) => {
    const nonce = crypto.randomBytes(8).toString('hex')
    nonces.set(nonce, new Set())
    res.writeHead(401, {
      'WWW-Authenticate':
        `Digest realm="${REALM}", qop="auth", nonce="${nonce}", opaque="${crypto.randomBytes(4).toString('hex')}", algorithm=${algorithm}, stale=${stale ? 'TRUE' : 'FALSE'}`
    })
    res.end()
  }

  // Test hook: invalidate every issued nonce so the next authorized request
  // gets a stale=TRUE re-challenge (mirrors webd's nonce TTL / restart).
  const expireNonces = () => {
    for (const nonce of nonces.keys()) expiredNonces.add(nonce)
    nonces.clear()
  }

  const verify = (req) => {
    const auth = parseAuthorization(req.headers.authorization)
    if (!auth || !auth.username || !auth.nonce || !auth.response) return false
    if (!nonces.has(auth.nonce)) return false
    const nc = parseInt(auth.nc || '0', 16)
    if (!Number.isFinite(nc) || nc === 0) return false
    // the board only accepts responses hashed with the challenged algorithm
    if ((auth.algorithm || 'MD5').toUpperCase() !== algorithm) return false
    const seen = nonces.get(auth.nonce)
    if (seen.has(nc)) return false
    const expected = expectedResponse(auth, { username, password, method: req.method })
    if (auth.response !== expected) return false
    seen.add(nc)
    return true
  }

  const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0]
    const authorized = verify(req)

    if (!authorized) {
      const auth = parseAuthorization(req.headers.authorization)
      // stale=TRUE only when the credentials hash verified but the nonce
      // expired — mirroring webd: a bad password gets a plain challenge
      const stale = (() => {
        if (!auth || auth.username !== username) return false
        if (!expiredNonces.has(auth.nonce)) return false
        const expected = expectedResponse(auth, { username, password, method: req.method })
        return auth.response === expected
      })()
      requests.push({ method: req.method, url, authorized: false })
      await readBody(req)
      return challenge(res, stale)
    }

    const body = await readBody(req)
    requests.push({
      method: req.method,
      url,
      authorized: true,
      authorization: req.headers.authorization,
      body: body.length ? body.toString() : undefined
    })

    const reply = (code, payload, headers) => {
      res.writeHead(code, headers)
      res.end(typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload))
    }

    const statusHeader = (msg) => ({
      STATUS: { STATUS: 'S', when: Math.floor(Date.now() / 1000), Msg: msg, api_version: '1.0.0' },
      INFO: {
        miner_version: 'cminer 1.0.0',
        CompileTime: state.systemInfo.system_filesystem_version,
        type: state.minerType.miner_type,
        miner_type_enum: 1
      }
    })

    if (req.method === 'GET' && url === '/cgi-bin/summary.cgi') {
      // models the new backend's cminer proxy failure: standalone control
      // board without cminer answers 502 + JSON error (see webd error.rs)
      if (opts.summaryDown) {
        return reply(502, { stats: 'error', code: 'C502', msg: 'cminer summary: connect timeout' })
      }
      return reply(200, { ...statusHeader('summary'), SUMMARY: [state.summary] })
    }
    if (req.method === 'GET' && url === '/cgi-bin/stats.cgi') {
      return reply(200, { ...statusHeader('stats'), STATS: [state.stats] })
    }
    if (req.method === 'GET' && url === '/cgi-bin/pools.cgi') {
      return reply(200, { ...statusHeader('pools'), POOLS: state.pools })
    }
    if (req.method === 'GET' && url === '/cgi-bin/warning.cgi') {
      return reply(200, { ...statusHeader('warning'), WARNING: state.warnings })
    }
    if (req.method === 'GET' && url === '/cgi-bin/get_system_info.cgi') {
      return reply(200, state.systemInfo)
    }
    if (req.method === 'GET' && url === '/cgi-bin/miner_type.cgi') {
      return reply(200, state.minerType)
    }
    if (req.method === 'GET' && url === '/cgi-bin/get_miner_conf.cgi') {
      return reply(200, state.minerConf)
    }
    if (req.method === 'GET' && url === '/cgi-bin/get_adjustment_params.cgi') {
      return reply(200, state.adjustmentParams)
    }
    if (req.method === 'GET' && url === '/cgi-bin/get_blink_status.cgi') {
      return reply(200, { blink: state.blink })
    }
    if (req.method === 'GET' && url === '/cgi-bin/dlog.cgi') {
      return reply(200, state.dlog)
    }
    if (req.method === 'GET' && url === '/cgi-bin/get_network_info.cgi') {
      return reply(200, state.networkInfo)
    }
    if (req.method === 'GET' && url === '/cgi-bin/reboot.cgi') {
      state.rebooting = true
      state.summary.elapsed = 0
      return reply(200, 'OK', { 'Content-Type': 'text/plain' })
    }

    if (req.method === 'POST' && url === '/cgi-bin/blink.cgi') {
      let parsed
      try { parsed = JSON.parse(body.toString() || '{}') } catch { return reply(200, { code: 'B001', msg: 'invalid json' }) }
      if (typeof parsed.blink !== 'boolean') return reply(200, { code: 'B001', msg: 'invalid blink' })
      if (state.blinkErrorCode) return reply(200, { code: state.blinkErrorCode, msg: '' })
      state.blink = parsed.blink
      // blink.cgi returns a state code: B000 when blinking starts, B100 when
      // it stops — standard across all Antminer firmware
      const code = parsed.blink ? 'B000' : 'B100'
      return reply(200, { code, msg: '' })
    }

    if (req.method === 'POST' && url === '/cgi-bin/set_miner_conf.cgi') {
      let parsed
      try { parsed = JSON.parse(body.toString()) } catch { return reply(200, { stats: 'error', code: 'M001', msg: 'Illegal request!' }) }
      if (parsed.pools !== undefined && (!Array.isArray(parsed.pools) || parsed.pools.length !== 3)) {
        return reply(200, { stats: 'error', code: 'M001', msg: 'invalid pools' })
      }
      if (parsed['bitmain-work-mode'] !== undefined && ![0, 1, 2, 3].includes(parsed['bitmain-work-mode'])) {
        return reply(200, { stats: 'error', code: 'M001', msg: 'invalid work mode' })
      }
      if (parsed['bitmain-user-ip-cat'] !== undefined && typeof parsed['bitmain-user-ip-cat'] !== 'boolean') {
        return reply(200, { stats: 'error', code: 'M001', msg: 'invalid user ip cat' })
      }
      Object.assign(state.minerConf, parsed)
      if (parsed['bitmain-work-mode'] !== undefined) state.stats['miner-mode'] = parsed['bitmain-work-mode']
      if (parsed['bitmain-freq-level'] !== undefined) state.stats['freq-level'] = parsed['bitmain-freq-level']
      return reply(200, { stats: 'success', code: 'M000', msg: 'OK!' })
    }

    if (req.method === 'POST' && url === '/cgi-bin/set_network_conf.cgi') {
      let parsed
      try { parsed = JSON.parse(body.toString() || '{}') } catch { parsed = {} }
      const valid = parsed.ipPro === '1' || parsed.ipPro === '2' ||
        parsed.ipPro === 1 || parsed.ipPro === 2
      if (!valid) return reply(200, { stats: 'error', code: 'N001', msg: 'invalid ipPro' })
      // the firmware validates the hostname (webd N001: "Hostname invalid!");
      // an empty ipHost is rejected
      if (typeof parsed.ipHost !== 'string' || !/^[A-Za-z]([A-Za-z0-9-]*[A-Za-z0-9])?$/.test(parsed.ipHost)) {
        return reply(200, { stats: 'error', code: 'N001', msg: 'Hostname invalid!' })
      }
      const dhcp = String(parsed.ipPro) === '1'
      state.networkInfo.conf_nettype = dhcp ? 'DHCP' : 'Static'
      if (parsed.ipHost) state.networkInfo.conf_hostname = parsed.ipHost
      if (!dhcp) {
        state.networkInfo.conf_ipaddress = parsed.ipAddress
        state.networkInfo.conf_netmask = parsed.ipSub
        state.networkInfo.conf_gateway = parsed.ipGateway
        state.networkInfo.conf_dnsservers = parsed.ipDns
      }
      state.networkRebooting = true
      return reply(200, { stats: 'success', code: 'N000', msg: 'OK!' })
    }

    if (req.method === 'POST' && url === '/cgi-bin/create_log_backup.cgi') {
      let dates
      try { dates = JSON.parse(body.toString()) } catch { dates = null }
      if (!Array.isArray(dates) || !dates.length || !dates.every((d) => state.dlog.log_list.includes(d))) {
        return reply(200, { stats: 'error', code: 'L001', msg: 'invalid dates' })
      }
      const filename = `antminer_log_${dates[dates.length - 1].replace(/\//g, '')}.tar`
      state.lastLogFilename = filename
      return reply(200, { stats: 'success', code: 'L000', msg: filename })
    }

    if (req.method === 'GET' && url.startsWith('/log/')) {
      const filename = url.slice('/log/'.length)
      if (filename !== state.lastLogFilename) return reply(404, 'not found', { 'Content-Type': 'text/plain' })
      return reply(200, state.logData, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(state.logData.length)
      })
    }

    if (req.method === 'POST' && url === '/cgi-bin/upgrade.cgi') {
      const contentType = req.headers['content-type'] || ''
      const match = /boundary=(?:"([^"]+)"|([^\s;]+))/.exec(contentType)
      if (!match || !body.length) return reply(200, { stats: 'error', code: 'U001', msg: 'no firmware file' })
      const boundary = `--${match[1] || match[2]}`
      const start = body.indexOf(boundary)
      const end = body.lastIndexOf(boundary)
      if (start === -1 || end <= start) return reply(200, { stats: 'error', code: 'U002', msg: 'malformed multipart' })
      const part = body.slice(start + boundary.length, end)
      const headerEnd = part.indexOf('\r\n\r\n')
      const fileContent = part.slice(headerEnd + 4).subarray(0, -2) // drop trailing \r\n
      state.firmwareData = fileContent
      state.minerType.fw_version = 'uploaded.mock'
      return reply(200, { stats: 'success', code: 'U000', msg: 'OK!' })
    }

    return reply(404, { error: 'ERR_NOT_FOUND' })
  })

  const ready = new Promise((resolve) => {
    server.listen(opts.port || 0, opts.host || '127.0.0.1', () => {
      resolve(server.address())
    })
  })

  const close = () => new Promise((resolve) => server.close(() => resolve()))

  return { server, state, requests, ready, close, expireNonces }
}

module.exports = { createServer, DEFAULT_STATE }
