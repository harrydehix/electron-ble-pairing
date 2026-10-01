/**
 * Composable that tracks BLE pairing requests coming from the Electron main
 * process and lets the UI answer them.
 *
 * The main process registers a `setBluetoothPairingHandler`; whenever the OS
 * asks for pairing, the request is forwarded over IPC and surfaces here as a
 * reactive `activeRequest`. The UI shows a dialog for it and calls either
 * `confirm(pin?)` or `cancel()` to complete the pairing.
 */
import { onMounted, onUnmounted, readonly, ref, type Ref } from "vue";
import type { PairingRequest } from "../../shared/ble-types";

export interface UseBlePairing {
    /** The pairing request currently awaiting a user decision, or `null`. */
    activeRequest: Readonly<Ref<PairingRequest | null>>;
    /**
     * Accept the active pairing request.
     * @param pin The user-entered PIN — required for `pairingKind 'providePin'`,
     *            ignored for the other kinds.
     */
    confirm(pin?: string): void;
    /** Reject / abort the active pairing request. */
    cancel(): void;
}

export function useBlePairing(): UseBlePairing {
    const activeRequest = ref<PairingRequest | null>(null);

    let unsubscribe: (() => void) | undefined;

    onMounted(() => {
        // Each incoming request replaces the previous one; Electron only ever has
        // a single pairing in flight per window.
        unsubscribe = window.bleApi.onPairingRequest((request) => {
            activeRequest.value = request;
        });
    });

    onUnmounted(() => unsubscribe?.());

    function confirm(pin?: string): void {
        if (!activeRequest.value) return;
        window.bleApi.respondToPairing({ confirmed: true, pin });
        activeRequest.value = null;
    }

    function cancel(): void {
        if (!activeRequest.value) return;
        window.bleApi.respondToPairing({ confirmed: false });
        activeRequest.value = null;
    }

    return { activeRequest: readonly(activeRequest), confirm, cancel };
}
