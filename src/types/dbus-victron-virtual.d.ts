/**
 * Minimal type stubs for dbus-victron-virtual - covers only what
 * src/lib/transport/dbus.ts uses. No official types are published.
 */
declare module 'dbus-victron-virtual' {
  export interface VictronInterfaceHandle {
    emitS2Signal: ((name: 'Message' | 'Disconnect', args: unknown[]) => void) | undefined
    setValuesLocally: (changes: Record<string, unknown>) => void
    emitItemsChanged: () => void
  }

  export function addVictronInterfaces (
    bus: unknown,
    declaration: Record<string, unknown>,
    definition: Record<string, unknown>,
    addDefaults?: boolean,
    emitCallback?: ((name: string, args: unknown[]) => void) | null
  ): VictronInterfaceHandle

  export interface AddSettingsInput {
    path: string
    default: string | number
    type?: string
    min?: number
    max?: number
  }

  export function addSettings (bus: unknown, settings: AddSettingsInput[]): Promise<unknown>
}
