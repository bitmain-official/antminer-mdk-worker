'use strict'

const port = Number(process.env.PORT || process.argv[2] || 14080)
const username = process.env.ANTMINER_USERNAME || 'root'
const password = process.env.ANTMINER_PASSWORD || 'root'
const { createServer } = require('../mock/cgi-server')

const mock = createServer({ host: '127.0.0.1', port, username, password })

mock.ready.then((address) => {
  console.log(`antminer mock listening on http://${address.address}:${address.port} (user ${username})`)
})

const shutdown = () => {
  mock.close().then(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
