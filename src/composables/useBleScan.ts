/**
 * Composable that drives BLE device scanning and the GATT connection.
 *
 * Scanning: calling `navigator.bluetooth.requestDevice()` in the renderer
 * makes Chromium start a scan and repeatedly fire `select-bluetooth-device`
 * in the main process with the devices found so far. The main process
 * forwards that list over IPC (received here via `onDeviceList`) and keeps
 * the selection callback open until we either pick a device (`select`) or
 * abort (`stopScan`).
 *
 * Connecting: once a device is picked, we connect to its GATT server and
 * enumerate all accessible services/characteristics, reading every readable
 * value. BLE enforces security on demand, so reading a protected
 * characteristic is what automatically triggers pairing (and therefore the
 * custom pairing dialog) — no dedicated pairing step is needed.
 */
import { onUnmounted, readonly, ref, type Ref } from "vue";
import type { DiscoveredDevice } from "../../shared/ble-types";

/** Demo GATT service offered by the test peripheral (peripheral/ble_peripheral.py). */
const DEMO_SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";

/**
 * Web Bluetooth only grants GATT access to services listed in
 * `optionalServices` at scan time, so every service we want to enumerate
 * after connecting must be declared here.
 */
const ACCESSIBLE_SERVICES: BluetoothServiceUUID[] = [
    DEMO_SERVICE_UUID,
    "battery_service",
    "device_information",
];

/** A characteristic discovered on the connected device. */
export interface CharacteristicInfo {
    readonly uuid: string;
    /** GATT property names, e.g. ["read", "notify"]. */
    readonly properties: readonly string[];
    /** Decoded value — UTF-8 if printable, hex otherwise. `null` if not readable. */
    readonly value: string | null;
}

/** A primary service discovered on the connected device. */
export interface ServiceInfo {
    readonly uuid: string;
    readonly characteristics: readonly CharacteristicInfo[];
}

/** Details of the device we are currently connected to. */
export interface ConnectedDeviceInfo {
    readonly name: string;
    /** BLE address — the deviceId Electron reports while scanning. */
    readonly address: string;
    readonly services: readonly ServiceInfo[];
}

export interface UseBleScan {
    /** Devices discovered by the ongoing / last scan. */
    devices: Readonly<Ref<readonly DiscoveredDevice[]>>;
    /** Whether a scan is currently running. */
    scanning: Readonly<Ref<boolean>>;
    /** Whether a connection/service discovery is in progress. */
    connecting: Readonly<Ref<boolean>>;
    /** The connected device's details, or `null` while disconnected. */
    connected: Readonly<Ref<ConnectedDeviceInfo | null>>;
    /** Error message of the last failed scan/connect attempt, or `null`. */
    error: Readonly<Ref<string | null>>;
    /** Start scanning for nearby BLE devices. */
    startScan(): Promise<void>;
    /** Abort the current scan. */
    stopScan(): void;
    /** Pick a device from the list; connects and pairs if necessary. */
    select(deviceId: string): void;
    /** Close the GATT connection and return to the scan view. */
    disconnect(): void;
}

