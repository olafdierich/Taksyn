#!/usr/bin/env python3
# Phase A.1 fix - raise InfoDot popup stacking so the box renders ABOVE the
# risk pill / rating text instead of behind them.
# Abort-safe: asserts exactly one match for each change; writes only if both succeed.

import sys
PATH = '/workspaces/Taksyn/taksyn/src/App.jsx'

with open(PATH, 'r', encoding='utf-8') as f:
    src = f.read()
orig = src

edits = [
    # backdrop: fixed full-screen dimmer
    (
        "style={{position:'fixed',inset:0,zIndex:40}}/>",
        "style={{position:'fixed',inset:0,zIndex:9998}}/>",
    ),
    # the popup box itself
    (
        "<div style={{position:'absolute',top:20,left:0,zIndex:41,width:280,",
        "<div style={{position:'absolute',top:20,left:0,zIndex:9999,width:280,",
    ),
]

for old, new in edits:
    if src.count(old) != 1:
        print(f"ABORT: anchor matched {src.count(old)} times (need 1). No changes written.\n  {old}")
        sys.exit(1)

for old, new in edits:
    src = src.replace(old, new, 1)

if src == orig:
    print("ABORT: no change produced.")
    sys.exit(1)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(src)
print("OK - raised InfoDot popup z-index (backdrop 9998, box 9999)")
