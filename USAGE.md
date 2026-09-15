# Usage

Runtime reference for the Antminer MDK Worker: configuration, telemetry channels, commands, failure semantics, the mock device, and live testing.

All device I/O goes through the stock firmware HTTP CGI API with HTTP Digest authentication. Every request carries a finite timeout and no failure is retried silently — physical-write semantics (see [Failure semantics](#failure-semantics)).

## Configuration

Device `conf` fields (beyond the README's device config table):

| Field | Default | Description |
| --- | --- | --- |
| `conf.pools` | — | Pools used by `setupPools` when a command passes none: `[{ url, worker_name, worker_password }]`, max 3. |
| `conf.timeout` | `10000` | Per-request timeout in milliseconds. |
| `conf.firmwareUpdateTimeout` | `300000` | Firmware upload timeout. |
| `conf.maxFirmwareSize` | `67108864` | Maximum accepted firmware image size (64 MiB). |
| `conf.ledAutoDisableMs` | `120000` | Delay before an enabled locate LED is switched back off. `0` disables the timer. |

## Telemetry channels

Rates are reported by the firmware in GH/s and exposed here in TH/s. `jt` (J/TH) is exposed as W/TH — the units are numerically identical.

Core metrics: `hashrate_rt`, `hashrate_avg`, `hashrate_ideal`, `power`, `efficiency`, `temperature` (max chip temp across hashboards), `ambient_temp`, `fans` (array of `{ index, rpm }`), `status`, `uptime`, `power_mode`, `safe_mode`.

Pool and share data: `pools` (status and share counters; passwords are never included), `pool_url`, `accepted_shares`, `rejected_shares`.

Diagnostics: `hashboards` (per-board frequency, hashrate, ASIC status, temperature arrays, serial), `errors` (warnings from `warning.cgi` plus failing summary status sections, each with code/cause/suggestion), `device_info`, `firmware_info`, `miner_stats` (normalized summary + stats), `snap` (full stats + config aggregate with an error fallback).

## Commands

| Command | Parameters | Effect |
| --- | --- | --- |
| `reboot` | — | Restarts the controller; 2-3 minutes of downtime. 5-minute cooldown, consumed by every attempt. |
| `setLED` | `enabled: boolean` | Toggles the locate LED. Auto-disables after 2 minutes. |
| `setPowerMode` | `mode: normal \\| sleep \\| high \\| low` | Maps to `bitmain-work-mode` 0/1/2/3. `high`/`low` require HEM/LEM support. |
| `setHashratePercent` | `pct: number` | Maps to `bitmain-freq-level`; range validated against `get_adjustment_params.cgi`. |
| `setupPools` | `pools: array` (optional) | Up to 3 slots; unused slots preserve their existing entries. Falls back to `conf.pools`. |
| `setNetwork` | `network: object` | `dhcp: true`, or `dhcp: false` with `ip`/`netmask`/`gateway`/`dns`. The miner reboots afterwards. |
| `downloadLogs` | `dates: array` (optional) | Defaults to the latest available log date. Returns a Base64 `.tar` with size and SHA-256. |
| `updateFirmware` | `firmware: object` | Base64 image with `filename`, `size`, `sha256`, `data`. Configuration is preserved. |

Every configuration write (`setPowerMode`, `setHashratePercent`, `setupPools`) is a **read-modify-write**: the Worker fetches the full current config from `get_miner_conf.cgi`, merges its change, and posts the complete document. This is deliberate — firmware built before 2025-05-20 zeroes the pool list when `set_miner_conf.cgi` receives a partial update.

## Failure semantics

- **Never retry automatically**: `setNetwork`, `updateFirmware`, `reboot`, `setupPools` after a timeout, and `downloadLogs` mid-transfer. A timeout can mean the device accepted the command but the response was lost; retrying a physical write can duplicate or corrupt it. The stable codes `ERR_NETWORK_OUTCOME_UNKNOWN` and `ERR_FIRMWARE_OUTCOME_UNKNOWN` mark outcomes that must be verified on the device before any retry.
- **Cooldown**: `reboot` rejects with `ERR_COMMAND_COOLDOWN` within 5 minutes of any previous attempt (successful or not) and with `ERR_COMMAND_IN_PROGRESS` while one is in flight.
- **Unreachable devices** do not fail at load time: the Worker reports the device online and the failure surfaces inside the telemetry channel or command response that touched the network.
- Command results carry stable `ERR_*` codes; the full map is in [mdk-contract.json](mdk-contract.json) under `capabilities.errors`.

## Mock device

`npm run mock` starts a stateful fake on `127.0.0.1:14080` (override with `PORT`, `ANTMINER_USERNAME`, `ANTMINER_PASSWORD`). It enforces real digest authentication (including nonce-count replay rejection), serves every CGI endpoint in the firmware's exact response shape, applies command writes to its state, and records every request for the test suite's assertions.

## Live command testing

`scripts/test-live-commands.js` runs the commands against a real miner in safety tiers:

```bash
ANTMINER_PASSWORD='...' npm run test:live -- <ip> [port] [flags]
```

- **Safe tier (default)**: `setLED` on/off with readback verification, `setPowerMode` re-applying the current mode, `setHashratePercent` re-applying the current level, `setupPools` validation-negative only (a real pool write would overwrite passwords, which telemetry never exposes), and a full `downloadLogs` round trip.
- **`--with-reboot`**: reboots the miner and waits for recovery (2-3 minutes), then verifies the uptime reset.
- **`--pools '<json>'`**: performs a real `setupPools` write, e.g. `--pools '[{"url":"stratum+tcp://pool:3333","user":"w","pass":"x"}]'`.
- **`--with-network '<json>'`**: performs a real `setNetwork` write and exits immediately after — the connection drops and the miner reboots; verify reachability at the new address manually.
- **`--firmware <file>`**: uploads a real firmware image and reports the outcome; verify `firmware_info` after the miner reconnects.

Each step prints a JSON result line (`command`, `outcome`, `ms`). Any verification failure fails the run with a non-zero exit code. The environment variable `LIVE_MINER_IP` can replace the address argument (`npm run test:live` skips cleanly when neither is provided, so CI never needs hardware).
