#!/usr/bin/env python3
"""
BLE peripheral for Raspberry Pi — "TestDevice", passkey-protected.

Headless script that turns the Pi's Bluetooth adapter into a connectable BLE
peripheral using BlueZ's D-Bus API. It consists of four parts:

  1. Adapter setup   — names the adapter "TestDevice", makes it powered,
                       discoverable and pairable. All existing bonds are
                       removed at startup so every run starts unpaired.
  2. Pairing agent   — a BlueZ `org.bluez.Agent1` implementation. The kernel
                       generates a random 6-digit passkey per pairing; the
                       agent LOGS IT PROMINENTLY — type that number into the
                       central's pairing dialog.
  3. GATT server     — one demo service with a single characteristic whose
                       read requires *authenticated encryption*
                       ('encrypt-authenticated-read'). Reading it is what
                       forces the central to pair (with MITM protection,
                       i.e. passkey entry — not "Just Works").
  4. Advertisement   — an LE advertisement broadcasting the device name and
                       the demo service UUID.

Setup (Raspberry Pi OS):
  sudo apt install python3-dbus python3-gi
  sudo python3 ble_peripheral.py        # or run as a user in the 'bluetooth' group
"""

import logging
import os
import subprocess
from pathlib import Path

import dbus
import dbus.mainloop.glib
import dbus.service
from gi.repository import GLib

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

DEVICE_NAME = "TestDevice"

# LE timing, tuned for latency/throughput (battery use is irrelevant here).
# Advertising interval in 0.625 ms units; 32 = 20 ms (spec minimum).
ADV_INTERVAL = 32
# Connection interval in 1.25 ms units; 6 = 7.5 ms (spec minimum).
CONN_INTERVAL = 6
# 0 = central may never skip connection events.
CONN_LATENCY = 0

# Demo GATT service/characteristic. Must match the UUIDs used by the central
# (see useBleScan.ts in the Electron app).
SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0"
CHAR_UUID = "12345678-1234-5678-1234-56789abcdef1"
CHAR_VALUE = b"Hello from TestDevice"

# BlueZ D-Bus names
BLUEZ = "org.bluez"
ADAPTER_IFACE = "org.bluez.Adapter1"
DEVICE_IFACE = "org.bluez.Device1"
AGENT_IFACE = "org.bluez.Agent1"
AGENT_MANAGER_IFACE = "org.bluez.AgentManager1"
ADVERT_IFACE = "org.bluez.LEAdvertisement1"
ADVERT_MANAGER_IFACE = "org.bluez.LEAdvertisingManager1"
GATT_MANAGER_IFACE = "org.bluez.GattManager1"
GATT_SERVICE_IFACE = "org.bluez.GattService1"
GATT_CHRC_IFACE = "org.bluez.GattCharacteristic1"
DBUS_PROPS_IFACE = "org.freedesktop.DBus.Properties"
DBUS_OM_IFACE = "org.freedesktop.DBus.ObjectManager"

log = logging.getLogger("ble-peripheral")


# --------------------------------------------------------------------------
# Pairing agent
# --------------------------------------------------------------------------


class PairingAgent(dbus.service.Object):
    """
    BlueZ pairing agent (org.bluez.Agent1).

    Registered with capability 'DisplayOnly', which tells BlueZ this device
    can show a passkey but not enter one. Combined with a keyboard-capable
    central (e.g. the Electron app) this selects the *Passkey Entry* pairing
    method: the Pi displays (logs) the passkey, the central's user types it.
    """

    PATH = "/com/example/agent"

    @dbus.service.method(AGENT_IFACE, in_signature="", out_signature="")
    def Release(self):
        log.info("Agent released by BlueZ")

    @dbus.service.method(AGENT_IFACE, in_signature="o", out_signature="s")
    def RequestPinCode(self, device):
        # We are DisplayOnly and cannot enter a PIN.
        log.info("RequestPinCode for %s -> rejecting (no input capability)", device)
        raise dbus.exceptions.DBusException("org.bluez.Error.Rejected")

    @dbus.service.method(AGENT_IFACE, in_signature="os", out_signature="")
    def DisplayPinCode(self, device, pincode):
        log.info("=== PIN CODE for %s: %s ===", device, pincode)

    @dbus.service.method(AGENT_IFACE, in_signature="o", out_signature="u")
    def RequestPasskey(self, device):
        # We are DisplayOnly and cannot enter a passkey.
        log.info("RequestPasskey for %s -> rejecting (no input capability)", device)
        raise dbus.exceptions.DBusException("org.bluez.Error.Rejected")

    @dbus.service.method(AGENT_IFACE, in_signature="ouq", out_signature="")
    def DisplayPasskey(self, device, passkey, entered):
        # The kernel generated a random passkey for this pairing; the user
        # must type it on the central. `entered` counts typed digits.
        log.info(
            "=== PASSKEY for %s: %06d (enter this on the central) ===", device, passkey
        )

    @dbus.service.method(AGENT_IFACE, in_signature="ou", out_signature="")
    def RequestConfirmation(self, device, passkey):
        # Numeric comparison: auto-accept on the headless side.
        log.info(
            "RequestConfirmation for %s, passkey %06d -> accepting", device, passkey
        )

    @dbus.service.method(AGENT_IFACE, in_signature="o", out_signature="")
    def RequestAuthorization(self, device):
        log.info("RequestAuthorization for %s -> accepting", device)

    @dbus.service.method(AGENT_IFACE, in_signature="os", out_signature="")
    def AuthorizeService(self, device, uuid):
        log.info("AuthorizeService %s for %s -> accepting", uuid, device)

    @dbus.service.method(AGENT_IFACE, in_signature="", out_signature="")
    def Cancel(self):
        log.info("Pairing request cancelled by remote side")


