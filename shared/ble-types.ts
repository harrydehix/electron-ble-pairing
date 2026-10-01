/**
 * Types shared between the Electron main process, the preload script and the
 * Vue renderer. Everything crossing the IPC boundary is defined here so both
 * sides agree on the exact shape of the messages.
 */

/**
 * The kind of pairing interaction the OS requests
 * (mirrors Electron's `BluetoothPairingHandlerHandlerDetails.pairingKind`):
 *
 *  - `confirm`:    the user only has to approve / deny the pairing.
 *  - `confirmPin`: a PIN is displayed and the user confirms it matches the
 *                  one shown on the peripheral.
 *  - `providePin`: the user must type the PIN shown on the peripheral.
 */
export type PairingKind = "confirm" | "confirmPin" | "providePin";

/** A pairing request forwarded from the main process to the renderer. */
export interface PairingRequest {
    /** Identifier of the device that wants to pair. */
    deviceId: string;
    /** Which pairing UI flow is required (see {@link PairingKind}). */
    pairingKind: PairingKind;
    /** The PIN to display. Only set when `pairingKind === 'confirmPin'`. */
    pin?: string;
}

/** The renderer's answer to a {@link PairingRequest}. */
export interface PairingResponse {
    /** `true` to accept the pairing, `false` to cancel it. */
    confirmed: boolean;
    /** The user-entered PIN. Required when `pairingKind === 'providePin'`. */
    pin?: string;
}

/** A BLE device discovered while a scan (`requestDevice`) is in progress. */
export interface DiscoveredDevice {
    deviceId: string;
    deviceName: string;
}

/**
 * The API the preload script exposes to the renderer as `window.bleApi`.
 * All functions returning `() => void` hand back an unsubscribe callback.
 */
export interface BleApi {
    /** Receive the (continuously updated) list of discovered devices. */
    onDeviceList(callback: (devices: DiscoveredDevice[]) => void): () => void;
    /** Resolve the pending scan by picking one of the discovered devices. */
    selectDevice(deviceId: string): void;
    /** Abort the pending scan without selecting a device. */
    cancelScan(): void;
    /** Receive pairing requests raised by the OS for this app. */
    onPairingRequest(callback: (request: PairingRequest) => void): () => void;
    /** Answer the currently pending pairing request. */
    respondToPairing(response: PairingResponse): void;
}

declare global {
    interface Window {
        /** Typed bridge to the Electron main process (see `electron/preload.ts`). */
        bleApi: BleApi;
    }
}
