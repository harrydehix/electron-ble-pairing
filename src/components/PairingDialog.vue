<script setup lang="ts">
/**
 * Modal dialog for answering a BLE pairing request.
 *
 * Adapts to the request's `pairingKind`:
 *  - `confirm`:    simple approve / cancel.
 *  - `confirmPin`: shows the PIN received from the OS; the user verifies it
 *                  matches the one displayed on the peripheral.
 *  - `providePin`: shows a PIN input the user must fill in.
 */
import { computed, ref, watch } from "vue";
import type { PairingRequest } from "../../shared/ble-types";

const props = defineProps<{
    /** The pairing request to display. */
    request: PairingRequest;
}>();

const emit = defineEmits<{
    /** User accepted; `pin` is only set for the `providePin` flow. */
    confirm: [pin?: string];
    /** User rejected / closed the dialog. */
    cancel: [];
}>();

/** PIN typed by the user (only used for the `providePin` flow). */
const enteredPin = ref("");

// Clear stale input whenever a new request is shown.
watch(
    () => props.request,
    () => (enteredPin.value = ""),
);

const title = computed(
    () =>
        ({
            confirm: "Confirm pairing",
            confirmPin: "Verify pairing code",
            providePin: "Enter pairing code",
        })[props.request.pairingKind],
);

const message = computed(
    () =>
        ({
            confirm: `“${props.request.deviceId}” wants to pair with this app.`,
            confirmPin: `Make sure this code matches the one shown on “${props.request.deviceId}”.`,
            providePin: `Enter the code displayed on “${props.request.deviceId}”.`,
        })[props.request.pairingKind],
);

/** The confirm button is disabled until a PIN is typed (providePin only). */
const canConfirm = computed(
    () => props.request.pairingKind !== "providePin" || enteredPin.value.trim() !== "",
);

function onConfirm(): void {
    if (!canConfirm.value) return;
    emit("confirm", props.request.pairingKind === "providePin" ? enteredPin.value.trim() : undefined);
}
</script>

<template>
    <!-- Backdrop: clicking it cancels, like pressing Escape would. -->
    <div class="backdrop" @click.self="emit('cancel')">
        <div class="dialog" role="dialog" aria-modal="true" :aria-label="title">
            <h2 class="dialog-title">{{ title }}</h2>
            <p class="dialog-message">{{ message }}</p>

            <!-- confirmPin: display the PIN prominently for visual comparison. -->
            <output v-if="request.pairingKind === 'confirmPin'" class="pin-display">
                {{ request.pin }}
            </output>

            <!-- providePin: let the user type the PIN. -->
            <input
                v-if="request.pairingKind === 'providePin'"
                v-model="enteredPin"
                class="pin-input"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                placeholder="Pairing code"
                autofocus
                @keyup.enter="onConfirm"
            />

            <div class="dialog-actions">
                <button class="btn" @click="emit('cancel')">Cancel</button>
                <button class="btn btn-primary" :disabled="!canConfirm" @click="onConfirm">Pair</button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.backdrop {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 45%);
    backdrop-filter: blur(2px);
}

.dialog {
    width: min(92vw, 360px);
    padding: 1.5rem;
    border-radius: 12px;
    background: var(--surface);
    box-shadow: 0 16px 48px rgb(0 0 0 / 30%);
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.dialog-title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
}

.dialog-message {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.9rem;
    line-height: 1.5;
}

.pin-display {
    align-self: center;
    padding: 0.5rem 1.25rem;
    border-radius: 8px;
    background: var(--surface-alt);
    font-size: 1.6rem;
    font-weight: 700;
    letter-spacing: 0.3em;
    font-variant-numeric: tabular-nums;
}

.pin-input {
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-alt);
    color: inherit;
    font-size: 1.1rem;
    letter-spacing: 0.2em;
    text-align: center;
}

.pin-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
}

.dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}
</style>
