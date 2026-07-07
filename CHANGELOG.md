# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.0]

### Added

- `s2-rm` node: S2 Resource Manager session handling (handshake, control type selection, instructions).
- `s2-rm-config` / `s2-cem-config` nodes for RM identity and CEM connection configuration.
- `s2-websocket` node: WebSocket transport to a CEM, with reconnect/backoff handling.
- Operation Mode Based Control (OMBC) and Power Envelope Based Control (PEBC) support.
- PowerMeasurement and PowerForecast forwarding.
- Multiple concurrent CEM sessions.
