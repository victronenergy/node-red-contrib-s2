/**
 * Minimal type stubs for dbus-native-victron - covers only what
 * src/lib/transport/dbus.ts uses. No official types are published.
 */
declare module 'dbus-native-victron' {
  export interface DBusConnection {
    on(event: 'connect' | 'end' | 'error', listener: (...args: unknown[]) => void): void
  }

  export interface DBusClient {
    connection: DBusConnection
    exportInterface(iface: unknown, path: string, ifaceDesc: unknown): void
    requestName(name: string, flags: number, callback: (err: Error | null, retCode: number) => void): void
    releaseName(name: string, callback: (err: Error | null) => void): void
  }

  export function createClient (
    opts: { busAddress: string, authMethods?: string[] },
    callback?: (err: Error | null) => void
  ): DBusClient

  export function sessionBus (opts: Record<string, unknown>, callback?: (err: Error | null) => void): DBusClient
  export function systemBus (opts: Record<string, unknown>, callback?: (err: Error | null) => void): DBusClient
}
