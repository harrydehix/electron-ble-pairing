<script setup lang="ts">
/**
 * App shell with two views:
 *  - scan view: scan controls + discovered device list
 *  - device view: details of the connected device (services/characteristics)
 * The pairing dialog overlays either view whenever the main process reports
 * a pending pairing request.
 */
import DeviceDetails from "./components/DeviceDetails.vue";
import DeviceList from "./components/DeviceList.vue";
import PairingDialog from "./components/PairingDialog.vue";
import { useBlePairing } from "./composables/useBlePairing";
import { useBleScan } from "./composables/useBleScan";

const { devices, scanning, connecting, connected, error, startScan, stopScan, select, disconnect } =
    useBleScan();
const { activeRequest, confirm, cancel } = useBlePairing();
</script>

<template>
    <main class="app">
        <!-- Device view: shown while connected. -->
        <template v-if="connected">
            <DeviceDetails :device="connected" @disconnect="disconnect" />
        </template>

        <!-- Scan view. -->
        <template v-else>
            <header class="header">
                <h1 class="title">BLE Devices</h1>
                <button
                    class="btn btn-primary"
                    :disabled="connecting"
                    @click="scanning ? stopScan() : startScan()"
                >
                    {{ scanning ? "Stop" : "Scan" }}
                </button>
            </header>

            <p v-if="error" class="error">{{ error }}</p>

            <p v-if="connecting" class="connecting">Connecting…</p>
            <DeviceList v-else :devices="devices" :scanning="scanning" @select="select" />
        </template>

        <!-- Custom pairing dialog, driven by useBlePairing. -->
        <PairingDialog v-if="activeRequest" :request="activeRequest" @confirm="confirm" @cancel="cancel" />
    </main>
</template>

<style scoped>
.app {
    max-width: 420px;
    margin: 0 auto;
    padding: 1.5rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.header {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.title {
    margin: 0;
    font-size: 1.3rem;
    font-weight: 700;
}

.error {
    margin: 0;
    padding: 0.6rem 0.8rem;
    border-radius: 8px;
    background: rgb(220 60 60 / 12%);
    color: #e05b5b;
    font-size: 0.85rem;
}

.connecting {
    margin: 2rem 0;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.9rem;
}
</style>
