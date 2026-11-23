/**
 * Live connection to the keyboard over WebHID (Chromium-based browsers).
 *
 * Uses the same Raw HID reports as zmk-charybdis' tools/visualizer, from the
 * zmk-raw-hid + zmk-keypeek-layer-notifier modules and modules/status-report:
 *   layer:  FF 04 <default layer mask u32 LE> <active layer mask u32 LE>
 *   key:    F1 00 <position> <1 pressed / 0 released>
 *   status: F3 01 <batt this half> <batt other half> <peripherals> <output> <profile> <flags>
 * Writing a report that starts with F3 asks the keyboard for a status report.
 *
 * On Linux, Chromium needs permission to open /dev/hidraw*: see docs/udev.md.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const USAGE_PAGE = 0xff60
const USAGE = 0x61
const ZSA_VENDOR = 0x3297 // the Voyager uses the same usage page; never grab it

export interface KbStatus {
  battery: { central: number | null; peripheral: number | null }
  halvesConnected: boolean
  output: 'USB' | 'Bluetooth'
  profile: number
  profileConnected: boolean
  profileOpen: boolean
  usbPowered: boolean
}

export interface Live {
  supported: boolean
  connected: boolean
  name?: string
  layerMask: number
  topLayer: number
  down: Set<number>
  status?: KbStatus
  /** Increments on every key press, with the position, for "press a key to select it". */
  lastPress?: { pos: number; seq: number }
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  error?: string
}

type HIDDeviceLike = {
  opened: boolean
  productName: string
  vendorId: number
  collections: { usagePage: number; usage: number }[]
  open: () => Promise<void>
  close: () => Promise<void>
  sendReport: (id: number, data: BufferSource) => Promise<void>
  addEventListener: (t: 'inputreport', f: (e: { data: DataView; reportId: number }) => void) => void
  removeEventListener: (t: 'inputreport', f: (e: { data: DataView; reportId: number }) => void) => void
}

const hid = (): any => (navigator as any).hid

function matches(d: HIDDeviceLike): boolean {
  return d.vendorId !== ZSA_VENDOR && d.collections.some((c) => c.usagePage === USAGE_PAGE && c.usage === USAGE)
}

function top(mask: number): number {
  for (let l = 31; l > 0; l--) if (mask & (1 << l)) return l
  return 0
}

export function useLive(keyboardName?: string): Live {
  const supported = typeof navigator !== 'undefined' && !!hid()
  const [device, setDevice] = useState<HIDDeviceLike>()
  const [layerMask, setMask] = useState(1)
  const [down, setDown] = useState<Set<number>>(new Set())
  const [status, setStatus] = useState<KbStatus>()
  const [lastPress, setLastPress] = useState<{ pos: number; seq: number }>()
  const [error, setError] = useState<string>()
  const seq = useRef(0)

  const attach = useCallback(async (d: HIDDeviceLike) => {
    try {
      if (!d.opened) await d.open()
      setDevice(d)
      setError(undefined)
      // Ask for a status report now; firmware without the status module ignores it.
      const req = new Uint8Array(32)
      req[0] = 0xf3
      await d.sendReport(0, req).catch(() => {})
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // Reconnect to a keyboard the user already granted.
  useEffect(() => {
    if (!supported) return
    hid().getDevices().then((ds: HIDDeviceLike[]) => {
      const d = ds.filter(matches).find((x) => !keyboardName || x.productName.toLowerCase().includes(keyboardName.toLowerCase())) ?? ds.find(matches)
      if (d) attach(d)
    })
    const onConnect = (e: { device: HIDDeviceLike }) => { if (matches(e.device)) attach(e.device) }
    const onDisconnect = (e: { device: HIDDeviceLike }) => setDevice((cur) => (cur === e.device ? undefined : cur))
    hid().addEventListener('connect', onConnect)
    hid().addEventListener('disconnect', onDisconnect)
    return () => { hid().removeEventListener('connect', onConnect); hid().removeEventListener('disconnect', onDisconnect) }
  }, [supported, attach, keyboardName])

  useEffect(() => {
    if (!device) { setDown(new Set()); setStatus(undefined); return }
    const onReport = (e: { data: DataView }) => {
      const r = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength)
      if (r[0] === 0xff && r[1] === 4 && r.length >= 10) {
        setMask(e.data.getUint32(6, true))
      } else if (r[0] === 0xf1 && r.length >= 4) {
        const pos = r[2]
        const isDown = !!r[3]
        setDown((s) => { const n = new Set(s); isDown ? n.add(pos) : n.delete(pos); return n })
        if (isDown) setLastPress({ pos, seq: ++seq.current })
      } else if (r[0] === 0xf3 && r[1] === 1 && r.length >= 8) {
        const pct = (b: number) => (b === 0xff ? null : b)
        setStatus({
          battery: { central: pct(r[2]), peripheral: r[4] ? pct(r[3]) : null },
          halvesConnected: r[4] > 0,
          output: r[5] === 1 ? 'Bluetooth' : 'USB',
          profile: r[6],
          profileConnected: !!(r[7] & 1),
          profileOpen: !!(r[7] & 2),
          usbPowered: !!(r[7] & 4),
        })
      }
    }
    device.addEventListener('inputreport', onReport)
    return () => device.removeEventListener('inputreport', onReport)
  }, [device])

  const connect = useCallback(async () => {
    if (!supported) return
    try {
      const ds: HIDDeviceLike[] = await hid().requestDevice({ filters: [{ usagePage: USAGE_PAGE, usage: USAGE }] })
      const d = ds.find(matches)
      if (!d) {
        if (ds.some((x) => x.vendorId === ZSA_VENDOR)) setError('That is a ZSA keyboard; pick the ZMK keyboard.')
        return
      }
      await attach(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [supported, attach])

  const disconnect = useCallback(async () => {
    await device?.close().catch(() => {})
    setDevice(undefined)
  }, [device])

  return { supported, connected: !!device, name: device?.productName, layerMask, topLayer: top(layerMask), down, status, lastPress, connect, disconnect, error }
}
