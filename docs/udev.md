# Live mode on Linux: hidraw permission

Live mode (layer following, press-to-select, battery chips) reads the keyboard's Raw HID
reports with WebHID. On Linux, `/dev/hidraw*` is root-only by default, so Chromium can't
open it until you add a udev rule. ZMK keyboards use USB VID `1D50` / PID `615E` by default
(over Bluetooth the same IDs appear in the HID device name).

```sh
sudo tee /etc/udev/rules.d/70-zmk-rawhid.rules <<'RULE'
# ZMK keyboards (USB and Bluetooth): let the logged-in user open raw HID (WebHID, visualisers)
KERNEL=="hidraw*", ATTRS{idVendor}=="1d50", ATTRS{idProduct}=="615e", TAG+="uaccess"
KERNEL=="hidraw*", KERNELS=="*:1D50:615E.*", TAG+="uaccess"
RULE
sudo udevadm control --reload && sudo udevadm trigger
```

Then unplug/replug (or reconnect Bluetooth) and press **⚡ Connect keyboard** in the editor.
Windows needs nothing extra.

If you set a custom `CONFIG_USB_DEVICE_VID`/`PID`, use those instead.