# --------------------------------------------------------------------------
# GATT server (one service, one protected characteristic)
# --------------------------------------------------------------------------


class DemoCharacteristic(dbus.service.Object):
    """
    Read-only characteristic protected by 'encrypt-authenticated-read':
    reading it requires an encrypted AND authenticated (MITM-protected)
    link, which forces passkey pairing on first access.
    """

    PATH = "/com/example/app/service0/char0"

    def properties(self) -> dict:
        """Characteristic properties as expected by GetManagedObjects."""
        return {
            "UUID": CHAR_UUID,
            "Service": dbus.ObjectPath(DemoService.PATH),
            "Flags": dbus.Array(["encrypt-authenticated-read"], signature="s"),
        }

    @dbus.service.method(GATT_CHRC_IFACE, in_signature="a{sv}", out_signature="ay")
    def ReadValue(self, options):
        log.info("Characteristic read by %s", options.get("device", "unknown device"))
        return dbus.Array([dbus.Byte(b) for b in CHAR_VALUE], signature="y")


class DemoService(dbus.service.Object):
    """Primary GATT service containing the protected demo characteristic."""

    PATH = "/com/example/app/service0"

    def properties(self) -> dict:
        return {
            "UUID": SERVICE_UUID,
            "Primary": dbus.Boolean(True),
        }


class Application(dbus.service.Object):
    """
    GATT application root. BlueZ discovers the service/characteristic tree
    by calling GetManagedObjects on this object.
    """

    PATH = "/com/example/app"

    def __init__(self, bus: dbus.SystemBus):
        super().__init__(bus, self.PATH)
        self.service = DemoService(bus, DemoService.PATH)
        self.characteristic = DemoCharacteristic(bus, DemoCharacteristic.PATH)

    @dbus.service.method(DBUS_OM_IFACE, out_signature="a{oa{sa{sv}}}")
    def GetManagedObjects(self):
        return {
            DemoService.PATH: {GATT_SERVICE_IFACE: self.service.properties()},
            DemoCharacteristic.PATH: {
                GATT_CHRC_IFACE: self.characteristic.properties()
            },
        }


# --------------------------------------------------------------------------
# Advertisement
# --------------------------------------------------------------------------


class Advertisement(dbus.service.Object):
    """LE advertisement broadcasting the device name and demo service UUID."""

    PATH = "/com/example/advertisement"

    @dbus.service.method(DBUS_PROPS_IFACE, in_signature="s", out_signature="a{sv}")
    def GetAll(self, interface):
        if interface != ADVERT_IFACE:
            raise dbus.exceptions.DBusException("org.bluez.Error.InvalidArguments")
        return {
            "Type": "peripheral",
            "LocalName": DEVICE_NAME,
            "ServiceUUIDs": dbus.Array([SERVICE_UUID], signature="s"),
        }

    @dbus.service.method(ADVERT_IFACE, in_signature="", out_signature="")
    def Release(self):
        log.info("Advertisement released by BlueZ")


# --------------------------------------------------------------------------
# Wiring
# --------------------------------------------------------------------------


def find_adapter(bus: dbus.SystemBus) -> str:
    """Return the D-Bus path of the first Bluetooth adapter (e.g. /org/bluez/hci0)."""
    om = dbus.Interface(bus.get_object(BLUEZ, "/"), DBUS_OM_IFACE)
    for path, interfaces in om.GetManagedObjects().items():
        if ADAPTER_IFACE in interfaces:
            return path
    raise RuntimeError("No Bluetooth adapter found — is bluetoothd running?")


