'use strict'

const crypto = require('node:crypto')
const debug = require('debug')('mdk:worker:antminer:api')
const DigestHttpClient = require('./digest-http')
const createLogDownloadResult = require('./utils/log-download')
const normalizeNetworkConfig = require('./utils/network')
const {
  STATUS,
  POWER_MODE,
  WORK_MODE,
  WORK_MODE_TO_POWER_MODE,
  POWER_MODE_TO_WORK_MODE,
  ENDPOINTS,
  RESULT_CODES,
  DEFAULTS,
  DEFAULT_NOMINAL_EFFICIENCY_WTHS,
  toThs,
  round2
} = require('./constants')

function computeStatus ({ warnings, summary, stats }) {
  if (Array.isArray(warnings) && warnings.length > 0) return STATUS.ERROR
  if (summary.status_sections.some((s) => s.status === 'e')) return STATUS.ERROR
  if (stats.work_mode === WORK_MODE.SLEEP) return STATUS.SLEEPING
  return (Number(summary.hashrate_rt_ghs) || 0) > 0 ? STATUS.MINING : STATUS.NOT_MINING
}

class AntminerApiClient {
  constructor (opts) {
    this.opts = {
      timeout: DEFAULTS.TIMEOUT_MS,
      username: DEFAULTS.USERNAME,
      password: DEFAULTS.PASSWORD,
      ...opts
    }
    this.conf = opts.conf || {}
    this.type = opts.type || 'miner-antminer'
    this.nominalEfficiencyWThs = opts.nominalEfficiencyWThs ||
      DEFAULT_NOMINAL_EFFICIENCY_WTHS[opts.type] || 0
    this.baseUrl = `http://${this.opts.address}:${this.opts.port || DEFAULTS.PORT}`
    this.http = new DigestHttpClient({
      username: this.opts.username,
      password: this.opts.password,
      timeout: this.opts.timeout
    })
    this.deviceDataCache = {}
    this.inFlight = new Map()
    this._lastSeen = null
  }

  updateLastSeen () {
    this._lastSeen = Date.now()
  }

  async close () {
    this.deviceDataCache = {}
  }

  async fetchDeviceData (fn, cacheTime = DEFAULTS.CACHE_MS) {
    const cached = this.deviceDataCache[fn.name]
    if (cached && cached.lastFetch >= Date.now() - cacheTime) {
      return cached.data
    }
    // Share one in-flight request between concurrent cold readers: a metrics
    // pull invokes every telemetry handler at once and must not fan one CGI
    // call per handler out onto the device.
    let pending = this.inFlight.get(fn.name)
    if (!pending) {
      pending = (async () => {
        try {
          const data = await fn.call(this)
          this.deviceDataCache[fn.name] = { data, lastFetch: Date.now() }
          return data
        } finally {
          this.inFlight.delete(fn.name)
        }
      })()
      this.inFlight.set(fn.name, pending)
    }
    return pending
  }

  _invalidateCache (...names) {
    // no names means the whole cache (used after a reboot)
    if (names.length === 0) {
      this.deviceDataCache = {}
      return
    }
    for (const name of names) delete this.deviceDataCache[name]
  }

