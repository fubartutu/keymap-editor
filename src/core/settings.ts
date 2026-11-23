/**
 * Settings, modelled on Oryx's declarative settings catalogue: each setting has a title,
 * description, control type, range and default, plus a *target* saying where ZMK keeps it.
 * Kconfig symbols and defaults were checked against ZMK v0.3 and the PMW3610 driver's Kconfig.
 */

export type Scope = 'both' | 'central' | 'peripheral'

export type SettingTarget =
  | { kind: 'kconfig'; symbol: string; scope: Scope }
  | { kind: 'kconfig-choice'; options: { value: string; symbol: string }[]; scope: Scope }
  | { kind: 'override'; behavior: string; prop: string }
  | { kind: 'define'; name: string }
  | { kind: 'overlay'; label: string; prop: string; cell?: number }

export type SettingType = 'toggle' | 'number' | 'select' | 'text' | 'layer' | 'layers'

export interface Setting {
  id: string
  section: string
  title: string
  description: string
  type: SettingType
  target: SettingTarget
  default?: string | number | boolean
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: { value: string; label: string }[]
  /** Only show when another setting has this value. */
  dependsOn?: { id: string; value: unknown }
  /** Only relevant when this feature is present (e.g. a PMW3610 trackball). */
  requires?: 'pmw3610' | 'auto-mouse' | 'underglow' | 'split'
  /** Oryx's equivalent setting, to help people coming from a ZSA keyboard. */
  oryx?: string
}

export interface Section { id: string; title: string; description: string }

export const SECTIONS: Section[] = [
  { id: 'tapping', title: 'Tapping', description: 'Defaults for the built-in mod-tap (&mt) and layer-tap (&lt). Your own hold-taps (home-row mods etc.) are edited under Behaviours.' },
  { id: 'combos', title: 'Combos & macros', description: 'Limits and timing for combos and macros.' },
  { id: 'keyboard', title: 'Keyboard', description: 'Name, key reporting and switch debouncing.' },
  { id: 'power', title: 'Power & sleep', description: 'Idle and deep sleep. Deep sleep saves the most battery; any key wakes the keyboard (it reconnects in a second or two).' },
  { id: 'bluetooth', title: 'Bluetooth', description: 'Radio power and connection behaviour.' },
  { id: 'battery', title: 'Battery', description: 'Battery level reporting to the computer.' },
  { id: 'lighting', title: 'Underglow', description: 'RGB underglow defaults when the keyboard starts.' },
  { id: 'trackball', title: 'Trackball', description: 'PMW3610 sensor settings (right half).' },
  { id: 'automouse', title: 'Auto-mouse', description: 'The mouse layer turns on by itself when the trackball moves, like the Voyager Navigator.' },
  { id: 'mousekeys', title: 'Mouse keys', description: 'Speed of the &mmv / &msc mouse-movement and scroll keys.' },
  { id: 'studio', title: 'ZMK Studio', description: 'Live keymap editing over USB with ZMK Studio.' },
]

const ms = 'milliseconds'

