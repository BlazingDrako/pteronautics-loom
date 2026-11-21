#!/usr/bin/env python3
"""Get the desktop build ready: copy the app's files into desktop/tauri/dist and set the
version in the Tauri configuration and Cargo.toml from src/version.js.

    python3 desktop/stage.py
    cd desktop/tauri && cargo tauri build      (needs Rust and the Tauri CLI: cargo install tauri-cli)
"""
import json
import os
import re
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TAURI = os.path.join(HERE, "tauri")
DIST = os.path.join(TAURI, "dist")
COPY = ["index.html", "manifest.webmanifest", "css", "src", "assets"]


def main():
    with open(os.path.join(ROOT, "src", "version.js"), encoding="utf-8") as fh:
        version = re.search(r"VERSION\s*=\s*'([^']+)'", fh.read()).group(1)
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)
    for item in COPY:
        src = os.path.join(ROOT, item)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(DIST, item))
        else:
            shutil.copy2(src, os.path.join(DIST, item))

    conf_path = os.path.join(TAURI, "tauri.conf.json")
    with open(conf_path, encoding="utf-8") as fh:
        conf = json.load(fh)
    conf["version"] = version
    with open(conf_path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(conf, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    cargo_path = os.path.join(TAURI, "Cargo.toml")
    with open(cargo_path, encoding="utf-8") as fh:
        cargo = fh.read()
    cargo = re.sub(r'(?m)^version = "[^"]*"', f'version = "{version}"', cargo, count=1)
    with open(cargo_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(cargo)
    print(f"Staged Loom {version} in {os.path.relpath(DIST, ROOT)}")


if __name__ == "__main__":
    main()
