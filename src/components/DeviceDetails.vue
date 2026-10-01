<script setup lang="ts">
/**
 * Detail view for the connected device: name, BLE address and all
 * discovered services with their characteristics and (readable) values.
 * The user can disconnect to return to the scan view.
 */
import type { ConnectedDeviceInfo } from "../composables/useBleScan";

defineProps<{
    device: ConnectedDeviceInfo;
}>();

const emit = defineEmits<{
    disconnect: [];
}>();
</script>

<template>
    <section class="details">
        <header class="details-header">
            <div>
                <h2 class="device-name">{{ device.name }}</h2>
                <p class="device-address">{{ device.address }}</p>
            </div>
            <button class="btn" @click="emit('disconnect')">Disconnect</button>
        </header>

        <p v-if="device.services.length === 0" class="empty">No accessible services found on this device.</p>

        <article v-for="service in device.services" :key="service.uuid" class="service">
            <h3 class="service-title">
                Service
                <code
                    style="
                        background: var(--surface-alt);
                        border-radius: 4px;
                        padding: 0.2rem;
                        display: inline-block;
                    "
                    >{{ service.uuid }}</code
                >
            </h3>

            <table v-if="service.characteristics.length > 0" class="char-table">
                <thead>
                    <tr>
                        <th>Characteristic</th>
                        <th>Properties</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="characteristic in service.characteristics" :key="characteristic.uuid">
                        <td class="uuid">{{ characteristic.uuid }}</td>
                        <td>
                            <div class="props">
                                <span v-for="prop in characteristic.properties" :key="prop" class="prop">
                                    {{ prop }}
                                </span>
                            </div>
                        </td>
                        <td class="value">{{ characteristic.value ?? "–" }}</td>
                    </tr>
                </tbody>
            </table>
        </article>
    </section>
</template>

<style scoped>
.details {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.details-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
}

.device-name {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
}

.device-address {
    margin: 0.15rem 0 0;
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    color: var(--text-muted);
}

.service {
    padding: 0.8rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.service-title {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

.uuid {
    margin: 0;
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    word-break: break-all;
}

.char-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
}

.char-table th {
    padding: 0.4rem 0.6rem;
    text-align: left;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
}

.char-table td {
    padding: 0.45rem 0.6rem;
    vertical-align: top;
    border-bottom: 1px solid var(--border);
}

.char-table tr:last-child td {
    border-bottom: none;
}

.char-table tr:nth-child(even) td {
    background: var(--surface-alt);
}

.props {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
}

.prop {
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
    font-size: 0.7rem;
    color: var(--text-muted);
}

.value {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    word-break: break-all;
}

.empty {
    margin: 2rem 0;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.9rem;
}
</style>
