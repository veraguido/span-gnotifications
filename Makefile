UUID     = span-gnotifications@veraguido.proton.me
INSTALL  = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMAS  = schemas

.PHONY: all install uninstall schemas reload

all: schemas

schemas:
	glib-compile-schemas $(SCHEMAS)/

install: schemas
	mkdir -p $(INSTALL)
	cp -r extension.js prefs.js metadata.json stylesheet.css $(INSTALL)/
	mkdir -p $(INSTALL)/schemas
	cp $(SCHEMAS)/*.xml $(SCHEMAS)/*.compiled $(INSTALL)/schemas/

uninstall:
	rm -rf $(INSTALL)

# Restart GNOME Shell (Wayland – requires logout/login; Xorg – restarts in-place)
reload:
	gnome-shell --replace &

# Open the extension preferences directly
prefs:
	gnome-extensions prefs $(UUID)

# Enable the extension
enable:
	gnome-extensions enable $(UUID)

# Check for JS errors in the extension logs
logs:
	journalctl -f /usr/bin/gnome-shell --since "1 min ago" | grep -i "span-gnotif\|SpanGNotif"
