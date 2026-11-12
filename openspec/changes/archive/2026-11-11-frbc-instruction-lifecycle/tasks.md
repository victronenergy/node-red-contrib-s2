## 1. Instruction lifecycle

- [x] 1.1 Confirmation closes all fulfilled open instructions (SUCCEEDED) and aborts older ones of that actuator
- [x] 1.2 Newer instruction for another mode of the same actuator aborts unconfirmed earlier ones
- [x] 1.3 Revoke after the instruction reached the flow: REVOKED plus a `Revoked` output message
- [x] 1.4 ABORTED on a switch to another control type and on overflow; nothing on session end
- [x] 1.5 Tests (`test/lib/frbc-controller.test.ts`), help text, CHANGELOG, S2 reference
