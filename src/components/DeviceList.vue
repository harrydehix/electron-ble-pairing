<script setup lang="ts">
/**
 * List of discovered BLE devices. Clicking an entry selects the device,
 * which resolves the pending scan and starts connecting (and pairing).
 */
import type { DiscoveredDevice } from "../../shared/ble-types";

defineProps<{
    devices: readonly DiscoveredDevice[];
    /** While scanning, an empty list means "still searching" (not "none found"). */
    scanning: boolean;
}>();

const emit = defineEmits<{
    select: [deviceId: string];
}>();
</script>

<template>
    <ul v-if="devices.length > 0" class="device-list">
        <li v-for="device in devices" :key="device.deviceId">
            <button class="device" @click="emit('select', device.deviceId)">
                <span class="device-name">{{ device.deviceName }}</span>
                <span class="device-id">{{ device.deviceId }}</span>
            </button>
        </li>
    </ul>

    <p v-else-if="scanning" class="empty">Searching for devices…</p>
    <p v-else class="empty">No devices. Start a scan to discover nearby BLE devices.</p>
</template>

<style scoped>
.device-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.device {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition:
        border-color 0.15s,
        background 0.15s;
}

.device:hover {
    border-color: var(--accent);
    background: var(--surface-alt);
}

.device-name {
    font-weight: 600;
}

.device-id {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-family: ui-monospace, monospace;
}

.empty {
    margin: 2rem 0;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.9rem;
}
</style>
