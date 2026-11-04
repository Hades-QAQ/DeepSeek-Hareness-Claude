"""Capture only subscription usage fields from Claude Code statusLine stdin."""
import json
import os
from pathlib import Path
import sys
import tempfile
import time

root = Path.home() / ".local/state/dsh-remote"
cache = root / "quota.json"
script = root / "quota.py"
settings = Path.home() / ".claude/settings.json"
command = 'python3 "$HOME/.local/state/dsh-remote/quota.py"'

def save(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, mode="w", delete=False) as f:
        f.write(data)
    os.replace(f.name, path)

if sys.argv[1:] == ["install"]:
    config = json.loads(settings.read_text()) if settings.exists() else {}
    existing = config.get("statusLine")
    if existing and existing.get("command") != command:
        sys.exit("已有自定义 Claude 状态栏，未替换")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    save(script, Path(__file__).read_text())
    if not existing:
        config["statusLine"] = {"type": "command", "command": command}
        settings.parent.mkdir(parents=True, exist_ok=True)
        save(settings, json.dumps(config, ensure_ascii=False, indent=2) + "\n")
else:
    limits = json.load(sys.stdin).get("rate_limits") or {}
    windows = {}
    for name in ("five_hour", "seven_day"):
        item = limits.get(name) or {}
        used = item.get("used_percentage")
        reset = item.get("resets_at")
        if type(used) in (int, float) and 0 <= used <= 100:
            windows[name] = {"remaining": round(100-used, 1),
                             "reset": reset if type(reset) in (int, float) else None}
    save(cache, json.dumps({"updated": int(time.time()), "windows": windows}))
    print(" · ".join(label + " " + str(windows[key]["remaining"]) + "% left"
                     for key, label in (("five_hour", "5h"), ("seven_day", "7d"))
                     if key in windows))
