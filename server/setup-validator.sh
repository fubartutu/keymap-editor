#!/usr/bin/env bash
# Fetch the headers the validator needs: a sparse checkout of ZMK (matching your west.yml
# revision) and the Zephyr fork it builds against, plus Zephyr's python-devicetree library.
# About 15 MB. Nothing is installed system-wide.
set -euo pipefail
DIR="${ZMK_EDITOR_CACHE:-$HOME/.cache/zmk-keymap-editor}"
REV="${1:-v0.3}"
mkdir -p "$DIR" && cd "$DIR"
if [ ! -d zmk ]; then
  git clone -q --depth 1 --branch "$REV" --filter=blob:none --no-checkout https://github.com/zmkfirmware/zmk.git zmk
  (cd zmk && git sparse-checkout set --no-cone /app/include /app/dts /app/west.yml '/app/Kconfig*' && git checkout -q)
fi
ZREV=$(grep -A4 'name: zephyr' zmk/app/west.yml | grep revision | awk '{print $2}')
if [ ! -d zephyr ]; then
  git clone -q --depth 1 --branch "$ZREV" --filter=blob:none --no-checkout https://github.com/zmkfirmware/zephyr.git zephyr
  (cd zephyr && git sparse-checkout set --no-cone /include/zephyr/dt-bindings '/include/zephyr/sys/util*.h' /include/zephyr/toolchain.h /include/zephyr/devicetree.h /dts/common /scripts/dts/python-devicetree && git checkout -q)
fi
echo "Validator ready in $DIR (ZMK $REV, Zephyr $ZREV)"
