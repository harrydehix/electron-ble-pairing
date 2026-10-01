/**
 * Electron main process.
 *
 * Responsibilities:
 *  1. Create the application window.
 *  2. Handle Web Bluetooth device selection (`select-bluetooth-device`) so the
 *     renderer can show its own scan/device-list UI instead of Chromium's.
 *  3. Register a bluetooth *pairing handler* so pairing requests (PIN entry,
 *     PIN confirmation, simple confirmation) are forwarded to the renderer,
 *     which shows a custom dialog and answers via IPC.
 */
import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "node:path";
import type { DiscoveredDevice, PairingResponse } from "../shared/ble-types";

/** IPC channel names used between main, preload and renderer. */
const IPC = {
    deviceList: "ble:device-list",
    selectDevice: "ble:select-device",
    cancelScan: "ble:cancel-scan",
    pairingRequest: "ble:pairing-request",
    pairingResponse: "ble:pairing-response",
} as const;

let win: BrowserWindow | null = null;

/**
 * Callback that resolves the currently pending `select-bluetooth-device`
 * event. Calling it with a device id picks that device, calling it with an
 * empty string cancels the scan. `null` while no scan is in progress.
 */
let resolveDeviceSelection: ((deviceId: string) => void) | null = null;

/**
 * Callback that resolves the currently pending pairing request.
 * `null` while no pairing is in progress.
 */
let resolvePairing: ((response: PairingResponse) => void) | null = null;

function createWindow(): void {
    win = new BrowserWindow({
        width: 480,
        height: 680,
        webPreferences: {
            // The preload script is the only bridge between renderer and main.
            preload: path.join(import.meta.dirname, "preload.mjs"),
            contextIsolation: true,
        },
    });

    setupBluetoothHandlers(win);

    // In dev, vite-plugin-electron provides the dev server URL via env.
    if (process.env.VITE_DEV_SERVER_URL) {
        win.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
        win.loadFile(path.join(import.meta.dirname, "../dist/index.html"));
    }
}

/**
 * Wires up the two Bluetooth-related Chromium hooks for the given window:
 *
 *  - `select-bluetooth-device`: fired repeatedly while the renderer's
 *    `navigator.bluetooth.requestDevice()` scan is running, each time with the
 *    updated list of discovered devices. We forward that list to the renderer
 *    and keep the `callback` around until the user picks/cancels.
 *
 *  - `setBluetoothPairingHandler`: invoked by the OS when connecting to a
 *    device requires pairing. We forward the request to the renderer, which
 *    shows the custom pairing dialog, and feed the user's answer back.
 */
function setupBluetoothHandlers(win: BrowserWindow): void {
    win.webContents.on("select-bluetooth-device", (event, devices, callback) => {
        // Prevent Chromium's default behaviour (immediately picking/cancelling).
        event.preventDefault();

        resolveDeviceSelection = callback;

        const list: DiscoveredDevice[] = devices.map((d) => ({
            deviceId: d.deviceId,
            deviceName: d.deviceName || d.deviceId,
        }));
        win.webContents.send(IPC.deviceList, list);
    });

    session.defaultSession.setBluetoothPairingHandler((details, callback) => {
        resolvePairing = callback;

        // Forward only the serialisable fields the renderer dialog needs.
        win.webContents.send(IPC.pairingRequest, {
            deviceId: details.deviceId,
            pairingKind: details.pairingKind,
            pin: details.pin,
        });
    });
}

/** Renderer picked a device from the scan list -> resolve the scan. */
ipcMain.on(IPC.selectDevice, (_event, deviceId: string) => {
    resolveDeviceSelection?.(deviceId);
    resolveDeviceSelection = null;
});

/** Renderer aborted the scan -> resolve with '' which cancels the request. */
ipcMain.on(IPC.cancelScan, () => {
    resolveDeviceSelection?.("");
    resolveDeviceSelection = null;
});

/** Renderer answered the pairing dialog -> resolve the pairing handler. */
ipcMain.on(IPC.pairingResponse, (_event, response: PairingResponse) => {
    resolvePairing?.(response);
    resolvePairing = null;
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
