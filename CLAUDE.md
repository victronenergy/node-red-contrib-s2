You are Claude Code acting as a senior, cautious software engineer.

You prioritize:
- Correctness over cleverness
- Safety over speed
- Minimal, well-justified changes
- Clear explanations when making recommendations

Assume this is a production system unless explicitly stated otherwise.

If instructions conflict, follow project-specific AI rules first.
If unsure, ask for clarification instead of guessing.


# Architecture Overview

## Project Summary
Node-RED nodes implementing the S2 energy management protocol (EN 50491-12-2).
Acts as the Resource Manager (RM) side of S2, connecting to a Customer Energy Manager (CEM).

Tech stack:
- Node-RED 3.0.2+
- S2 protocol over D-Bus (via `node-red-contrib-victron` virtual devices) and WebSocket
- `ws` for WebSocket transport

See `docs/S2_REFERENCE.md` for the S2 protocol and D-Bus interface reference.

## Architecture

**Transport layer (`src/lib/transport/`)**
- `websocket.js`: `S2WebSocketTransport` - thin EventEmitter wrapper around `ws` with auto-reconnect
- D-Bus transport is handled by `node-red-contrib-victron` acload virtual device; commands arrive as Node-RED messages

**Protocol layer (`src/lib/s2/`)**
- `messages.js`: Message type constants, factory functions, and JSON parsing
- `session.js`: `S2Session` - state machine managing one CEM connection (HANDSHAKING -> CONNECTED)
- `websocket.js`: (unused stub) future WebSocket-specific session wiring

**Node layer (`src/nodes/`)**
- `s2-rm/`: S2 Resource Manager - manages sessions for all connected CEMs; bridges D-Bus commands and S2 messages
- `s2-websocket/`: Stub, not yet implemented

## Key Data Flows

**D-Bus transport (current):**
```
acload port 2 -> s2-message-handling input
  { command: 'Connect',    cemId, keepAliveInterval }
  { command: 'Message',    cemId, message }
  { command: 'KeepAlive',  cemId }
  { command: 'Disconnect', cemId }

s2-message-handling port 1 -> acload input
  { payload: { s2Signal: 'Message', message: <S2 object> }, cemId }
```

**Session state machine (per CEM):**
```
Connect received -> S2Session.start() -> sends Handshake
HandshakeResponse received -> CONNECTED -> sends ResourceManagerDetails
SelectControlType received -> ack + sends OMBC.SystemDescription + OMBC.Status
Instructions received -> ack + forward downstream (port 2)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/s2/messages.js` | MessageType constants, factory functions, parse() |
| `src/lib/s2/session.js` | S2Session state machine, one instance per CEM |
| `src/lib/transport/websocket.js` | WebSocket transport (auto-reconnect) |
| `src/nodes/s2-rm/index.js` | Node-RED node, session map, command routing |
| `docs/S2_REFERENCE.md` | S2 protocol reference, message flows, links |


# Build, Test, and Development

## Commands

```bash
npm install
npm test          # lint + unit tests
npm run test:unit # jest only
npm run test:watch
npm run lint      # standard --fix src/
```

## Test location
Tests live in `test/`. Follow existing patterns. All new code needs tests (TDD).


# Coding & Contribution Style

- Follow existing code patterns (StandardJS style, enforced by `standard`)
- No semicolons, 2-space indent
- Prefer clarity over abstraction
- Comment complex logic
- Tests written before implementation

## Commit Style
- Conventional commits: feat, fix, docs, test, refactor, chore
- Subject line under 72 characters


# AI Rules (Must Be Followed)

- Never suggest working directly on the `master` branch.
- Do not refactor code unless explicitly requested.
- Do not remove backward compatibility.
- Do not change public APIs without explicit instruction.
- Do not skip tests.
- Assume this project is used in production environments.
- Prefer minimal diffs over large rewrites.
- Do not add comments that are copies of the code adjacent to it.
- Only add tests that actually test the unit under test.
- Never add AI attribution text to git commits.
- Replace all '--' signs with '-'. Replace all '->' signs with '->'.

Before making any change to the S2 message flow or session state machine,
re-read `docs/S2_REFERENCE.md` to verify the change is spec-compliant.
