#!/usr/bin/env python3
"""Write sw.js: the service worker that lets Pteronautics Loom work offline and be installed.

Run after adding, removing or changing app files (the tests check that sw.js is current):

    python3 tools/precache.py

It lists every file the app needs (the page, manifest, styles, scripts, fonts and icons) and
names the cache after the version and a hash of those files, so any change makes installed
copies fetch the new files.
"""
import hashlib
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOP = ["index.html", "manifest.webmanifest"]
DIRS = ["css", "src", "assets"]
SKIP = re.compile(r"(^|/)\.|\.(txt|md)$")


def files():
    out = list(TOP)
    for d in DIRS:
        for base, dirs, names in os.walk(os.path.join(ROOT, d)):
            dirs[:] = sorted(x for x in dirs if not x.startswith("."))
            for n in sorted(names):
                rel = os.path.relpath(os.path.join(base, n), ROOT).replace(os.sep, "/")
                if not SKIP.search(rel):
                    out.append(rel)
    return out


def main():
    listed = files()
    h = hashlib.sha256()
    for f in listed:
        h.update(f.encode())
        with open(os.path.join(ROOT, f), "rb") as fh:
            h.update(fh.read())
    with open(os.path.join(ROOT, "src", "version.js"), encoding="utf-8") as fh:
        version = re.search(r"VERSION\s*=\s*'([^']+)'", fh.read()).group(1)
    with open(os.path.join(ROOT, "tools", "sw.template.js"), encoding="utf-8") as fh:
        template = fh.read()
    text = (template
            .replace("__CACHE__", f"loom-{version}-{h.hexdigest()[:10]}")
            .replace("__FILES__", json.dumps(listed, indent=2)))
    with open(os.path.join(ROOT, "sw.js"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    print(f"sw.js: {len(listed)} files, cache loom-{version}-{h.hexdigest()[:10]}")


if __name__ == "__main__":
    main()
