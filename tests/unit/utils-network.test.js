'use strict'

const test = require('brittle')
const normalizeNetworkConfig = require('../../lib/utils/network')

test('network config - accepts dhcp', (t) => {
  t.alike(normalizeNetworkConfig({ dhcp: true }), { dhcp: true })
})

test('network config - accepts a complete static configuration', (t) => {
  t.alike(
    normalizeNetworkConfig({
      dhcp: false,
      network: {
        ip: '192.168.1.50',
        netmask: '255.255.255.0',
        gateway: '192.168.1.1'
      },
      dns: '8.8.8.8 1.1.1.1'
    }),
    {
      dhcp: false,
      ip: '192.168.1.50',
      netmask: '255.255.255.0',
      gateway: '192.168.1.1',
      dns: '8.8.8.8 1.1.1.1'
    }
  )
})

test('network config - accepts mask alias and dns array', (t) => {
  const normalized = normalizeNetworkConfig({
    dhcp: false,
    ip: '10.0.0.20',
    mask: '255.0.0.0',
    gateway: '10.0.0.1',
    dns: ['8.8.4.4']
  })
  t.is(normalized.netmask, '255.0.0.0')
  t.is(normalized.dns, '8.8.4.4')
})

test('network config - rejects invalid shapes', (t) => {
  t.exception(() => normalizeNetworkConfig(), /ERR_NETWORK_CONFIG_INVALID/)
  t.exception(() => normalizeNetworkConfig('dhcp'), /ERR_NETWORK_CONFIG_INVALID/)
  t.exception(() => normalizeNetworkConfig([]), /ERR_NETWORK_CONFIG_INVALID/)
  t.exception(() => normalizeNetworkConfig({}), /ERR_NETWORK_CONFIG_INVALID/)
})

test('network config - rejects invalid addresses', (t) => {
  t.exception(() => normalizeNetworkConfig({
    dhcp: false,
    ip: '300.1.1.1',
    netmask: '255.255.255.0',
    gateway: '192.168.1.1',
    dns: '8.8.8.8'
  }), /ERR_NETWORK_ADDRESS_INVALID/)
  t.exception(() => normalizeNetworkConfig({
    dhcp: false,
    ip: '192.168.1.50',
    netmask: '255.255.255.0',
    gateway: '192.168.1.999',
    dns: '8.8.8.8'
  }), /ERR_NETWORK_ADDRESS_INVALID/)
  t.exception(() => normalizeNetworkConfig({
    dhcp: false,
    ip: '192.168.1.50',
    netmask: '255.255.255.0',
    gateway: '192.168.1.1',
    dns: []
  }), /ERR_NETWORK_ADDRESS_INVALID/)
})