export const SETTINGS: Setting[] = [
  // Tapping
  { id: 'mt-term', section: 'tapping', title: 'Mod-tap tapping term', type: 'number', unit: ms, min: 50, max: 1000, step: 5, default: 200, target: { kind: 'override', behavior: 'mt', prop: 'tapping-term-ms' },
    description: 'How long a mod-tap key must be held before it acts as a modifier.', oryx: 'Tapping term' },
  { id: 'mt-flavor', section: 'tapping', title: 'Mod-tap flavour', type: 'select', default: 'hold-preferred', target: { kind: 'override', behavior: 'mt', prop: 'flavor' },
    options: [
      { value: 'hold-preferred', label: 'Hold-preferred: hold as soon as another key is pressed' },
      { value: 'balanced', label: 'Balanced: hold if another key is pressed and released (Oryx: permissive hold)' },
      { value: 'tap-preferred', label: 'Tap-preferred: only hold after the tapping term' },
      { value: 'tap-unless-interrupted', label: 'Tap unless interrupted (Oryx: hold on other key press)' },
    ], description: 'How a mod-tap decides between tap and hold when you press another key during the tapping term.', oryx: 'Permissive hold / Hold on other key press' },
  { id: 'mt-quick', section: 'tapping', title: 'Mod-tap quick tap', type: 'number', unit: ms, min: 0, max: 1000, step: 5, default: 0, target: { kind: 'override', behavior: 'mt', prop: 'quick-tap-ms' },
    description: 'Tap then press again within this time to auto-repeat the tapped key instead of holding the modifier.', oryx: 'Tapping force hold (inverse)' },
  { id: 'mt-idle', section: 'tapping', title: 'Mod-tap require prior idle', type: 'number', unit: ms, min: 0, max: 1000, step: 5, default: 0, target: { kind: 'override', behavior: 'mt', prop: 'require-prior-idle-ms' },
    description: 'A mod-tap pressed within this time after another key always taps. Prevents misfires while typing quickly.', oryx: 'Tap flow' },
  { id: 'lt-term', section: 'tapping', title: 'Layer-tap tapping term', type: 'number', unit: ms, min: 50, max: 1000, step: 5, default: 200, target: { kind: 'override', behavior: 'lt', prop: 'tapping-term-ms' },
    description: 'How long a layer-tap key must be held before it switches layer.' },
  { id: 'lt-flavor', section: 'tapping', title: 'Layer-tap flavour', type: 'select', default: 'tap-preferred', target: { kind: 'override', behavior: 'lt', prop: 'flavor' },
    options: [
      { value: 'hold-preferred', label: 'Hold-preferred' }, { value: 'balanced', label: 'Balanced' },
      { value: 'tap-preferred', label: 'Tap-preferred' }, { value: 'tap-unless-interrupted', label: 'Tap unless interrupted' },
    ], description: 'How a layer-tap decides between tap and hold.' },
  { id: 'lt-quick', section: 'tapping', title: 'Layer-tap quick tap', type: 'number', unit: ms, min: 0, max: 1000, step: 5, default: 0, target: { kind: 'override', behavior: 'lt', prop: 'quick-tap-ms' },
    description: 'Tap then hold within this time to repeat the tapped key (e.g. hold Backspace to delete repeatedly).' },
  { id: 'sk-release', section: 'tapping', title: 'Sticky key timeout', type: 'number', unit: ms, min: 100, max: 10000, step: 50, default: 1000, target: { kind: 'override', behavior: 'sk', prop: 'release-after-ms' },
    description: 'A sticky (one-shot) key is released if no other key is pressed within this time.', oryx: 'Oneshot timeout' },
  { id: 'sl-release', section: 'tapping', title: 'Sticky layer timeout', type: 'number', unit: ms, min: 100, max: 10000, step: 50, default: 1000, target: { kind: 'override', behavior: 'sl', prop: 'release-after-ms' },
    description: 'A sticky layer turns off if no key is pressed within this time.' },

  // Combos & macros
  { id: 'combo-max-pressed', section: 'combos', title: 'Simultaneous combos', type: 'number', min: 1, max: 20, default: 4, target: { kind: 'kconfig', symbol: 'ZMK_COMBO_MAX_PRESSED_COMBOS', scope: 'both' },
    description: 'How many combos can be held down at the same time.' },
  { id: 'macro-wait', section: 'combos', title: 'Default macro wait', type: 'number', unit: ms, min: 0, max: 500, default: 15, target: { kind: 'kconfig', symbol: 'ZMK_MACRO_DEFAULT_WAIT_MS', scope: 'both' },
    description: 'Pause between the steps of a macro, unless the macro sets its own.' },
  { id: 'macro-tap', section: 'combos', title: 'Default macro tap time', type: 'number', unit: ms, min: 0, max: 500, default: 30, target: { kind: 'kconfig', symbol: 'ZMK_MACRO_DEFAULT_TAP_MS', scope: 'both' },
    description: 'How long each key in a macro is held down.' },

  // Keyboard
  { id: 'name', section: 'keyboard', title: 'Keyboard name', type: 'text', target: { kind: 'kconfig', symbol: 'ZMK_KEYBOARD_NAME', scope: 'both' },
    description: 'The name shown when pairing over Bluetooth (max 16 characters). Changing it means re-pairing.' },
  { id: 'nkro', section: 'keyboard', title: 'N-key rollover', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'ZMK_HID_REPORT_TYPE_NKRO', scope: 'both' },
    description: 'Report every key pressed at once instead of 6. Disables F13-F24 and international keys INT1-9.', oryx: 'Disable N-Key rollover (inverse)' },
  { id: 'usb-boot', section: 'keyboard', title: 'USB boot protocol', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'ZMK_USB_BOOT', scope: 'both' },
    description: 'Lets the keyboard work in BIOS/UEFI menus that only understand basic keyboards.' },
  { id: 'debounce-press', section: 'keyboard', title: 'Debounce (press)', type: 'number', unit: ms, min: 0, max: 30, default: 5, target: { kind: 'kconfig', symbol: 'ZMK_KSCAN_DEBOUNCE_PRESS_MS', scope: 'both' },
    description: 'Time a switch must read as pressed before it counts. Raise it if keys chatter (double-type).', oryx: 'Debounce' },
  { id: 'debounce-release', section: 'keyboard', title: 'Debounce (release)', type: 'number', unit: ms, min: 0, max: 30, default: 5, target: { kind: 'kconfig', symbol: 'ZMK_KSCAN_DEBOUNCE_RELEASE_MS', scope: 'both' },
    description: 'Time a switch must read as released before it counts.' },

  // Power
  { id: 'sleep', section: 'power', title: 'Deep sleep', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'ZMK_SLEEP', scope: 'both' },
    description: 'Turn the keyboard fully off after a period of inactivity. Saves a lot of battery; a key press wakes it.' },
  { id: 'sleep-timeout', section: 'power', title: 'Deep sleep after', type: 'number', unit: ms, min: 60000, max: 7200000, step: 60000, default: 900000, target: { kind: 'kconfig', symbol: 'ZMK_IDLE_SLEEP_TIMEOUT', scope: 'both' },
    dependsOn: { id: 'sleep', value: true }, description: 'Inactivity before deep sleep (900000 ms = 15 minutes).' },
  { id: 'idle-timeout', section: 'power', title: 'Idle after', type: 'number', unit: ms, min: 1000, max: 600000, step: 1000, default: 30000, target: { kind: 'kconfig', symbol: 'ZMK_IDLE_TIMEOUT', scope: 'both' },
    description: 'Inactivity before the keyboard goes idle (underglow can turn off, see below).' },
  { id: 'ext-power', section: 'power', title: 'External power control', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'ZMK_EXT_POWER', scope: 'central' },
    description: 'Lets the keyboard cut power to LEDs and the trackball (&ext_power keys).' },

  // Bluetooth
  { id: 'tx-power', section: 'bluetooth', title: 'Radio power', type: 'select', default: '0', target: { kind: 'kconfig-choice', scope: 'both', options: [
      { value: '+8', symbol: 'BT_CTLR_TX_PWR_PLUS_8' }, { value: '+4', symbol: 'BT_CTLR_TX_PWR_PLUS_4' }, { value: '0', symbol: 'BT_CTLR_TX_PWR_0' }, { value: '-4', symbol: 'BT_CTLR_TX_PWR_MINUS_4' }, { value: '-8', symbol: 'BT_CTLR_TX_PWR_MINUS_8' },
    ] }, options: [{ value: '+8', label: '+8 dBm (best range)' }, { value: '+4', label: '+4 dBm' }, { value: '0', label: '0 dBm (default)' }, { value: '-4', label: '−4 dBm' }, { value: '-8', label: '−8 dBm (saves battery)' }],
    description: 'Higher power helps with range and the link between halves, at some cost in battery.' },
  { id: 'phy-2m', section: 'bluetooth', title: '2M PHY', type: 'toggle', default: true, target: { kind: 'kconfig', symbol: 'BT_CTLR_PHY_2M', scope: 'both' },
    description: 'Faster Bluetooth mode. Turning it off can fix connection problems with some computers and dongles.' },
  { id: 'exp-conn', section: 'bluetooth', title: 'Experimental connection settings', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'ZMK_BLE_EXPERIMENTAL_CONN', scope: 'both' },
    description: 'Connection changes planned to become default in later ZMK. Can fix lag or dropped connections.' },
  { id: 'exp-sec', section: 'bluetooth', title: 'Experimental security settings', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'ZMK_BLE_EXPERIMENTAL_SEC', scope: 'both' },
    description: 'Can fix pairing problems on some Windows computers.' },
  { id: 'passkey', section: 'bluetooth', title: 'Passkey entry', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'ZMK_BLE_PASSKEY_ENTRY', scope: 'central' },
    description: 'Ask for a 6-digit code typed on the keyboard when pairing.' },

  // Battery
  { id: 'battery-interval', section: 'battery', title: 'Battery report interval', type: 'number', unit: 'seconds', min: 10, max: 3600, default: 60, target: { kind: 'kconfig', symbol: 'ZMK_BATTERY_REPORT_INTERVAL', scope: 'both' },
    description: 'How often the battery level is measured. Longer intervals save a little power.' },
  { id: 'battery-fetch', section: 'battery', title: 'Fetch left half battery', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'ZMK_SPLIT_BLE_CENTRAL_BATTERY_LEVEL_FETCHING', scope: 'central' }, requires: 'split',
    description: 'The right half collects the left half\'s battery level.' },
  { id: 'battery-proxy', section: 'battery', title: 'Report left half battery to the computer', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'ZMK_SPLIT_BLE_CENTRAL_BATTERY_LEVEL_PROXY', scope: 'central' }, requires: 'split',
    dependsOn: { id: 'battery-fetch', value: true }, description: 'Expose both halves\' battery levels over Bluetooth (shows two batteries on Linux, needs a tool like ZMK Battery on Windows).' },

  // Lighting
  { id: 'rgb', section: 'lighting', title: 'Underglow', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'ZMK_RGB_UNDERGLOW', scope: 'both' }, requires: 'underglow',
    description: 'Enable the RGB underglow LEDs.' },
  { id: 'rgb-on-start', section: 'lighting', title: 'On at start', type: 'toggle', default: true, target: { kind: 'kconfig', symbol: 'ZMK_RGB_UNDERGLOW_ON_START', scope: 'both' }, dependsOn: { id: 'rgb', value: true },
    description: 'Underglow is on when the keyboard starts.' },
  { id: 'rgb-effect', section: 'lighting', title: 'Effect at start', type: 'select', default: '0', target: { kind: 'kconfig', symbol: 'ZMK_RGB_UNDERGLOW_EFF_START', scope: 'both' }, dependsOn: { id: 'rgb', value: true },
    options: [{ value: '0', label: 'Solid' }, { value: '1', label: 'Breathe' }, { value: '2', label: 'Spectrum' }, { value: '3', label: 'Swirl' }], description: 'Starting effect (cycle with &rgb_ug RGB_EFF).' },
  { id: 'rgb-hue', section: 'lighting', title: 'Hue at start', type: 'number', unit: 'degrees', min: 0, max: 359, default: 0, target: { kind: 'kconfig', symbol: 'ZMK_RGB_UNDERGLOW_HUE_START', scope: 'both' }, dependsOn: { id: 'rgb', value: true },
    description: 'Starting colour: 0 red, 120 green, 240 blue.' },
  { id: 'rgb-sat', section: 'lighting', title: 'Saturation at start', type: 'number', unit: '%', min: 0, max: 100, default: 100, target: { kind: 'kconfig', symbol: 'ZMK_RGB_UNDERGLOW_SAT_START', scope: 'both' }, dependsOn: { id: 'rgb', value: true },
    description: 'Starting saturation.' },
  { id: 'rgb-brt', section: 'lighting', title: 'Brightness at start', type: 'number', unit: '%', min: 0, max: 100, default: 100, target: { kind: 'kconfig', symbol: 'ZMK_RGB_UNDERGLOW_BRT_START', scope: 'both' }, dependsOn: { id: 'rgb', value: true },
    description: 'Starting brightness.' },
  { id: 'rgb-brt-max', section: 'lighting', title: 'Maximum brightness', type: 'number', unit: '%', min: 0, max: 100, default: 100, target: { kind: 'kconfig', symbol: 'ZMK_RGB_UNDERGLOW_BRT_MAX', scope: 'both' }, dependsOn: { id: 'rgb', value: true },
    description: 'Cap on brightness. Lower values save a lot of battery.' },
  { id: 'rgb-idle-off', section: 'lighting', title: 'Off when idle', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'ZMK_RGB_UNDERGLOW_AUTO_OFF_IDLE', scope: 'both' }, dependsOn: { id: 'rgb', value: true },
    description: 'Turn underglow off when the keyboard goes idle (see Power).', oryx: 'Disable RGB after inactivity' },
  { id: 'rgb-usb-off', section: 'lighting', title: 'Off without USB', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'ZMK_RGB_UNDERGLOW_AUTO_OFF_USB', scope: 'both' }, dependsOn: { id: 'rgb', value: true },
    description: 'Only light up while plugged in.' },
  { id: 'rgb-hue-step', section: 'lighting', title: 'Hue step', type: 'number', unit: 'degrees', min: 1, max: 359, default: 10, target: { kind: 'kconfig', symbol: 'ZMK_RGB_UNDERGLOW_HUE_STEP', scope: 'both' }, dependsOn: { id: 'rgb', value: true },
    description: 'How much RGB_HUI / RGB_HUD change the colour.', oryx: 'RGB hue step' },
  { id: 'rgb-brt-step', section: 'lighting', title: 'Brightness step', type: 'number', unit: '%', min: 1, max: 100, default: 10, target: { kind: 'kconfig', symbol: 'ZMK_RGB_UNDERGLOW_BRT_STEP', scope: 'both' }, dependsOn: { id: 'rgb', value: true },
    description: 'How much RGB_BRI / RGB_BRD change brightness.', oryx: 'RGB brightness step' },

  // Trackball (PMW3610)
  { id: 'cpi', section: 'trackball', title: 'Pointer speed (CPI)', type: 'number', min: 200, max: 3200, step: 200, default: 800, target: { kind: 'kconfig', symbol: 'PMW3610_CPI', scope: 'central' }, requires: 'pmw3610',
    description: 'Sensor resolution in counts per inch. Higher moves the cursor further.', oryx: 'Aim speed' },
  { id: 'cpi-div', section: 'trackball', title: 'Pointer speed divider', type: 'number', min: 1, max: 100, default: 1, target: { kind: 'kconfig', symbol: 'PMW3610_CPI_DIVIDOR', scope: 'central' }, requires: 'pmw3610',
    description: 'Divides movement, for speeds slower than 200 CPI.' },
  { id: 'snipe-cpi', section: 'trackball', title: 'Sniping speed (CPI)', type: 'number', min: 200, max: 3200, step: 200, default: 200, target: { kind: 'kconfig', symbol: 'PMW3610_SNIPE_CPI', scope: 'central' }, requires: 'pmw3610',
    description: 'Resolution while a snipe layer is active, for precise pointing.' },
  { id: 'snipe-div', section: 'trackball', title: 'Sniping speed divider', type: 'number', min: 1, max: 100, default: 1, target: { kind: 'kconfig', symbol: 'PMW3610_SNIPE_CPI_DIVIDOR', scope: 'central' }, requires: 'pmw3610',
    description: 'Divides movement while sniping.' },
  { id: 'scroll-tick', section: 'trackball', title: 'Scroll sensitivity', type: 'number', min: 1, max: 200, default: 20, target: { kind: 'kconfig', symbol: 'PMW3610_SCROLL_TICK', scope: 'central' }, requires: 'pmw3610',
    description: 'Ball movement needed per scroll step on a scroll layer. Higher means slower scrolling.' },
  { id: 'orientation', section: 'trackball', title: 'Sensor rotation', type: 'select', default: '0', requires: 'pmw3610',
    target: { kind: 'kconfig-choice', scope: 'central', options: [
      { value: '0', symbol: 'PMW3610_ORIENTATION_0' }, { value: '90', symbol: 'PMW3610_ORIENTATION_90' }, { value: '180', symbol: 'PMW3610_ORIENTATION_180' }, { value: '270', symbol: 'PMW3610_ORIENTATION_270' },
    ] }, options: [{ value: '0', label: '0°' }, { value: '90', label: '90° clockwise' }, { value: '180', label: '180°' }, { value: '270', label: '270° clockwise' }],
    description: 'Rotate the sensor so that rolling the ball up moves the pointer up.', oryx: 'Rotation' },
  { id: 'invert-x', section: 'trackball', title: 'Invert X', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'PMW3610_INVERT_X', scope: 'central' }, requires: 'pmw3610', description: 'Reverse left/right pointer movement.' },
  { id: 'invert-y', section: 'trackball', title: 'Invert Y', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'PMW3610_INVERT_Y', scope: 'central' }, requires: 'pmw3610', description: 'Reverse up/down pointer movement.' },
  { id: 'invert-scroll-x', section: 'trackball', title: 'Invert horizontal scroll', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'PMW3610_INVERT_SCROLL_X', scope: 'central' }, requires: 'pmw3610',
    description: 'Reverse sideways scrolling (defaults to "Invert X").', oryx: 'Invert scrolling X axis' },
  { id: 'invert-scroll-y', section: 'trackball', title: 'Natural vertical scroll', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'PMW3610_INVERT_SCROLL_Y', scope: 'central' }, requires: 'pmw3610',
    description: 'Reverse vertical scrolling so content follows the ball (defaults to "Invert Y").', oryx: 'Invert scrolling Y axis' },
  { id: 'polling', section: 'trackball', title: 'Polling rate', type: 'select', default: '250', requires: 'pmw3610',
    target: { kind: 'kconfig-choice', scope: 'central', options: [
      { value: '250', symbol: 'PMW3610_POLLING_RATE_250' }, { value: '125', symbol: 'PMW3610_POLLING_RATE_125' }, { value: '125-sw', symbol: 'PMW3610_POLLING_RATE_125_SW' },
    ] }, options: [{ value: '250', label: '250 Hz' }, { value: '125', label: '125 Hz' }, { value: '125-sw', label: '125 Hz (software)' }],
    description: 'How often the sensor is read. 125 Hz saves battery and is smoother over Bluetooth.' },
  { id: 'smart', section: 'trackball', title: 'Smart surface algorithm', type: 'toggle', default: true, target: { kind: 'kconfig', symbol: 'PMW3610_SMART_ALGORITHM', scope: 'central' }, requires: 'pmw3610',
    description: 'Sensor algorithm that tracks better on difficult surfaces.' },
  { id: 'force-awake', section: 'trackball', title: 'Keep sensor awake', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'PMW3610_FORCE_AWAKE', scope: 'central' }, requires: 'pmw3610',
    description: 'Never let the sensor rest. Removes the small delay when you first touch the ball, at a large battery cost.' },
  { id: 'run-downshift', section: 'trackball', title: 'Rest after', type: 'number', unit: ms, min: 13, max: 3264, default: 128, target: { kind: 'kconfig', symbol: 'PMW3610_RUN_DOWNSHIFT_TIME_MS', scope: 'central' }, requires: 'pmw3610',
    description: 'Time without movement before the sensor drops into its first rest mode.' },
  { id: 'scroll-layers', section: 'trackball', title: 'Scroll layers', type: 'layers', target: { kind: 'overlay', label: 'trackball', prop: 'scroll-layers' }, requires: 'pmw3610',
    description: 'While one of these layers is the highest active layer, the ball scrolls instead of moving the pointer. Kept in step when you reorder layers.' },
  { id: 'snipe-layers', section: 'trackball', title: 'Snipe layers', type: 'layers', target: { kind: 'overlay', label: 'trackball', prop: 'snipe-layers' }, requires: 'pmw3610',
    description: 'While one of these layers is the highest active layer, the ball uses the sniping speed.' },

  // Auto-mouse (input processor in the overlay)
  { id: 'am-layer', section: 'automouse', title: 'Mouse layer', type: 'layer', target: { kind: 'overlay', label: 'trackball_listener', prop: 'input-processors', cell: 1 }, requires: 'auto-mouse',
    description: 'Layer turned on while the ball moves.' },
  { id: 'am-timeout', section: 'automouse', title: 'Turn off after', type: 'number', unit: ms, min: 50, max: 5000, step: 50, target: { kind: 'overlay', label: 'trackball_listener', prop: 'input-processors', cell: 2 }, requires: 'auto-mouse',
    description: 'How long the mouse layer stays on after the ball stops.', oryx: 'Auto-mouse deactivation delay' },
  { id: 'am-idle', section: 'automouse', title: 'Ignore after typing', type: 'number', unit: ms, min: 0, max: 2000, step: 25, target: { kind: 'overlay', label: 'zip_auto_mouse', prop: 'require-prior-idle-ms' }, requires: 'auto-mouse',
    description: 'Do not switch to the mouse layer if a key was pressed this recently (stops a nudge of the ball while typing from hijacking keys).', oryx: 'Auto-mouse activation threshold' },

  // Mouse keys
  { id: 'mmv-speed', section: 'mousekeys', title: 'Pointer key speed', type: 'number', min: 100, max: 5000, step: 50, default: 600, target: { kind: 'define', name: 'ZMK_POINTING_DEFAULT_MOVE_VAL' },
    description: 'Top speed of the &mmv keys.', oryx: 'Mousekey max speed' },
  { id: 'mmv-accel', section: 'mousekeys', title: 'Pointer key acceleration time', type: 'number', unit: ms, min: 0, max: 5000, step: 10, default: 300, target: { kind: 'override', behavior: 'mmv', prop: 'time-to-max-speed-ms' },
    description: 'Time to reach top speed.', oryx: 'Mousekey time to max' },
  { id: 'msc-speed', section: 'mousekeys', title: 'Scroll key speed', type: 'number', min: 1, max: 500, default: 10, target: { kind: 'define', name: 'ZMK_POINTING_DEFAULT_SCRL_VAL' },
    description: 'Speed of the &msc scroll keys.', oryx: 'Mousewheel max speed' },
  { id: 'msc-accel', section: 'mousekeys', title: 'Scroll key acceleration time', type: 'number', unit: ms, min: 0, max: 5000, step: 10, default: 300, target: { kind: 'override', behavior: 'msc', prop: 'time-to-max-speed-ms' },
    description: 'Time to reach top scroll speed.', oryx: 'Mousewheel time to max speed' },
  { id: 'msc-exp', section: 'mousekeys', title: 'Scroll key acceleration curve', type: 'number', min: 0, max: 5, default: 0, target: { kind: 'override', behavior: 'msc', prop: 'acceleration-exponent' },
    description: '0 scrolls at a constant speed; higher values speed up more sharply.' },

  // Studio
  { id: 'studio', section: 'studio', title: 'ZMK Studio', type: 'toggle', default: false, target: { kind: 'kconfig', symbol: 'ZMK_STUDIO', scope: 'central' },
    description: 'Allow live keymap changes from ZMK Studio over USB. Studio changes are stored on the keyboard and override this keymap until you reset them in Studio.' },
  { id: 'studio-lock', section: 'studio', title: 'Require unlock', type: 'toggle', default: true, target: { kind: 'kconfig', symbol: 'ZMK_STUDIO_LOCKING', scope: 'central' }, dependsOn: { id: 'studio', value: true },
    description: 'Studio must be unlocked with a &studio_unlock key before it can make changes.' },
]

