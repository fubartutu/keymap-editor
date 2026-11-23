"""
Check a ZMK keymap the way the firmware build sees it: run the C preprocessor with the real
ZMK and Zephyr headers, parse the result with Zephyr's own devicetree library (dtlib), then
count each layer's bindings using every behaviour's #binding-cells.

Usage: python validate.py <toolchain_dir> <keymap_file> <expected_key_count> [extra_include_dir]
Prints a JSON object: {"ok": bool, "errors": [...], "warnings": [...], "layers": {...}}
"""
import json
import struct
import os
import subprocess
import sys
import tempfile


def main():
    tool_dir, keymap_path, key_count = sys.argv[1], sys.argv[2], int(sys.argv[3])
    extra_inc = sys.argv[4] if len(sys.argv) > 4 else None
    sys.path.insert(0, os.path.join(tool_dir, "zephyr", "scripts", "dts", "python-devicetree", "src"))
    from devicetree import dtlib  # noqa: E402

    errors, warnings, layers = [], [], {}
    with tempfile.TemporaryDirectory() as tmp:
        wrapper = os.path.join(tmp, "wrap.dts")
        out = os.path.join(tmp, "out.dts")
        with open(wrapper, "w", encoding="utf-8") as f:
            f.write('/dts-v1/;\n/ { };\n#include "%s"\n' % os.path.abspath(keymap_path))
        inc = [
            os.path.join(tool_dir, "zmk", "app", "include"),
            os.path.join(tool_dir, "zmk", "app", "dts"),
            os.path.join(tool_dir, "zephyr", "include"),
            os.path.join(tool_dir, "zephyr", "include", "zephyr"),
            os.path.join(tool_dir, "zephyr", "dts", "common"),
            os.path.dirname(os.path.abspath(keymap_path)),
        ] + ([extra_inc] if extra_inc else [])
        cmd = ["cpp", "-nostdinc", "-undef", "-x", "assembler-with-cpp", "-P", "-D__DTS__"]
        for i in inc:
            cmd += ["-I", i]
        cmd += [wrapper, "-o", out]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        for line in proc.stderr.splitlines():
            if "error" in line and "backslash-newline" not in line:
                errors.append(line.replace(tmp + os.sep, ""))
        if proc.returncode != 0:
            print(json.dumps({"ok": False, "stage": "preprocessor", "errors": errors or [proc.stderr[-2000:]], "warnings": [], "layers": {}}))
            return

        try:
            dt = dtlib.DT(out)
        except dtlib.DTError as e:
            print(json.dumps({"ok": False, "stage": "devicetree", "errors": [str(e)], "warnings": [], "layers": {}}))
            return

        def binding_list(prop, where):
            # Phandles are resolved into the raw value; to_nums() refuses phandle-typed props.
            cells = struct.unpack(">%dI" % (len(prop.value) // 4), prop.value)
            # Cells that were written as &references in the source. A binding that is missing
            # a parameter shifts everything after it, so a phandle must sit exactly where the
            # previous binding's #binding-cells say the next behaviour starts.
            refs = {m[0] // 4 for m in prop._markers if m[1] == dtlib._MarkerType.PHANDLE}
            out_list, i = [], 0
            while i < len(cells):
                node = dt.phandle2node.get(cells[i])
                if refs and i not in refs:
                    prev = out_list[-1] if out_list else "the start"
                    errors.append("%s: binding %d (after &%s) has the wrong number of parameters" % (where, len(out_list), prev))
                    return out_list
                if node is None:
                    errors.append("%s: cell %d is not a behaviour reference" % (where, i))
                    return out_list
                n = node.props["#binding-cells"].to_num() if "#binding-cells" in node.props else 0
                label = node.labels[0] if node.labels else node.name
                out_list.append(label)
                i += 1 + n
            extra = sorted(r for r in refs if r >= i)
            if i != len(cells) or extra:
                errors.append("%s: the last binding is missing parameters" % where)
            return out_list

        keymaps = [n for n in dt.node_iter() if "compatible" in n.props and n.props["compatible"].to_string() == "zmk,keymap"]
        if not keymaps:
            errors.append("No node with compatible = \"zmk,keymap\"")
        for km in keymaps:
            for name, layer in km.nodes.items():
                if "bindings" not in layer.props:
                    errors.append("Layer %s has no bindings" % name)
                    continue
                found = binding_list(layer.props["bindings"], "Layer " + name)
                layers[name] = len(found)
                if len(found) != key_count:
                    errors.append("Layer %s has %d bindings, the keyboard has %d keys" % (name, len(found), key_count))

        for node in dt.node_iter():
            compat = node.props["compatible"].to_string() if "compatible" in node.props else ""
            if compat == "zmk,combos":
                for name, combo in node.nodes.items():
                    if "bindings" in combo.props:
                        b = binding_list(combo.props["bindings"], "Combo " + name)
                        if len(b) != 1:
                            errors.append("Combo %s must have exactly one binding (has %d)" % (name, len(b)))
                    if "key-positions" in combo.props:
                        for pos in struct.unpack(">%dI" % (len(combo.props["key-positions"].value) // 4), combo.props["key-positions"].value):
                            if pos >= key_count:
                                errors.append("Combo %s uses key position %d (keyboard has %d keys)" % (name, pos, key_count))
            elif compat in ("zmk,behavior-tap-dance", "zmk,behavior-mod-morph", "zmk,behavior-macro"):
                if "bindings" in node.props:
                    binding_list(node.props["bindings"], "Behaviour " + (node.labels[0] if node.labels else node.name))

    print(json.dumps({"ok": not errors, "stage": "done", "errors": errors, "warnings": warnings, "layers": layers}))


if __name__ == "__main__":
    main()
