# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

This is a Node-RED node pack (`node-red-contrib-myhome-bticino-v2`) that lets Node-RED flows control BTicino/Legrand MyHome™ home-automation devices (lights, shutters, scenarios/CEN, thermostats, energy meters) over the proprietary SCS bus, via a gateway that speaks the OpenWebNet (OWN) protocol over TCP.

There is no build step, bundler, or test suite — this is plain CommonJS Node-RED node code, installed and run directly by Node-RED.

## Commands

There are no npm `scripts` defined (no build/test/start commands). Development commands available:

- `npx eslint .` — lint JS and HTML files (config in [eslint.config.js](eslint.config.js))
- `npx prettier --check .` / `npx prettier --write .` — check/apply formatting (config in [.prettierrc.js](.prettierrc.js))
- `npm publish` is done via CI ([.github/workflows/npm-publish.yml](.github/workflows/npm-publish.yml)), triggered on GitHub release publish — not run manually.

To manually exercise a node during development, install this package into a local Node-RED instance's `~/.node-red` (or link it) and import one of the flows in [examples/](examples/) via the Node-RED editor's Import dialog.

## Architecture

### One config node + one connection node + N device nodes

- **`myhome-gateway`** ([myhome-gateway.js](myhome-gateway.js)) is the Node-RED *config* node. It owns the single TCP `net.Socket` to the physical/virtual gateway (host/port/password), performs the OpenWebNet login handshake (open password or HMAC SHA-1/SHA-2), and auto-reconnects with backoff on error/close. Once connected, it parses incoming OWN frames, buckets them by "WHO" family (lighting=1, automation/shutters=2, temperature=4, CEN=15/CEN+=25, energy=18, other), and re-emits them as Node.js EventEmitter events (`OWN_LIGHTS`, `OWN_SHUTTERS`, `OWN_TEMPERATURE`, `OWN_SCENARIO`, `OWN_ENERGY`, `OWN_OTHERS`) that other nodes subscribe to via `RED.nodes.getNode(config.gateway)`.
- **Device nodes** (`myhome-light`, `myhome-shutter`, `myhome-scenario`, `myhome-thermo-central`, `myhome-thermo-zone`, `myhome-energy`) each reference a `myhome-gateway` config node and:
  1. Listen for the relevant `OWN_*` event and parse/track state in an in-memory `payloadInfo` object, emitting flow messages on change (with "SmartFilter" logic to suppress redundant output).
  2. Handle `input` messages from the flow (topic `cmd/<topic>` to send a command, `state/<topic>` for a read-only status refresh) by building an OpenWebNet command string and sending it through the gateway via `mhutils.executeCommand`.
  3. Register/deregister their event listeners via `mhutils.eventsMonitor`, and clean up on the node's `close` event.
- **`myhome-eventsession`** / **`myhome-commandsession`** are lower-level nodes: `eventsession` opens a raw monitoring session on the gateway to surface all matching bus frames as-is (used for discovery/monitoring flows); `commandsession` sends a raw OpenWebNet command string and returns the response(s), used by the "MH Inject" example flows.

### Shared logic: [myhome-utils.js](myhome-utils.js)

All nodes require this module rather than duplicating protocol logic:
- `processInitialConnection` — drives the connect/login state machine (`disconnected` → `handshake` → `authenticating[_HMAC[_HashSent]]` → `connected`), shared by both `myhome-gateway` (monitoring session) and `myhome-commandsession` (command session).
- `executeCommand` — opens a short-lived command-session TCP connection, sends one or more OWN commands in sequence (with optional inter-command delay), and collects ACK/NACK + responses per command.
- `eventsMonitor` — small class wrapping `EventEmitter` add/removeListener bookkeeping so device nodes can cleanly unsubscribe from the gateway's `OWN_*` events on node `close`.
- `buildSecondaryOutput` — builds each device node's second output message (boolean / text-state / arbitrary dotted-path property extraction) from the node's `payloadInfo`.
- `calcPass` / `calcHMAC` — implement BTicino's basic and HMAC (SHA-1/SHA-2) password hashing schemes for gateway authentication.
- `logNodeEvent` — routes debug/log/warn/error output through the calling node's own logger (`node.debug/log/warn/error`) at a configurable severity.

### Node pairing convention

Every runtime node `myhome-X.js` has a matching `myhome-X.html` (Node-RED editor UI: config form + help text, registered via `RED.nodes.registerType` in client-side JS) and is declared in the `node-red.nodes` map in [package.json](package.json). Both the `.js` and `.html` need updating together when a node's config fields change.

### Internationalization

Each node's HTML/JSON strings are localized under [locales/](locales/) — `en-US` (default), `fr`, `nl` — mirroring the root file names (e.g. `locales/fr/myhome-light.json`). When adding or changing user-facing strings in a `myhome-X.html`/`myhome-X.js`, update the corresponding keys in all three locale sets, not just `en-US`.

### BUS addressing

Device addresses use MyHome's `A/PL` (address/point-light) scheme encoded as a single string (`A=1,PL=5` → `"15"`; 4-digit form when A or PL > 9). Zone/light groups are prefixed with `#`, and non-default bus levels append `#4#<level>`. This encoding/decoding logic lives inline in each device node (see `node.lightgroupid` construction in [myhome-light.js](myhome-light.js) for the canonical pattern).
