'use strict'

const { createServer } = require('./mock/cgi-server')

module.exports = {
  async setup () {
    const mock = createServer({ password: 'test' })
    const address = await mock.ready
    return {
      config: {
        address: '127.0.0.1',
        port: address.port,
        username: 'root',
        password: 'test'
      },
      commands: {
        setLED: { enabled: false },
        setPowerMode: { mode: 'normal' },
        setHashratePercent: { pct: 100 },
        setupPools: { pools: [{ url: 'stratum+tcp://pool.example:3333', worker_name: 'worker', worker_password: 'x' }] },
        setNetwork: { network: { dhcp: true } },
        downloadLogs: {}
      },
      teardown: () => mock.close()
    }
  }
}