  // Boards running the new web backend answer upstream failures with
  // {"stats":"error","code":"C502","msg":"..."}; legacy firmware answers
  // plain text. Either way the status and a body snippet make the failure
  // diagnosable instead of a bare ERR_API_RESPONSE_INVALID.
  _apiFailure (endpoint, res, raw, parsed) {
    const detail = (parsed && typeof parsed === 'object' && typeof parsed.msg === 'string' && parsed.msg) ||
      (raw || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    return new Error(`ERR_API_RESPONSE_INVALID: ${endpoint} ${res.status}${detail ? `: ${detail}` : ''}`)
  }

  async _getJson (endpoint) {
    const res = await this.http.request(`${this.baseUrl}/cgi-bin/${endpoint}`)
    this.updateLastSeen()
    let parsed
    let raw = ''
    try {
      raw = await res.text()
      parsed = JSON.parse(raw)
    } catch {
      parsed = undefined
    }
    if (parsed?.STATUS && typeof parsed.STATUS === 'object' && parsed.STATUS.STATUS === 'E') {
      throw new Error(`ERR_API_STATUS_ERROR: ${endpoint} ${parsed.STATUS.Msg || ''}`)
    }
    if (res.status !== 200 || parsed === undefined) {
      throw this._apiFailure(endpoint, res, raw, parsed)
    }
    return parsed
  }

  async _postJson (endpoint, body, timeout) {
    const res = await this.http.request(`${this.baseUrl}/cgi-bin/${endpoint}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      timeout
    })
    this.updateLastSeen()
    let parsed
    let raw = ''
    try {
      raw = await res.text()
      parsed = JSON.parse(raw)
    } catch {
      parsed = undefined
    }
    // a non-200 means the command was never processed upstream — surface it
    // instead of letting callers report ERR_COMMAND_FAILED: undefined
    if (res.status !== 200 || parsed === undefined) {
      throw this._apiFailure(endpoint, res, raw, parsed)
    }
    return parsed
  }

  // ---- reads ----

  async getVersion () {
    // summary only supplies optional display fields here, so its absence
    // (cminer down on a standalone control board → summary.cgi 502) must not
    // take down commands that never touch cminer (setLED, setNetwork, ...)
    const type = await this._getJson(ENDPOINTS.MINER_TYPE)
    const summary = await this._getJson(ENDPOINTS.SUMMARY).catch(() => null)
    return {
      platform: 'antminer',
      type: type.miner_type,
      subtype: type.subtype || '',
      productType: type.product_type || type.miner_type,
      firmware: type.fw_version,
      compileTime: summary?.INFO?.CompileTime || '',
      minerType: summary?.INFO?.type || type.miner_type,
      apiVersion: summary?.STATUS?.api_version || '1.0.0'
    }
  }

  async getSummary () {
    const raw = await this._getJson(ENDPOINTS.SUMMARY)
    const s = raw.SUMMARY?.[0]
    if (!s) throw new Error('ERR_API_RESPONSE_INVALID: summary')
    return {
      elapsed: s.elapsed,
      hashrate_rt_ghs: s.rate_5s,
      hashrate_30m_ghs: s.rate_30m,
      hashrate_avg_ghs: s.rate_avg,
      hashrate_ideal_ghs: s.rate_ideal,
      rate_unit: s.rate_unit,
      hw_errors: s.hw_all,
      bestshare: s.bestshare,
      safe_mode: s.safe_mode === true,
      status_sections: Array.isArray(s.status)
        ? s.status.map((x) => ({ type: x.type, status: x.status, code: x.code, msg: x.msg }))
        : [],
      api_version: raw.STATUS?.api_version,
      compile_time: raw.INFO?.CompileTime,
      type: raw.INFO?.type
    }
  }

  async getStats () {
    const raw = await this._getJson(ENDPOINTS.STATS)
    const s = raw.STATS?.[0]
    if (!s) throw new Error('ERR_API_RESPONSE_INVALID: stats')
    const hashboards = (Array.isArray(s.chain) ? s.chain : []).map((b) => ({
      index: b.index,
      freq_mhz: b.freq_avg,
      hashrate_ideal_ghs: b.rate_ideal,
      hashrate_real_ghs: b.rate_real,
      asic_num: b.asic_num,
      asic_ok: typeof b.asic === 'string' ? (b.asic.match(/o/g) || []).length : undefined,
      asic_status: b.asic,
      temp_pic: b.temp_pic || [],
      temp_pcb: b.temp_pcb || [],
      temp_chip: b.temp_chip || [],
      temp_in: b.temp_in || [],
      temp_out: b.temp_out || [],
      hw_errors: b.hw,
      serial: b.sn,
      hwp: b.hwp,
      eeprom_loaded: b.eeprom_loaded === true
    }))
    return {
      elapsed: s.elapsed,
      hashrate_rt_ghs: s.rate_5s,
      hashrate_30m_ghs: s.rate_30m,
      hashrate_avg_ghs: s.rate_avg,
      hashrate_ideal_ghs: s.rate_ideal,
      hashrate_sale_ghs: s.rate_sale,
      rate_unit: s.rate_unit,
      chain_num: s.chain_num,
      fan_num: s.fan_num,
      fans: Array.isArray(s.fan) ? s.fan.map((rpm, index) => ({ index, rpm })) : [],
      hwp_total: s.hwp_total,
      work_mode: s['miner-mode'],
      power_mode: WORK_MODE_TO_POWER_MODE[s['miner-mode']] || 'unknown',
      freq_level_mode: s['freq-level-mode'] === true,
      freq_level_min: s['freq-level-min'],
      freq_level: s['freq-level'],
      power_w: s.watt,
      efficiency_w_th: s.jt,
      // not every firmware reports an inlet sensor; null, not 0, means absent
      ambient_temp_c: s.ambient_temp === undefined ? null : s.ambient_temp,
      hashboards
    }
  }

  async getPools () {
    const raw = await this._getJson(ENDPOINTS.POOLS)
    const pools = Array.isArray(raw.POOLS) ? raw.POOLS : []
    // the CGI API never returns pool passwords
    return pools.map((p) => ({
      index: p.index,
      url: p.url,
      user: p.user,
      status: typeof p.status === 'string' ? p.status.toLowerCase() : 'unknown',
      priority: p.priority,
      getworks: p.getworks,
      accepted: p.accepted,
      rejected: p.rejected,
      discarded: p.discarded,
      stale: p.stale,
      diff: p.diff,
      difficulty_accepted: p.diffa,
      difficulty_rejected: p.diffr,
      difficulty_stale: p.diffs,
      last_share_difficulty: p.lsdiff,
      last_share_time: p.lstime
    }))
  }

  async getWarnings () {
    const raw = await this._getJson(ENDPOINTS.WARNING)
    const warnings = Array.isArray(raw.WARNING) ? raw.WARNING : []
    return warnings.map((w) => ({
      code: w.code,
      name: w.code,
      message: w.cause || w.code,
      cause: w.cause,
      suggestion: w.suggestion,
      timestamp: w.timestamp
    }))
  }

  async getSystemInfo () {
    const raw = await this._getJson(ENDPOINTS.SYSTEM_INFO)
    return {
      model: raw.minertype,
      nettype: raw.nettype,
      netdevice: raw.netdevice,
      mac: raw.macaddr,
      hostname: raw.hostname,
      ip: raw.ipaddress,
      netmask: raw.netmask,
      gateway: raw.gateway,
      dns: typeof raw.dnsservers === 'string'
        ? raw.dnsservers.split(',').map((x) => x.trim()).filter(Boolean)
        : [],
      system_mode: raw.system_mode,
      kernel_version: raw.system_kernel_version,
      filesystem_version: raw.system_filesystem_version,
      firmware_type: raw.firmware_type,
      serial_number: raw.serinum
    }
  }

  async getMinerConf () {
    const raw = await this._getJson(ENDPOINTS.MINER_CONF)
    // pool passwords are never published through telemetry
    return {
      pools: (Array.isArray(raw.pools) ? raw.pools : []).map((p) => ({ url: p.url, user: p.user })),
      'bitmain-user-ip-cat': raw['bitmain-user-ip-cat'],
      'bitmain-fan-ctrl': raw['bitmain-fan-ctrl'],
      'bitmain-fan-pwm': raw['bitmain-fan-pwm'],
      'bitmain-freq': raw['bitmain-freq'],
      'bitmain-voltage': raw['bitmain-voltage'],
      'bitmain-work-mode': raw['bitmain-work-mode'],
      'bitmain-freq-level': raw['bitmain-freq-level'],
      'bitmain-chip-temp-threshold': raw['bitmain-chip-temp-threshold'],
      'bitmain-drop-freq-scale': raw['bitmain-drop-freq-scale'],
      'bitmain-power-off-delay': raw['bitmain-power-off-delay']
    }
  }

  async getAdjustmentParams () {
    return this._getJson(ENDPOINTS.ADJUSTMENT_PARAMS)
  }

  async getBlinkStatus () {
    const raw = await this._getJson(ENDPOINTS.BLINK_STATUS)
    return { enabled: raw.blink === true }
  }

  async getDlog () {
    const raw = await this._getJson(ENDPOINTS.DLOG)
    return { enabled: raw.dlog === true, dates: Array.isArray(raw.log_list) ? raw.log_list : [] }
  }

  async getNetworkInfo () {
    return this._getJson(ENDPOINTS.NETWORK_INFO)
  }

  async getSnap () {
    try {
      const [summary, stats, pools, warnings, systemInfo, minerConf, blink, version] = await Promise.all([
        this.fetchDeviceData(this.getSummary),
        this.fetchDeviceData(this.getStats),
        this.fetchDeviceData(this.getPools),
        this.fetchDeviceData(this.getWarnings),
        this.fetchDeviceData(this.getSystemInfo),
        this.fetchDeviceData(this.getMinerConf),
        this.fetchDeviceData(this.getBlinkStatus),
        this.fetchDeviceData(this.getVersion)
      ])
      const chipTemps = stats.hashboards.flatMap((b) => b.temp_chip || [])
      const tempMax = chipTemps.length ? Math.max(...chipTemps) : 0
      const tempAvg = chipTemps.length
        ? round2(chipTemps.reduce((a, b) => a + b, 0) / chipTemps.length)
        : 0
      return {
        success: true,
        stats: {
          status: computeStatus({ warnings, summary, stats }),
          uptime_s: summary.elapsed,
          power_w: stats.power_w,
          efficiency_w_th: stats.efficiency_w_th,
          nominal_efficiency_w_th: this.nominalEfficiencyWThs,
          hashrate_ths: {
            rt: toThs(summary.hashrate_rt_ghs),
            avg: toThs(summary.hashrate_avg_ghs),
            ideal: toThs(summary.hashrate_ideal_ghs)
          },
          temperature_c: {
            ambient: stats.ambient_temp_c,
            max: tempMax,
            avg: tempAvg
          },
          fans: stats.fans,
          frequency_mhz: {
            avg: stats.hashboards.length
              ? round2(stats.hashboards.reduce((a, b) => a + (b.freq_mhz || 0), 0) / stats.hashboards.length)
              : 0,
            target: stats.freq_level
          },
          pool_status: pools.map((p) => ({
            pool: p.url,
            accepted: p.accepted,
            rejected: p.rejected,
            stale: p.stale
          })),
          hashboards: stats.hashboards
        },
        config: {
          network_config: {
            mode: String(systemInfo.nettype || '').toLowerCase() === 'dhcp' ? 'dhcp' : 'static',
            ip: systemInfo.ip,
            netmask: systemInfo.netmask,
            gateway: systemInfo.gateway,
            dns: systemInfo.dns
          },
          pool_config: minerConf.pools,
          user_ip_suffix: minerConf['bitmain-user-ip-cat'] === true,
          work_mode: stats.work_mode,
          power_mode: stats.power_mode,
          led_status: blink.enabled,
          firmware_ver: version.firmware
        }
      }
    } catch (err) {
      debug('snap failed: %s', err.message)
      return {
        success: false,
        stats: {
          status: STATUS.ERROR,
          errors: [{ msg: err.message, timestamp: new Date().toISOString() }]
        }
      }
    }
  }

  // ---- writes ----

  // Read-modify-write: always POSTs the full merged config. Firmware built
  // before 2025-05-20 zeroes the pool list when set_miner_conf.cgi receives
  // a partial update, so patch-style writes are not safe.
  async setMinerConf (patch) {
    const current = await this._getJson(ENDPOINTS.MINER_CONF)
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      throw new Error('ERR_MINER_CONF_READ_FAILED')
    }
    const next = { ...current, ...patch }
    const res = await this._postJson(ENDPOINTS.SET_MINER_CONF, next)
    if (res.code !== RESULT_CODES.MINER_CONF_OK) {
      return { success: false, error_msg: `ERR_MINER_CONF_WRITE_FAILED: ${res.code || res.stats}` }
    }
    this._invalidateCache('getMinerConf', 'getStats', 'getSummary', 'getPools', 'getVersion')
    return { success: true, code: res.code, msg: res.msg }
  }

  async reboot () {
    const res = await this.http.request(`${this.baseUrl}/cgi-bin/${ENDPOINTS.REBOOT}`)
    this.updateLastSeen()
    // drain the body so the keep-alive socket is released; the reply does not
    // say whether the reboot was accepted — that shows up as the device going
    // down, not in this response
    await res.arrayBuffer().catch(() => {})
    this._invalidateCache()
    return { success: true }
  }

  async setLED (enabled) {
    if (typeof enabled !== 'boolean') throw new Error('ERR_SET_LED_ENABLED_INVALID')
    const res = await this._postJson(ENDPOINTS.BLINK, { blink: enabled })
    // Per the Bitmain CGI API, blink.cgi returns a state code: B000 when
    // blinking starts, B100 when it stops — the code reflects the resulting
    // state, not success/failure of this particular request.
    const expectedCode = enabled ? RESULT_CODES.BLINK_STARTED : RESULT_CODES.BLINK_STOPPED
    let blink
    try {
      blink = (await this._getJson(ENDPOINTS.BLINK_STATUS)).blink === true
    } catch {
      // readback is best-effort
    }
    if (res.code !== expectedCode && blink !== enabled) {
      return { success: false, error_msg: `ERR_COMMAND_FAILED: ${res.code}` }
    }
    if (enabled) this._scheduleLedAutoOff()
    return { success: true, enabled, blink }
  }

  _scheduleLedAutoOff () {
    const delay = this.conf.ledAutoDisableMs !== undefined
      ? this.conf.ledAutoDisableMs
      : DEFAULTS.LED_AUTO_DISABLE_MS
    if (!delay) return
    const timer = setTimeout(() => {
      this.setLED(false).catch((err) => debug('led auto-off failed: %s', err.message))
    }, delay)
    timer.unref?.()
  }

  async setPowerMode (mode) {
    if (!Object.values(POWER_MODE).includes(mode)) {
      throw new Error('ERR_SET_POWER_MODE_INVALID')
    }
    if (mode === POWER_MODE.HIGH || mode === POWER_MODE.LOW) {
      const adj = await this.fetchDeviceData(this.getAdjustmentParams)
      if (mode === POWER_MODE.HIGH && !adj.hem_mode) {
        return { success: false, error_msg: 'ERR_POWER_MODE_NOT_SUPPORTED: high' }
      }
      if (mode === POWER_MODE.LOW && !adj.lem_mode) {
        return { success: false, error_msg: 'ERR_POWER_MODE_NOT_SUPPORTED: low' }
      }
    }
    return this.setMinerConf({ 'bitmain-work-mode': POWER_MODE_TO_WORK_MODE[mode] })
  }

  async setHashratePercent (pct) {
    if (typeof pct !== 'number' || !Number.isFinite(pct)) {
      throw new Error('ERR_INVALID_ARG_TYPE')
    }
    const adj = await this.fetchDeviceData(this.getAdjustmentParams)
    if (!adj.hashrate_percent_support) {
      return { success: false, error_msg: 'ERR_HASHRATE_PCT_NOT_SUPPORTED' }
    }
    const { hashrate_percent_min: min, hashrate_percent_max: max } = adj
    if ((Number.isFinite(min) && pct < min) || (Number.isFinite(max) && pct > max)) {
      return { success: false, error_msg: `ERR_HASHRATE_PCT_RANGE: ${pct} not in [${min}, ${max}]` }
    }
    return this.setMinerConf({ 'bitmain-freq-level': pct })
  }

  // bitmain-user-ip-cat: when enabled, cminer appends ".<ip with dots as X>"
  // to every pool worker name on startup (e.g. worker.192X168X1X99) so farms
  // can tell machines apart by their address in pool-side statistics.
  async setUserIpSuffix (enabled) {
    if (typeof enabled !== 'boolean') throw new Error('ERR_INVALID_ARG_TYPE')
    return this.setMinerConf({ 'bitmain-user-ip-cat': enabled })
  }

  async setPools (pools) {
    const current = await this._getJson(ENDPOINTS.MINER_CONF)
    const slots = (Array.isArray(current.pools) ? current.pools : []).slice(0, 3)
    while (slots.length < 3) slots.push({ url: '', user: '', pass: '' })
    const entries = Array.isArray(pools) ? pools : []
    // validation also covers the conf.pools path, which bypasses the handler
    const valid = entries.length > 0 && entries.length <= 3 && entries.every((pool) =>
      pool && typeof pool === 'object' &&
      typeof pool.url === 'string' && pool.url &&
      typeof (pool.user || pool.worker_name) === 'string')
    if (!valid) throw new Error('ERR_POOLS_INVALID')
    entries.forEach((pool, index) => {
      // keep the slot's existing password unless the caller supplies one:
      // pool passwords are never exposed through telemetry, so rewriting a
      // slot without a pass would otherwise silently wipe it
      slots[index] = {
        url: pool.url,
        user: pool.user || pool.worker_name || '',
        pass: pool.pass || pool.worker_password || slots[index].pass || ''
      }
    })
    return this.setMinerConf({ pools: slots })
  }

  async setupPools () {
    if (!Array.isArray(this.conf.pools) || this.conf.pools.length === 0) {
      throw new Error('ERR_POOLS_INVALID: no pools configured on this worker')
    }
    return this.setPools(this.conf.pools)
  }

  async setNetworkInformation (network) {
    const normalized = normalizeNetworkConfig(network)
    // The firmware rejects an empty hostname (N001), and the web UI always
    // resubmits the current one — mirror that: unspecified means "keep the
    // hostname the device already has".
    const explicit = network?.hostname || network?.network?.hostname
    let ipHost = explicit
    if (typeof ipHost !== 'string' || !ipHost) {
      const current = await this.fetchDeviceData(this.getNetworkInfo).catch(() => null)
      ipHost = current?.conf_hostname || 'Antminer'
    }
    const body = normalized.dhcp
      ? { ipPro: 1, ipHost }
      : {
          ipPro: 2,
          ipHost,
          ipAddress: normalized.ip,
          ipSub: normalized.netmask,
          ipGateway: normalized.gateway,
          ipDns: normalized.dns.replace(/\s+/g, ',')
        }
    let res
    try {
      res = await this._postJson(ENDPOINTS.SET_NETWORK, body)
    } catch (err) {
      if (/ERR_HTTP_(TIMEOUT|CONNECTION)/.test(err.message)) {
        throw new Error(`ERR_NETWORK_OUTCOME_UNKNOWN: ${err.message}`)
      }
      throw err
    }
    if (res.code !== RESULT_CODES.NETWORK_OK) {
      return { success: false, error_msg: `ERR_COMMAND_FAILED: ${res.code}${res.msg && res.msg !== 'OK!' ? `: ${res.msg}` : ''}` }
    }
    this._invalidateCache('getNetworkInfo')
    return { success: true, code: res.code }
  }

  async downloadLogs (dates) {
    let list = dates
    if (list === undefined) {
      const dlog = await this.fetchDeviceData(this.getDlog)
      list = dlog.enabled && dlog.dates.length ? [dlog.dates[dlog.dates.length - 1]] : []
    }
    if (!Array.isArray(list) || list.length === 0 || !list.every((d) => typeof d === 'string')) {
      throw new Error('ERR_LOG_DATES_INVALID')
    }
    const backup = await this._postJson(ENDPOINTS.CREATE_LOG_BACKUP, list, DEFAULTS.LOG_BACKUP_TIMEOUT_MS)
    if (backup.code !== RESULT_CODES.LOG_OK) {
      return { success: false, error_msg: `ERR_LOG_BACKUP_FAILED: ${backup.code}` }
    }
    const filename = backup.msg
    let res
    try {
      res = await this.http.request(`${this.baseUrl}/log/${filename}`, {
        timeout: DEFAULTS.LOG_DOWNLOAD_TIMEOUT_MS
      })
    } catch (err) {
      if (/ERR_HTTP_TIMEOUT/.test(err.message)) throw new Error(`ERR_LOG_DOWNLOAD_TIMEOUT: ${filename}`)
      throw new Error(`ERR_LOG_DOWNLOAD_CONNECTION: ${err.message}`)
    }
    if (res.status !== 200) throw new Error(`ERR_LOG_DOWNLOAD_RESPONSE_INVALID: ${res.status}`)
    const declared = parseInt(res.headers.get('content-length') || '0', 10)
    // reject an oversized archive before buffering it into memory
    if (declared > DEFAULTS.MAX_LOG_SIZE) throw new Error('ERR_LOG_DOWNLOAD_SIZE_INVALID')
    const bytes = Buffer.from(await res.arrayBuffer())
    if (declared && bytes.length !== declared) throw new Error('ERR_LOG_DOWNLOAD_INCOMPLETE')
    if (bytes.length > DEFAULTS.MAX_LOG_SIZE) throw new Error('ERR_LOG_DOWNLOAD_SIZE_INVALID')
    return createLogDownloadResult(bytes, filename)
  }

  async updateFirmware (content, filename) {
    // a crafted filename must not be able to escape the multipart part headers
    const safeName = String(filename).replace(/[\r\n"]+/g, '') || 'firmware.bin'
    const boundary = `----antminermdk${crypto.randomBytes(12).toString('hex')}`
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ])
    let res
    try {
      res = await this.http.request(`${this.baseUrl}/cgi-bin/${ENDPOINTS.UPGRADE}`, {
        method: 'POST',
        body,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        timeout: this.conf.firmwareUpdateTimeout || DEFAULTS.FIRMWARE_UPDATE_TIMEOUT_MS
      })
    } catch (err) {
      // the image may already have been transmitted: retrying could brick the miner
      if (/ERR_HTTP_(TIMEOUT|CONNECTION)/.test(err.message)) {
        throw new Error(`ERR_FIRMWARE_OUTCOME_UNKNOWN: ${err.message}`)
      }
      throw err
    }
    let parsed
    try {
      parsed = await res.json()
    } catch {
      parsed = null
    }
    if (!parsed || parsed.code !== RESULT_CODES.UPGRADE_OK) {
      return { success: false, error_msg: `ERR_FIRMWARE_UPDATE_FAILED: ${parsed?.code || res.status}` }
    }
    return {
      success: true,
      size: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      message: parsed.msg
    }
  }
}

module.exports = { AntminerApiClient, computeStatus }
