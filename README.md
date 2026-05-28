# Span GNotifications

A GNOME Shell extension that lets you customise notification banners and distribute them across multiple monitors.

**Supported GNOME versions:** 45 · 46 · 47 · 48 · 49 · 50

---

## Features

| Category | Options |
|---|---|
| **Position** | Top-left / Top-centre / Top-right / Bottom-left / Bottom-centre / Bottom-right |
| **Multi-monitor** | Primary monitor only · Follow mouse pointer · Duplicate on all monitors |
| **Appearance** | Background colour, text colour, banner width, inner padding |
| **Typography** | Font size, font weight |
| **Icon** | Show/hide, custom size |
| **Sound** | Global override with a custom audio file or silence; per-application overrides |
| **Fullscreen** | Show banners even while an application is running fullscreen |

---

## Sound override behaviour

The extension evaluates sound overrides in priority order for every incoming notification:

| Situation | Sound played |
|---|---|
| App has a per-app override with a sound file set | Custom file for that app |
| App has a per-app override set to **Silence** | Silent (no sound) |
| App has **no** per-app override — global override **on**, sound file set | Custom file for all apps |
| App has **no** per-app override — global override **on**, no file | Silent (no sound) |
| App has **no** per-app override — global override **off** | OS default sound |

**Per-app overrides always take precedence over the global setting.** Removing a per-app override (the trash icon) returns that app to whichever behaviour the global setting dictates.

---

## Requirements

- GNOME Shell 45 or newer
- `glib-compile-schemas` (part of `glib2` / `libglib2.0-dev`)

On Fedora:
```bash
sudo dnf install glib2
```

On Ubuntu/Debian:
```bash
sudo apt install libglib2.0-bin
```

---

## Installation

### Option A — Makefile (recommended)

```bash
git clone https://github.com/veraguido/span-gnotifications.git
cd span-gnotifications
make install
```

Then **restart GNOME Shell** and enable the extension:

```bash
make enable
```

> **Wayland users:** you must log out and log back in instead of restarting the shell in-place.

### Option B — Manual

```bash
# 1. Clone the repo
git clone https://github.com/veraguido/span-gnotifications.git
cd span-gnotifications

# 2. Compile the GSettings schema
glib-compile-schemas schemas/

# 3. Copy files to the extensions directory
UUID="span-gnotifications@veraguido.proton.me"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

mkdir -p "$DEST/schemas"
cp extension.js prefs.js metadata.json stylesheet.css "$DEST/"
cp schemas/*.xml schemas/*.compiled "$DEST/schemas/"

# 4. Restart GNOME Shell (Xorg) or log out/in (Wayland)

# 5. Enable the extension
gnome-extensions enable "$UUID"
```

---

## Opening preferences

```bash
make prefs
# or
gnome-extensions prefs span-gnotifications@veraguido.proton.me
```

You can also open preferences from the **Extensions** app or GNOME Settings → Extensions.

---

## Uninstall

```bash
make uninstall
```

Or manually:

```bash
gnome-extensions disable span-gnotifications@veraguido.proton.me
rm -rf "$HOME/.local/share/gnome-shell/extensions/span-gnotifications@veraguido.proton.me"
```

---

## Troubleshooting

**Extension does not appear after install**
Log out and back in (required on Wayland). On Xorg you can run `gnome-shell --replace &` instead.

**Preferences window is blank or crashes**
Make sure the schema was compiled before installing:
```bash
glib-compile-schemas schemas/
```

**Check for errors in the GNOME Shell log**
```bash
make logs
# or
journalctl -f /usr/bin/gnome-shell | grep -i span-gnotif
```

**Notifications stopped showing after a crash**
Disable and re-enable the extension to reset all patches:
```bash
gnome-extensions disable span-gnotifications@veraguido.proton.me
gnome-extensions enable  span-gnotifications@veraguido.proton.me
```

---

## Development

All source lives directly in the repo root — no build step beyond schema compilation.

| File | Purpose |
|---|---|
| `extension.js` | Main logic: method patches, monitor routing, dynamic CSS |
| `prefs.js` | GTK4/Adwaita preferences dialog |
| `stylesheet.css` | Static base styles (minimal) |
| `schemas/` | GSettings schema (XML + compiled binary) |
| `Makefile` | `install`, `uninstall`, `enable`, `prefs`, `logs` targets |

After editing source files, re-run `make install` and restart/re-login to pick up the changes.

---

## Licence

GPL-2.0-or-later