def unblock_bluetooth() -> None:
    """Clear any rfkill soft block, which makes Powered=True fail otherwise."""
    try:
        subprocess.run(["rfkill", "unblock", "bluetooth"], check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        log.warning("Could not run 'rfkill unblock bluetooth': %s", exc)


def configure_adapter(bus: dbus.SystemBus, adapter_path: str) -> None:
    """Power the adapter and make it visible/pairable under the demo name."""
    props = dbus.Interface(bus.get_object(BLUEZ, adapter_path), DBUS_PROPS_IFACE)
    try:
        props.Set(ADAPTER_IFACE, "Powered", dbus.Boolean(True))
    except dbus.exceptions.DBusException as exc:
        raise RuntimeError(
            "Failed to power on the adapter — check 'rfkill list' for blocks "
            "and that bluetoothd is running"
        ) from exc
    props.Set(ADAPTER_IFACE, "Alias", dbus.String(DEVICE_NAME))
    # Timeout 0 = stay discoverable/pairable forever (demo convenience).
    props.Set(ADAPTER_IFACE, "DiscoverableTimeout", dbus.UInt32(0))
    props.Set(ADAPTER_IFACE, "Discoverable", dbus.Boolean(True))
    props.Set(ADAPTER_IFACE, "PairableTimeout", dbus.UInt32(0))
    props.Set(ADAPTER_IFACE, "Pairable", dbus.Boolean(True))
    log.info('Adapter %s configured as "%s"', adapter_path, DEVICE_NAME)


def tune_le_parameters(adapter_path: str) -> None:
    """
    Push advertising/connection timing to the spec minimums via kernel debugfs
    (requires root). The connection interval is what the peripheral *requests*
    after connecting; the central may still negotiate upwards.
    """
    base = Path("/sys/kernel/debug/bluetooth") / os.path.basename(adapter_path)
    # The kernel enforces min <= max on every write, so set mins first.
    for name, value in (
        ("adv_min_interval", ADV_INTERVAL),
        ("adv_max_interval", ADV_INTERVAL),
        ("conn_min_interval", CONN_INTERVAL),
        ("conn_max_interval", CONN_INTERVAL),
        ("conn_latency", CONN_LATENCY),
    ):
        try:
            (base / name).write_text(str(value))
        except OSError as exc:
            log.warning("Could not set %s=%s: %s", name, value, exc)
            return
    log.info(
        "LE timing tuned: advertising %.1f ms, requested conn interval %.2f ms",
        ADV_INTERVAL * 0.625,
        CONN_INTERVAL * 1.25,
    )


def remove_all_bonds(bus: dbus.SystemBus, adapter_path: str) -> None:
    """Remove every known/bonded device so each run starts unpaired."""
    om = dbus.Interface(bus.get_object(BLUEZ, "/"), DBUS_OM_IFACE)
    adapter = dbus.Interface(bus.get_object(BLUEZ, adapter_path), ADAPTER_IFACE)
    for path, interfaces in om.GetManagedObjects().items():
        device = interfaces.get(DEVICE_IFACE)
        if device is None or device.get("Adapter") != adapter_path:
            continue
        try:
            adapter.RemoveDevice(path)
            log.info("Removed bond/device %s (%s)", device.get("Address"), path)
        except dbus.exceptions.DBusException as exc:
            log.warning("Could not remove device %s: %s", path, exc)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )

    # Integrate dbus-python with the GLib event loop (required for incoming calls).
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()

    unblock_bluetooth()
    adapter_path = find_adapter(bus)
    configure_adapter(bus, adapter_path)
    tune_le_parameters(adapter_path)
    remove_all_bonds(bus, adapter_path)
    adapter = bus.get_object(BLUEZ, adapter_path)

    # 1. Pairing agent — 'DisplayOnly' selects passkey *display* on our side.
    agent = PairingAgent(bus, PairingAgent.PATH)
    agent_manager = dbus.Interface(
        bus.get_object(BLUEZ, "/org/bluez"), AGENT_MANAGER_IFACE
    )
    agent_manager.RegisterAgent(PairingAgent.PATH, "DisplayOnly")
    agent_manager.RequestDefaultAgent(PairingAgent.PATH)
    log.info("Pairing agent registered (passkey is generated per pairing)")

    loop = GLib.MainLoop()

    def fail(what: str):
        def handler(error: dbus.exceptions.DBusException) -> None:
            log.error("Failed to register %s: %s", what, error)
            loop.quit()

        return handler

    # 2. GATT application with the protected characteristic.
    # Must be registered asynchronously: BlueZ calls back into this process
    # (GetManagedObjects) before replying, which deadlocks a blocking call
    # made while the main loop isn't running yet.
    app = Application(bus)
    gatt_manager = dbus.Interface(adapter, GATT_MANAGER_IFACE)
    gatt_manager.RegisterApplication(
        Application.PATH,
        {},
        reply_handler=lambda: log.info("GATT service %s registered", SERVICE_UUID),
        error_handler=fail("GATT application"),
    )

    # 3. Advertise (async for the same reason: BlueZ calls GetAll on us first).
    advertisement = Advertisement(bus, Advertisement.PATH)
    ad_manager = dbus.Interface(adapter, ADVERT_MANAGER_IFACE)
    ad_manager.RegisterAdvertisement(
        Advertisement.PATH,
        {},
        reply_handler=lambda: log.info(
            'Advertising as "%s" — waiting for connections (Ctrl+C to stop)',
            DEVICE_NAME,
        ),
        error_handler=fail("advertisement"),
    )

    try:
        loop.run()
    except KeyboardInterrupt:
        log.info("Shutting down")
    finally:
        # Best-effort cleanup; BlueZ also cleans up when the process exits.
        try:
            ad_manager.UnregisterAdvertisement(Advertisement.PATH)
            gatt_manager.UnregisterApplication(Application.PATH)
            agent_manager.UnregisterAgent(PairingAgent.PATH)
        except dbus.exceptions.DBusException:
            pass


if __name__ == "__main__":
    main()
