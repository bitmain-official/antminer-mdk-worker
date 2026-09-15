'use strict'

const test = require('brittle')
const http = require('node:http')
const { createServer, DEFAULT_STATE } = require('../../mock/cgi-server')
const DigestHttpClient = require('../../lib/digest-http')

function get (port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    }).on('error', reject)
  })
}

test('mock server - rejects unauthenticated requests with a digest challenge', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const res = await get(address.port, '/cgi-bin/summary.cgi')
  t.is(res.status, 401)
  const challenge = res.headers['www-authenticate']
  t.ok(/Digest/.test(challenge))
  t.ok(/realm="antMiner Configuration"/.test(challenge))
  t.ok(/qop="auth"/.test(challenge))
  t.ok(/nonce="/.test(challenge))
})

test('mock server - serves every read endpoint in the firmware shape', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const unauthRes = await fetch(`http://127.0.0.1:${address.port}/cgi-bin/summary.cgi`)
  // no credentials: still the challenge, proving auth is enforced per endpoint
  t.is(unauthRes.status, 401)

  const client = new DigestHttpClient({ username: 'root', password: 'secret' })
  const authorized = async (path) => (await client.request(`http://127.0.0.1:${address.port}${path}`)).json()

  const s = await authorized('/cgi-bin/summary.cgi')
  t.is(s.STATUS.STATUS, 'S')
  t.is(s.SUMMARY[0].rate_unit, 'GH/s')
  t.is(typeof s.SUMMARY[0].rate_5s, 'number')
  t.is(s.SUMMARY[0].status.length, 4)

  const st = await authorized('/cgi-bin/stats.cgi')
  t.is(st.STATS[0].chain_num, 3)
  t.is(st.STATS[0].chain.length, 3)
  t.is(st.STATS[0].fan.length, 4)
  t.is(typeof st.STATS[0].watt, 'number')

  const pools = await authorized('/cgi-bin/pools.cgi')
  t.is(pools.POOLS.length, 3)
  t.is(pools.POOLS[0].status, 'Alive')

  const warnings = await authorized('/cgi-bin/warning.cgi')
  t.alike(warnings.WARNING, [])

  const systemInfo = await authorized('/cgi-bin/get_system_info.cgi')
  t.is(systemInfo.minertype, 'Antminer S21')
  t.is(systemInfo.serinum, 'SN-MOCK-0001')

  const minerType = await authorized('/cgi-bin/miner_type.cgi')
  t.is(minerType.miner_type, 'S21')

  const conf = await authorized('/cgi-bin/get_miner_conf.cgi')
  t.is(conf.pools.length, 3)
  t.is(conf['bitmain-work-mode'], 0)

  const adj = await authorized('/cgi-bin/get_adjustment_params.cgi')
  t.is(adj.hashrate_percent_support, true)
  t.is(adj.hem_mode, true)
  t.is(adj.lem_mode, true)

  const blink = await authorized('/cgi-bin/get_blink_status.cgi')
  t.alike(blink, { blink: false })

  const dlog = await authorized('/cgi-bin/dlog.cgi')
  t.alike(dlog, { dlog: true, log_list: ['/2026/09/14', '/2026/09/15'] })

  const network = await authorized('/cgi-bin/get_network_info.cgi')
  t.ok(network.conf_gateway, 'conf_* fields present')
  t.is(network.netdevice, 'eth0')
})

test('mock server - set_miner_conf merges and rejects invalid pools', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const client = new DigestHttpClient({ username: 'root', password: 'secret' })
  const post = async (path, body) => {
    const res = await client.request(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' }
    })
    return { status: res.status, body: await res.json() }
  }

  const bad = await post('/cgi-bin/set_miner_conf.cgi', { pools: [{ url: 'x' }] })
  t.is(bad.body.stats, 'error')
  t.is(bad.body.code, 'M001')

  const good = await post('/cgi-bin/set_miner_conf.cgi', {
    pools: [
      { url: 'stratum+tcp://new.example:3333', user: 'w', pass: 'x' },
      { url: '', user: '', pass: '' },
      { url: '', user: '', pass: '' }
    ],
    'bitmain-work-mode': 1
  })
  t.is(good.body.stats, 'success')
  t.is(good.body.code, 'M000')
  t.is(mock.state.minerConf['bitmain-work-mode'], 1)
  t.is(mock.state.minerConf.pools[0].url, 'stratum+tcp://new.example:3333')
  t.is(mock.state.stats['miner-mode'], 1)
})

test('mock server - log backup validates dates and serves the archive', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const client = new DigestHttpClient({ username: 'root', password: 'secret' })

  const bad = await client.request(`http://127.0.0.1:${address.port}/cgi-bin/create_log_backup.cgi`, {
    method: 'POST',
    body: JSON.stringify(['/2020/01/01'])
  })
  t.is((await bad.json()).code, 'L001')

  const good = await client.request(`http://127.0.0.1:${address.port}/cgi-bin/create_log_backup.cgi`, {
    method: 'POST',
    body: JSON.stringify(['/2026/09/15'])
  })
  const result = await good.json()
  t.is(result.code, 'L000')
  t.is(result.msg, 'antminer_log_20260915.tar')

  const archive = await client.request(`http://127.0.0.1:${address.port}/log/${result.msg}`)
  const bytes = Buffer.from(await archive.arrayBuffer())
  t.alike(bytes, mock.state.logData)
})

test('mock server - tracks requests for assertions', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const client = new DigestHttpClient({ username: 'root', password: 'secret' })
  await client.request(`http://127.0.0.1:${address.port}/cgi-bin/summary.cgi`)

  const unauthenticated = mock.requests.filter((r) => !r.authorized).length
  const authorized = mock.requests.filter((r) => r.authorized && r.url === '/cgi-bin/summary.cgi')
  t.is(unauthenticated, 1, 'the 401 probe is recorded')
  t.is(authorized.length, 1)
})

test('mock server - state option deep-merges overrides', async (t) => {
  const mock = createServer({
    password: 'secret',
    state: {
      adjustmentParams: { hem_mode: false },
      stats: { watt: 5000, chain: [DEFAULT_STATE().stats.chain[0]] }
    }
  })
  await mock.ready
  t.teardown(() => mock.close())

  t.is(mock.state.adjustmentParams.hem_mode, false)
  t.is(mock.state.adjustmentParams.lem_mode, true, 'unpatched fields keep defaults')
  t.is(mock.state.stats.watt, 5000)
  t.is(mock.state.stats.chain.length, 1)
  t.is(mock.state.summary.elapsed, 1074, 'unpatched sections keep defaults')
})