// ---------------------------------------------------------------------------
// .conf files

export interface ConfFile {
  path: string
  scope: Scope
  text: string
}

interface ConfHit { file: ConfFile; lineIndex: number; value: string }

function confLines(text: string): string[] {
  return text.split('\n')
}

/** Effective value of a Kconfig symbol. Later files in `confs` take precedence. */
export function findKconfig(confs: ConfFile[], symbol: string, scope?: Scope): ConfHit | undefined {
  let hit: ConfHit | undefined
  for (const file of confs) {
    if (scope && scope !== 'both' && file.scope !== 'both' && file.scope !== scope) continue
    confLines(file.text).forEach((line, lineIndex) => {
      const m = line.match(/^\s*CONFIG_([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m && m[1] === symbol) hit = { file, lineIndex, value: m[2] }
      const n = line.match(/^\s*#\s*CONFIG_([A-Z0-9_]+) is not set/)
      if (n && n[1] === symbol) hit = { file, lineIndex, value: 'n' }
    })
  }
  return hit
}

/** Set a Kconfig symbol (`undefined` removes it so the default applies). Returns new conf list. */
export function setKconfig(confs: ConfFile[], symbol: string, value: string | undefined, scope: Scope): ConfFile[] {
  const hit = findKconfig(confs, symbol)
  const next = confs.map((c) => ({ ...c }))
  if (hit) {
    const file = next.find((c) => c.path === hit.file.path)!
    const lines = confLines(file.text)
    if (value === undefined) lines.splice(hit.lineIndex, 1)
    else lines[hit.lineIndex] = `CONFIG_${symbol}=${value}`
    file.text = lines.join('\n')
    return next
  }
  if (value === undefined) return next
  // The last file of a scope is the most specific one (the user config for "both").
  const target = next.findLast((c) => c.scope === scope) ?? next.findLast((c) => c.scope === 'both') ?? next[0]
  if (!target) return next
  const text = target.text.replace(/\s*$/, '')
  target.text = (text ? text + '\n' : '') + `CONFIG_${symbol}=${value}\n`
  return next
}

export function kconfigBool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined
  return v === 'y'
}

export function unquoteConf(v: string): string {
  return v.replace(/^"(.*)"$/, '$1')
}
