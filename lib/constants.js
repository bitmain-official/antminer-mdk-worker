'use strict'

const STATUS = {
  OFFLINE: 'offline',
  SLEEPING: 'sleeping',
  MINING: 'mining',
  ERROR: 'error',
  NOT_MINING: 'not_mining'
}

const POWER_MODE = {
  NORMAL: 'normal',
  SLEEP: 'sleep',
  HIGH: 'high',
  LOW: 'low'
}

// bitmain-work-mode values reported by stats.cgi and written through set_miner_conf.cgi
const WORK_MODE = {
  NORMAL: 0,
  SLEEP: 1,
  HIGH: 2,
  LOW: 3
}

const WORK_MODE_TO_POWER_MODE = {
  [WORK_MODE.NORMAL]: POWER_MODE.NORMAL,
  [WORK_MODE.SLEEP]: POWER_MODE.SLEEP,
  [WORK_MODE.HIGH]: POWER_MODE.HIGH,
  [WORK_MODE.LOW]: POWER_MODE.LOW
}

const POWER_MODE_TO_WORK_MODE = {
  [POWER_MODE.NORMAL]: WORK_MODE.NORMAL,
  [POWER_MODE.SLEEP]: WORK_MODE.SLEEP,
  [POWER_MODE.HIGH]: WORK_MODE.HIGH,
  [POWER_MODE.LOW]: WORK_MODE.LOW
}

const ENDPOINTS = {
  SUMMARY: 'summary.cgi',
  STATS: 'stats.cgi',
  POOLS: 'pools.cgi',
  WARNING: 'warning.cgi',
  SYSTEM_INFO: 'get_system_info.cgi',
  MINER_TYPE: 'miner_type.cgi',
  MINER_CONF: 'get_miner_conf.cgi',
  ADJUSTMENT_PARAMS: 'get_adjustment_params.cgi',
  BLINK_STATUS: 'get_blink_status.cgi',
  DLOG: 'dlog.cgi',
  NETWORK_INFO: 'get_network_info.cgi',
  BLINK: 'blink.cgi',
  REBOOT: 'reboot.cgi',
  SET_MINER_CONF: 'set_miner_conf.cgi',
  SET_NETWORK: 'set_network_conf.cgi',
  CREATE_LOG_BACKUP: 'create_log_backup.cgi',
  UPGRADE: 'upgrade.cgi'
}

// result codes returned by the CGI command endpoints (stats: 'success' | 'error')
const RESULT_CODES = {
  MINER_CONF_OK: 'M000',
  // blink.cgi acknowledges with a state code: B000 when blinking starts,
  // B100 when it stops — standard across all Antminer firmware
  BLINK_STARTED: 'B000',
  BLINK_STOPPED: 'B100',
  NETWORK_OK: 'N000',
  LOG_OK: 'L000',
  UPGRADE_OK: 'U000'
}

const DEFAULTS = {
  PORT: 80,
  USERNAME: 'root',
  PASSWORD: 'root',
  TIMEOUT_MS: 10000,
  CACHE_MS: 5000,
  FIRMWARE_UPDATE_TIMEOUT_MS: 5 * 60 * 1000,
  // create_log_backup.cgi tar'ing the logs on the device takes well over the
  // generic TIMEOUT_MS (observed ~11s on an S21++); only the /log/ download
  // needs the full 5 minutes
  LOG_BACKUP_TIMEOUT_MS: 60 * 1000,
  LOG_DOWNLOAD_TIMEOUT_MS: 5 * 60 * 1000,
  MAX_FIRMWARE_SIZE: 64 * 1024 * 1024,
  MAX_LOG_SIZE: 64 * 1024 * 1024,
  REBOOT_COOLDOWN_MS: 5 * 60 * 1000,
  LED_AUTO_DISABLE_MS: 2 * 60 * 1000
}

// nominal efficiency (J/TH == W/TH) per device type; informational only,
// overridden by opts.nominalEfficiencyWThs on the device config.
// Values from shop.bitmain.com rated specs, on-sale + sold-out (2026-09).
// Keys follow the official product names: lowercased, cooler tag as suffix
// (_hyd/_imm), spaces removed except before form-factor tokens —
// 'S21 XP+ Hyd.' -> 'miner-am-s21xp+_hyd', 'S23e U2H' -> 'miner-am-s23e_u2h'
const DEFAULT_NOMINAL_EFFICIENCY_WTHS = {
  'miner-am-s19pro+_hyd': 27.5,
  'miner-am-s19exp_hyd': 22,
  'miner-am-s19jxp': 21.5,
  'miner-am-s19xp': 21.5,
  'miner-am-s19xp_hyd': 20.8,
  'miner-am-s19xp+_hyd': 19,
  'miner-am-t21': 19,
  'miner-am-s21': 17.5,
  'miner-am-s21e_hyd': 17,
  'miner-am-s21+': 16.5,
  'miner-am-s21++': 16.5,
  'miner-am-s21_hyd': 16,
  'miner-am-s21_imm': 16,
  'miner-am-s21+_hyd': 15,
  'miner-am-s21pro': 15,
  'miner-am-s21xp': 13.5,
  'miner-am-s21xp_imm': 13.5,
  'miner-am-s21exp_hyd': 13,
  'miner-am-u3s21exph': 13,
  'miner-am-s21jxp_hyd': 12,
  'miner-am-s21xp_hyd': 12,
  'miner-am-s21xp+_hyd': 11,
  'miner-am-s23': 11,
  'miner-am-s23e_u2h': 10,
  'miner-am-u3s23h': 9.5,
  'miner-am-s23_hyd': 9.5,
  'miner-am-s23xp_hyd': 8.9
}

// cminer reports rates in GH/s; the contract exposes TH/s
const toThs = (ghs) => Math.floor((Number(ghs) || 0) / 10) / 100

// Math.round, not Math.floor: (39.12 * 100) is 3911.9999999999995 in IEEE754,
// so floor truncates device values like 39.12 to 39.11
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100

module.exports = {
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
}