/** Render a characteristic value as UTF-8 when printable, hex bytes otherwise. */
function decodeValue(view: DataView): string {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const text = new TextDecoder().decode(bytes);
    if (/^[\x20-\x7e]*$/.test(text)) return text;
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

/** Collect the names of all GATT properties set on a characteristic. */
function describeProperties(props: BluetoothCharacteristicProperties): string[] {
    const names: (keyof BluetoothCharacteristicProperties)[] = [
        "read",
        "write",
        "writeWithoutResponse",
        "notify",
        "indicate",
        "broadcast",
        "authenticatedSignedWrites",
    ];
    return names.filter((name) => props[name]);
}

/**
 * Walk all accessible services/characteristics of a connected device and
 * read every readable value. The first read of a protected characteristic
 * triggers pairing; if the user cancels it, that read simply fails.
 */
async function enumerateServices(gatt: BluetoothRemoteGATTServer): Promise<ServiceInfo[]> {
    console.log("Starting service discovery...");
    let services: BluetoothRemoteGATTService[] = [];
    try {
        services = await gatt.getPrimaryServices();
    } catch (e) {
        // Device exposes none of the whitelisted services.
        if (e instanceof Error && e.name === "NetworkError") {
            console.warn("Gatt server disconnected, reconnecting...");
            await gatt.connect();
            return await enumerateServices(gatt);
        } else {
            console.error("Service discovery failed:", e);
            return [];
        }
    }

    const result: ServiceInfo[] = [];
    for (const service of services) {
        console.log(`Discovering characteristics for service ${service.uuid}...`);
        const characteristics: CharacteristicInfo[] = [];
        let gattCharacteristics: BluetoothRemoteGATTCharacteristic[] = [];
        try {
            gattCharacteristics = await service.getCharacteristics();
        } catch (e) {
            // Service without characteristics — keep the empty entry.
            console.error(`Characteristic discovery failed for service ${service.uuid}:`, e);
            return await enumerateServices(gatt);
        }
        for (const characteristic of gattCharacteristics) {
            console.log(`Reading characteristic ${characteristic.uuid}...`);
            let value: string | null = null;
            if (characteristic.properties.read) {
                try {
                    value = decodeValue(await characteristic.readValue());
                } catch (e) {
                    console.error(`Read failed for characteristic ${characteristic.uuid}:`, e);
                    value = "(read failed)";
                    return await enumerateServices(gatt);
                }
            }
            characteristics.push({
                uuid: characteristic.uuid,
                properties: describeProperties(characteristic.properties),
                value,
            });
        }
        result.push({ uuid: service.uuid, characteristics });
    }
    console.log(`Discovered ${result.length} services!`);
    return result;
}

export function useBleScan(): UseBleScan {
    const devices = ref<DiscoveredDevice[]>([]);
    const scanning = ref(false);
    const connecting = ref(false);
    const connected = ref<ConnectedDeviceInfo | null>(null);
    const error = ref<string | null>(null);

    /** The live GATT connection backing `connected`. */
    let gattServer: BluetoothRemoteGATTServer | null = null;
    /** Name/address of the device picked from the scan list (see `select`). */
    let selectedName = "";
    let selectedAddress = "";

    // Keep the IPC subscription alive for the component's whole lifetime so
    // device-list updates are never missed between scans.
    const unsubscribe = window.bleApi.onDeviceList((list) => {
        devices.value = list;
    });
    onUnmounted(unsubscribe);

    async function startScan(): Promise<void> {
        if (scanning.value || connecting.value) return;
        devices.value = [];
        error.value = null;
        scanning.value = true;
        try {
            console.log("Starting scan for BLE devices.");
            // `acceptAllDevices` scans without filters; the promise stays pending
            // until a device is selected via IPC or the scan is cancelled.
            const device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: ACCESSIBLE_SERVICES,
            });
            scanning.value = false;
            await connect(device);
        } catch (e) {
            // A cancelled scan rejects with NotFoundError — that's not an error
            // worth surfacing to the user.
            if (e instanceof Error && e.name !== "NotFoundError") {
                error.value = e instanceof Error ? e.message : String(e);
                console.error("Scan/connect failed:", e);
            } else {
                console.log("Scan was cancelled by the user.");
            }
        } finally {
            scanning.value = false;
            connecting.value = false;
        }
    }

    /** Connect to the picked device and populate `connected` with its details. */
    async function connect(device: BluetoothDevice): Promise<void> {
        console.log(`Connecting to device: ${device.name || selectedName || selectedAddress}`);
        connecting.value = true;
        const gatt = await device.gatt?.connect();
        if (!gatt) throw new Error("Device has no GATT server");
        gattServer = gatt;

        // Reflect link loss (e.g. device out of range) by returning to scan
        // view. `onDisconnected` is idempotent, so stale listeners are harmless.
        device.addEventListener("gattserverdisconnected", onDisconnected);

        const services = await enumerateServices(gatt);
        connected.value = {
            name: device.name || selectedName || selectedAddress,
            address: selectedAddress,
            services,
        };
    }

    function onDisconnected(): void {
        connected.value = null;
        gattServer = null;
    }

    function stopScan(): void {
        console.log("Stopping BLE scan.");
        window.bleApi.cancelScan();
        devices.value = [];
    }

    function select(deviceId: string): void {
        console.log(`Selecting device with ID: ${deviceId}`);
        // Remember name/address now — Web Bluetooth's `device.id` is an opaque
        // token, so the scan list is the only source for the real BLE address.
        const picked = devices.value.find((d) => d.deviceId === deviceId);
        selectedAddress = deviceId;
        selectedName = picked?.deviceName ?? "";
        window.bleApi.selectDevice(deviceId);
        devices.value = [];
    }

    function disconnect(): void {
        console.log(`Disconnecting from device: ${connected.value?.name || selectedName || selectedAddress}`);
        gattServer?.disconnect();
        onDisconnected();
    }

    return {
        devices: readonly(devices),
        scanning: readonly(scanning),
        connecting: readonly(connecting),
        connected: readonly(connected),
        error: readonly(error),
        startScan,
        stopScan,
        select,
        disconnect,
    };
}
