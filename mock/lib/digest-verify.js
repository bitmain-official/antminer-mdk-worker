'use strict'

const crypto = require('node:crypto')

const HASHES = {
  MD5: 'md5',
  'MD5-sess': 'md5',
  'SHA-256': 'sha256',
  'SHA-256-sess': 'sha256'
}

function hash (algorithm, str) {
  const h = HASHES[algorithm] || HASHES.MD5
  return crypto.createHash(h).update(str).digest('hex')
}

function parseAuthorization (header) {
  if (typeof header !== 'string' || !/^Digest\s/i.test(header)) return null
  const params = {}
  const re = /(\w+)=(?:"([^"]*)"|([^\s,]+))/g
  let match
  while ((match = re.exec(header))) {
    params[match[1].toLowerCase()] = match[2] !== undefined ? match[2] : match[3]
  }
  return params
}

// Expected digest response for the parsed Authorization params. Per RFC 2617
// the server verifies against the uri field carried in the header, so a
// mismatch here means rejected credentials regardless of the request path.
function expectedResponse (params, { username, password, method }) {
  const { realm, nonce, uri, algorithm } = params
  const algo = algorithm || 'MD5'
  let ha1 = hash(algo, `${username}:${realm}:${password}`)
  if (algo.endsWith('-sess')) {
    ha1 = hash(algo, `${ha1}:${nonce}:${params.cnonce}`)
  }
  const ha2 = hash(algo, `${method}:${uri}`)
  if (params.qop) {
    return hash(algo, `${ha1}:${nonce}:${params.nc}:${params.cnonce}:${params.qop}:${ha2}`)
  }
  return hash(algo, `${ha1}:${nonce}:${ha2}`)
}

module.exports = { md5: (str) => hash('MD5', str), parseAuthorization, expectedResponse }
