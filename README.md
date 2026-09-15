# Antminer MDK Worker

Bitmain Antminer Worker plugin for Tether MDK. The package is loaded directly from this directory by MDK's `WorkerRuntimeV2`; it does not bundle a Kernel or a process supervisor.

The Worker targets the stock firmware HTTP CGI web API:

| Transport | Default port | Authentication |
| --- | ---: | --- |
| HTTP CGI (`/cgi-bin/*.cgi`) | `80` | HTTP Digest, MD5 or SHA-256 (factory default `root`/`root`) |

Compatibility is based on the firmware API capabilities reported by `get_adjustment_params.cgi`, not on a fixed miner-model allowlist. Power modes `high`/`low` are only offered when the firmware reports HEM/LEM support.

Reference documentation for the stock firmware HTTP CGI API: <https://docs.bitmain.com/en/antminer/>

## Requirements

- Node.js 24 or newer
- A Tether MDK checkout containing `WorkerRuntimeV2`
- Network access from the Worker host to the miner's HTTP API port
- The miner's web credentials (override the factory defaults)

Until `@tetherto/mdk-worker` is published separately, follow Tether's `Test a Worker with MDK` guide to install the MDK monorepo and its core dependencies.

## Host the Worker

```js
'use strict'

const path = require('node:path')
const { WorkerRuntimeV2 } = require('@tetherto/mdk/backend/core/mdk-worker')

const runtime = new WorkerRuntimeV2(path.resolve('/path/to/antminer-mdk-worker'), {
  workerId: 'antminer-rack-1',
  devices: [{
    deviceId: 'ant-001',
    config: {
      address: '192.168.1.10',
      type: 'miner-am-s21xp_hyd', // device type tag — resolves rated J/TH, see below
      username: 'root',
      password: process.env.ANTMINER_PASSWORD
    }
  }]
})

await runtime.start()
```

Device configuration fields:

| Field | Required | Description |
| --- | --- | --- |
| `address` | Yes | Miner IPv4 address or hostname. `host` is accepted as an alias. |
| `username` | No | HTTP Digest username. Defaults to `root`. |
| `password` | No | HTTP Digest password. Defaults to `root` — override with the real credentials. |
| `port` | No | HTTP API port. Defaults to `80`. |
| `timeout` | No | Per-request timeout in milliseconds. Defaults to `10000`. |
| `type` | No | Device type tag such as `miner-am-s21xp_hyd` — official product name lowercased, cooler suffix `_hyd`/`_imm`, form-factor tokens joined with `_`. Resolves the rated J/TH (`snap` → `stats.nominal_efficiency_w_th`) from `DEFAULT_NOMINAL_EFFICIENCY_WTHS` in [lib/constants.js](lib/constants.js). |
| `nominalEfficiencyWThs` | No | Overrides the nominal efficiency table for `snap`. |
| `conf` | No | Configured pools (`conf.pools`), timeouts and size limits. See [USAGE.md](USAGE.md). |

See [USAGE.md](USAGE.md) and [mdk-contract.json](mdk-contract.json) for telemetry, command, and safety details.

## Test

With this repository and `mdk` checked out as sibling directories:

```bash
npm install
MDK_REPO=../mdk npm test
```

The test suite covers digest authentication, the mock device's CGI surface, client normalization and read-modify-write semantics, contract handler loading, and WorkerRuntimeV2 envelope dispatch.

Run the read-only live-device check without placing the password in the command line or repository:

```bash
ANTMINER_PASSWORD='your-password' node scripts/test-live-readonly.js 192.168.1.10
```

This script only requests telemetry. It does not invoke `set_miner_conf`, reboot, pool, network, or firmware commands.

Run every command against a live miner with a tiered safety model (safe commands by default; reboot, network changes, pool writes and firmware uploads behind explicit flags):

```bash
ANTMINER_PASSWORD='your-password' npm run test:live -- 192.168.1.10
ANTMINER_PASSWORD='your-password' npm run test:live -- 192.168.1.10 --with-reboot
```

See [USAGE.md](USAGE.md#live-command-testing) for the full flag reference.

## Mock device

Start the bundled mock for zero-hardware development:

```bash
npm run mock          # 127.0.0.1:14080, root/root
PORT=15080 ANTMINER_PASSWORD='custom' npm run mock
```

The mock enforces real digest authentication, serves every CGI endpoint the Worker uses, and mutates state for command endpoints — the same fixture the test suite runs against.
