# What Oryx does (and how this editor maps it to ZMK)

Notes from examining ZSA's Oryx configurator (configure.zsa.io) with REA, 2026-11-24, using
the public read-only view of a Voyager layout. Oryx's JavaScript bundle (a React + MobX
State Tree app) was captured and read statically; nothing was executed outside a normal page
load. The key-editing panel is a lazy chunk that only loads for editable layouts, so its
behaviour comes from the store models rather than the panel's markup.

## Key model

Each key (`mi` action model in the bundle) has up to four **steps**:

```
tap, hold, doubleTap, tapHold   each: { code, modifiers, layer, macro, color }
customLabel, icon, emoji, tappingTerm (per key), glowColor
```

`availableSteps` lists the empty ones as "tapped", "held", "double-tapped" and "tapped and
then held". Oryx derives the firmware construct from which steps are set:

- `isModTap`: tap is unshifted, not a layer key, hold is a modifier → QMK mod-tap
- `isLT`: hold is `MO` → layer-tap
- `isTapDance`: double tap or tap-hold set → tap dance
- conflicts: e.g. "Multiple modifiers on hold won't work for this key assignment"

This editor uses the same four steps (`src/core/composer.ts`) and compiles them to `&mt`,
`&lt`, existing hold-tap behaviours, or generated hold-tap/tap-dance nodes.

## Key metadata

`/metadata.json` lists ~2500 keycodes with `category`, `label`, `searchLabel`, `jsCode`
(the browser `KeyboardEvent.code`, used to pick a key by pressing it), per-OS labels, and
flags for which steps a code may be used in (`tap`, `hold`, `doubleTap`, `tapHold`,
`comboPickable`, `comboTrigger`). Categories include letters, modifiers, layer switch, media,
mouse, navigation, numpad, firmware, colour control and ~35 language layouts.

## Combos

Named, with `keyIndices`, a trigger key (itself a full key with steps), `layerIdx` or
`allowedLayerIndices`, and conflict checks (same positions on a shared layer, ineligible
dual-function keys). Settings `comboTerm` (10-100 ms) and `layerIndependentCombos`.

## Settings catalogue

Declarative: sections (`autoshift`, `audio`, `debounce`, `misc`, `mouse`, `tapping`,
`oneshot`, `holding`, `navigator`) of
`{ key, title, description, type: toggle | slider, min, max, unit, default, toggleable,
dependsOn, geometry, navigatorKind }`. Changing a setting away from its default counts as a
change. Notable entries and their ZMK equivalents:

| Oryx | ZMK |
|---|---|
| Tapping term, per-key tapping term | `tapping-term-ms` on the hold-tap; a separate hold-tap per key |
| Permissive hold | `flavor = "balanced"` |
| Hold on other key press | `flavor = "hold-preferred"` / `tap-unless-interrupted` |
| Retro tapping | `retro-tap` |
| Tap flow | `require-prior-idle-ms` |
| Chordal hold (+ exclude thumbs) | `hold-trigger-key-positions` (opposite hand + thumbs) |
| Oneshot timeout | `&sk release-after-ms` |
| Combo term | combo `timeout-ms` |
| Debounce | `CONFIG_ZMK_KSCAN_DEBOUNCE_PRESS_MS` |
| Disable N-key rollover | `CONFIG_ZMK_HID_REPORT_TYPE_NKRO` |
| RGB hue / brightness step, RGB timeout | `CONFIG_ZMK_RGB_UNDERGLOW_HUE_STEP` / `_BRT_STEP` / `_AUTO_OFF_IDLE` |
| Mousekey max speed, time to max | `ZMK_POINTING_DEFAULT_MOVE_VAL`, `&mmv time-to-max-speed-ms` |
| Navigator: auto-mouse delay, threshold | auto-mouse input processor timeout, `require-prior-idle-ms` |
| Navigator: invert scroll X/Y, rotation | `CONFIG_PMW3610_INVERT_SCROLL_X/Y`, `CONFIG_PMW3610_ORIENTATION_*` |

The settings page (`src/core/settings.ts`) follows the same shape and shows the Oryx name
next to each ZMK setting.

## Visual language

Layer tabs with index and colour; keys show the tap legend large, the hold action small at
the bottom (layer name or modifier), modifier icons, and colour by function. Transparent
keys show the layer below.
