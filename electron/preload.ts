/**
 * Preload script.
 *
 * Runs in an isolated context with access to Node/Electron APIs and exposes a
 * minimal, typed bridge (`window.bleApi`) to the renderer. The renderer never
 * touches `ipcRenderer` directly — only this explicit surface.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { BleApi, DiscoveredDevice, PairingRequest, PairingResponse } from "../shared/ble-types";

/** Must match the channel names used in `electron/main.ts`. */
const IPC = {
    deviceList: "ble:device-list",
    selectDevice: "ble:select-device",
    cancelScan: "ble:cancel-scan",
    pairingRequest: "ble:pairing-request",
    pairingResponse: "ble:pairing-response",
} as const;

const bleApi: BleApi = {
    onDeviceList(callback) {
        const listener = (_e: unknown, devices: DiscoveredDevice[]) => callback(devices);
        ipcRenderer.on(IPC.deviceList, listener);
        return () => ipcRenderer.removeListener(IPC.deviceList, listener);
    },

    selectDevice(deviceId) {
        ipcRenderer.send(IPC.selectDevice, deviceId);
    },

    cancelScan() {
        ipcRenderer.send(IPC.cancelScan);
    },

    onPairingRequest(callback) {
        const listener = (_e: unknown, request: PairingRequest) => callback(request);
        ipcRenderer.on(IPC.pairingRequest, listener);
        return () => ipcRenderer.removeListener(IPC.pairingRequest, listener);
    },

    respondToPairing(response: PairingResponse) {
        ipcRenderer.send(IPC.pairingResponse, response);
    },
};

contextBridge.exposeInMainWorld("bleApi", bleApi);
