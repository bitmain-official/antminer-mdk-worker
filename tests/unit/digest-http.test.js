'use strict'

const test = require('brittle')
const DigestHttpClient = require('../../lib/digest-http')
const { createServer } = require('../../mock/cgi-server')

test('digest-http - computes the RFC 7616 §3.9.1 SHA-256 vector', (t) => {
  const client = new DigestHttpClient({ username: 'Mufasa', password: 'Circle of Life' })
  client.cnonce = 'f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ'
  const header = client._authorization('GET', '/dir/index.html', {
    realm: 'http-auth@example.org',
    nonce: '7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v',
    algorithm: 'SHA-256'
  })
  t.ok(header.includes('algorithm=SHA-256'))
  t.ok(header.includes('response="753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1"'),
    'response matches the RFC 7616 SHA-256 example')
})

test('digest-http - computes the RFC 2617 §3.5 MD5 vector', (t) => {
  const client = new DigestHttpClient({ username: 'Mufasa', password: 'Circle Of Life' })
  client.cnonce = '0a4f113b'
  const header = client._authorization('GET', '/dir/index.html', {
    realm: 'testrealm@host.com',
    nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
    algorithm: 'MD5'
  })
  t.ok(header.includes('nc=00000001'))
  t.ok(header.includes('response="6629fae49393a05397450978507c4ef1"'),
    'response matches the RFC 2617 MD5 example')
})

test('digest-http - accepts case and hyphen variants of the algorithm token', (t) => {
  const client = new DigestHttpClient({ username: 'u', password: 'p' })
  for (const raw of ['sha-256', 'SHA256', 'Sha-256', 'SHA-256']) {
    const header = client._authorization('GET', '/', { realm: 'r', nonce: 'n', algorithm: raw })
    t.ok(header.includes('algorithm=SHA-256'), `algorithm=${raw} normalizes to SHA-256`)
  }
})

test('digest-http - negotiates digest auth and returns the response', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const http = new DigestHttpClient({ username: 'root', password: 'secret' })
  const res = await http.request(`http://127.0.0.1:${address.port}/cgi-bin/get_blink_status.cgi`)
  t.is(res.status, 200)
  const body = await res.json()
  t.alike(body, { blink: false })
})

test('digest-http - rejected credentials surface as ERR_AUTH_FAILED', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const http = new DigestHttpClient({ username: 'root', password: 'wrong' })
  await t.exception(
    () => http.request(`http://127.0.0.1:${address.port}/cgi-bin/get_blink_status.cgi`),
    /ERR_AUTH_FAILED/
  )
})

test('digest-http - timeouts surface as ERR_HTTP_TIMEOUT', async (t) => {
  // a server that accepts the connection but never responds
  const http = require('node:http')
  const hanging = http.createServer(() => {})
  await new Promise((resolve) => hanging.listen(0, '127.0.0.1', resolve))
  const port = hanging.address().port
  t.teardown(() => new Promise((resolve) => hanging.close(() => resolve())))

  const client = new DigestHttpClient({ username: 'root', password: 'secret', timeout: 50 })
  await t.exception(
    () => client.request(`http://127.0.0.1:${port}/cgi-bin/summary.cgi`),
    /ERR_HTTP_TIMEOUT/
  )
})

test('digest-http - connection failures surface as ERR_HTTP_CONNECTION', async (t) => {
  const http = new DigestHttpClient({ username: 'root', password: 'secret' })
  await t.exception(
    () => http.request('http://127.0.0.1:1/cgi-bin/summary.cgi'),
    /ERR_HTTP_CONNECTION/
  )
})

test('digest-http - posts carry the body through the digest handshake', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const http = new DigestHttpClient({ username: 'root', password: 'secret' })
  const res = await http.request(`http://127.0.0.1:${address.port}/cgi-bin/blink.cgi`, {
    method: 'POST',
    body: JSON.stringify({ blink: true }),
    headers: { 'content-type': 'application/json' }
  })
  t.is(res.status, 200)
  const body = await res.json()
  t.is(body.code, 'B000')
  t.is(mock.state.blink, true)
})

test('digest-http - negotiates SHA-256 digest challenges transparently', async (t) => {
  const mock = createServer({ password: 'secret', algorithm: 'SHA-256' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  // a SHA-256-only server: the first response must already be hashed with
  // SHA-256 (no wasted MD5 round-trip), authenticating in one challenge
  const http = new DigestHttpClient({ username: 'root', password: 'secret' })
  const res = await http.request(`http://127.0.0.1:${address.port}/cgi-bin/get_blink_status.cgi`)
  t.is(res.status, 200)
  t.alike(await res.json(), { blink: false })
  const requests = mock.requests.filter((r) => r.url === '/cgi-bin/get_blink_status.cgi')
  t.is(requests.filter((r) => r.authorized).length, 1, 'exactly one authorized request')
})

test('digest-http - SHA-256 POSTs carry the body and wrong passwords still fail', async (t) => {
  const mock = createServer({ password: 'secret', algorithm: 'SHA-256' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const http = new DigestHttpClient({ username: 'root', password: 'secret' })
  const res = await http.request(`http://127.0.0.1:${address.port}/cgi-bin/blink.cgi`, {
    method: 'POST',
    body: JSON.stringify({ blink: true }),
    headers: { 'content-type': 'application/json' }
  })
  t.is(res.status, 200)
  t.is(mock.state.blink, true)

  const bad = new DigestHttpClient({ username: 'root', password: 'wrong' })
  await t.exception(
    () => bad.request(`http://127.0.0.1:${address.port}/cgi-bin/get_blink_status.cgi`),
    /ERR_AUTH_FAILED/
  )
})

test('digest-http - a rotated nonce (stale=TRUE) is re-answered transparently', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const http = new DigestHttpClient({ username: 'root', password: 'secret' })
  const res1 = await http.request(`http://127.0.0.1:${address.port}/cgi-bin/get_blink_status.cgi`)
  t.is(res1.status, 200)

  // simulate webd's nonce TTL / restart: every issued nonce becomes invalid
  mock.expireNonces()

  const res2 = await http.request(`http://127.0.0.1:${address.port}/cgi-bin/get_blink_status.cgi`)
  t.is(res2.status, 200, 'client re-answers the stale challenge without surfacing an error')
  t.alike(await res2.json(), { blink: false })
  const authorized = mock.requests.filter((r) => r.url === '/cgi-bin/get_blink_status.cgi' && r.authorized)
  t.is(authorized.length, 2, 'first request + one re-authorized request after rotation')
  t.ok(/nc=00000001/.test(authorized[1].authorization), 'nc restarts at 1 for the new nonce (RFC 7616 §3.4)')
})

test('digest-http - concurrent requests under one nonce all authenticate', async (t) => {
  const mock = createServer({ password: 'secret' })
  const address = await mock.ready
  t.teardown(() => mock.close())

  const http = new DigestHttpClient({ username: 'root', password: 'secret' })
  const paths = ['summary.cgi', 'stats.cgi', 'pools.cgi', 'warning.cgi', 'miner_type.cgi']
  const responses = await Promise.all(paths.map((p) =>
    http.request(`http://127.0.0.1:${address.port}/cgi-bin/${p}`)
  ))
  t.ok(responses.every((r) => r.status === 200), 'out-of-order nc arrivals must not cause 401s')
})
