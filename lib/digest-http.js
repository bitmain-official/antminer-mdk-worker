'use strict'

const crypto = require('node:crypto')
const fetch = require('node-fetch')
const { DEFAULTS } = require('./constants')

// Minimal RFC 7616 HTTP Digest client (qop=auth, MD5 / SHA-256 / SHA-512-256)
// replacing digest-fetch: that library computes the response with the
// constructor algorithm and ignores the algorithm offered by the challenge,
// so a SHA-256-only server rejects every answer hashed with MD5. Here the
// first response is always computed with the challenged algorithm.
//
// Contract kept identical to the previous implementation:
// - exactly one challenge round-trip per request when credentials are valid;
//   one extra round-trip only when the server rotates the nonce (stale=true)
// - failures surface as stable ERR_* codes; nothing is silently retried
//   except answering the 401 challenge itself.

const HASH_BY_ALGORITHM = {
  MD5: 'md5',
  'MD5-sess': 'md5',
  'SHA-256': 'sha256',
  'SHA-256-sess': 'sha256',
  'SHA-512-256': 'sha512-256',
  'SHA-512-256-sess': 'sha512-256'
}

// Normalize case and the missing-hyphen spelling some clients emit.
function normalizeAlgorithm (raw) {
  const compact = String(raw || '').toUpperCase().replace(/-/g, '')
  for (const canonical of Object.keys(HASH_BY_ALGORITHM)) {
    if (canonical.replace(/-/g, '') === compact) return canonical
  }
  return null
}

// RFC 7616 §3.1.1: MD5 hashes the ISO-8859-1 form; the SHA-2 variants hash UTF-8
function h (algorithm, str) {
  const encoding = algorithm.startsWith('MD5') ? 'latin1' : 'utf8'
  return crypto.createHash(HASH_BY_ALGORITHM[algorithm]).update(str, encoding).digest('hex')
}

// RFC 7616 §3.4: quoted-string params may escape `\"` and `\\`; tokens are bare.
function parseChallenge (header) {
  if (typeof header !== 'string' || !/^Digest\s/i.test(header)) return null
  const params = {}
  const re = /(\w+)=(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g
  let match
  while ((match = re.exec(header))) {
    params[match[1].toLowerCase()] = match[2] !== undefined
      ? match[2].replace(/\\(.)/g, '$1')
      : match[3]
  }
  return params
}

function randomHex (bytes) {
  return crypto.randomBytes(bytes).toString('hex')
}

class DigestHttpClient {
  constructor ({ username, password, timeout = DEFAULTS.TIMEOUT_MS }) {
    this.username = username
    this.password = password
    this.timeout = timeout
    // Last accepted challenge; reused across requests so subsequent calls
    // authenticate in a single round-trip, like a browser session.
    this.challenge = null
    this.nc = 0
    this.cnonce = null
    // Serializes the challenge handshake: concurrent first requests must not
    // each fetch their own 401 (the extra nc-less attempts would look like
    // replays to a strict server).
    this.handshake = Promise.resolve()
  }

  _authorization (method, uri, challenge) {
    const algorithm = normalizeAlgorithm(challenge.algorithm) || 'MD5'
    const qop = 'auth'
    this.cnonce = this.cnonce || randomHex(16)
    this.nc += 1
    const nc = this.nc.toString(16).padStart(8, '0')

    const { realm, nonce } = challenge
    let ha1 = h(algorithm, `${this.username}:${realm}:${this.password}`)
    if (algorithm.endsWith('-sess')) {
      ha1 = h(algorithm, `${ha1}:${nonce}:${this.cnonce}`)
    }
    const ha2 = h(algorithm, `${method}:${uri}`)
    const response = h(algorithm, `${ha1}:${nonce}:${nc}:${this.cnonce}:${qop}:${ha2}`)

    return `Digest username="${this.username}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop=${qop}, nc=${nc}, cnonce="${this.cnonce}", algorithm=${algorithm}, response="${response}"`
  }

  _rawFetch (url, opts, timeout) {
    return fetch(url, {
      method: opts.method,
      body: opts.body,
      headers: { ...(opts.headers || {}) },
      signal: AbortSignal.timeout(timeout)
    })
  }

  async request (url, opts = {}) {
    const timeout = opts.timeout || this.timeout
    const method = (opts.method || 'GET').toUpperCase()
    const uri = new URL(url).pathname + new URL(url).search

    const send = async (challenge) => {
      const headers = { ...(opts.headers || {}) }
      if (challenge) headers.authorization = this._authorization(method, uri, challenge)
      return this._rawFetch(url, { ...opts, method, headers }, timeout)
    }

    const attempt = async () => {
      let res
      try {
        res = await send(this.challenge)
        if (res.status === 401) {
          const challenge = parseChallenge(res.headers.get('www-authenticate'))
          // Retry only on a first challenge, or on stale=true (server rotated
          // the nonce; credentials already proven). A plain second 401 means
          // the credentials were rejected.
          const stale = challenge?.stale?.toLowerCase() === 'true'
          if (challenge && (!this.challenge || stale)) {
            await res.arrayBuffer().catch(() => {}) // drain before reuse
            if (this.challenge) {
              // the nonce rotated: nc is scoped per nonce (RFC 7616 §3.4),
              // so counting restarts at 1 for the new one
              this.nc = 0
              this.cnonce = null
            }
            this.challenge = challenge
            res = await send(challenge)
          }
        }
      } catch (err) {
        if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
          throw new Error(`ERR_HTTP_TIMEOUT: ${url}`)
        }
        throw new Error(`ERR_HTTP_CONNECTION: ${url} ${err.message}`)
      }
      if (res.status === 401) {
        // drop the session challenge so the next request starts clean
        this.challenge = null
        this.nc = 0
        this.cnonce = null
        throw new Error(`ERR_AUTH_FAILED: ${url}`)
      }
      return res
    }

    // Chain onto any in-flight handshake so parallel callers reuse the same
    // challenge and advance nc sequentially instead of racing for their own.
    const next = this.handshake.then(attempt, attempt)
    this.handshake = next.catch(() => {})
    return next
  }
}

module.exports = DigestHttpClient
