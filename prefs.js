// SPDX-License-Identifier: GPL-2.0-or-later
// Span GNotifications – preferences dialog

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SpanGNotificationsPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(680, 640);

        window.add(this._buildAppearancePage(settings));
        window.add(this._buildLayoutPage(settings));
        window.add(this._buildSoundPage(settings, window));

        // "Test notification" button in the header bar – reachable from any tab.
        const testBtn = new Gtk.Button({
            label: _('Test notification'),
            valign: Gtk.Align.CENTER,
        });
        testBtn.connect('clicked', () => this._sendTestNotification());
        this._addToHeaderBar(window, testBtn);
    }

    _addToHeaderBar(window, widget) {
        // Adw.PreferencesWindow owns its header bar internally; walk the widget
        // tree to find it rather than relying on an undocumented public accessor.
        const walk = w => {
            if (w instanceof Adw.HeaderBar)
                return w;
            let child = w.get_first_child();
            while (child) {
                const found = walk(child);
                if (found)
                    return found;
                child = child.get_next_sibling();
            }
            return null;
        };
        const bar = walk(window);
        if (bar)
            bar.pack_end(widget);
    }

    _sendTestNotification() {
        try {
            Gio.Subprocess.new(
                ['notify-send',
                 '--app-name=Span GNotifications',
                 '--icon=preferences-system-notifications-symbolic',
                 'Test Notification',
                 'Span GNotifications is working correctly.'],
                Gio.SubprocessFlags.NONE
            );
        } catch (e) {
            console.error(`[SpanGNotifications prefs] ${e}`);
        }
    }

    // -------------------------------------------------------------------------
    // Appearance page
    // -------------------------------------------------------------------------

    _buildAppearancePage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Appearance'),
            icon_name: 'applications-graphics-symbolic',
        });

        // --- Colours group ---
        const colourGroup = new Adw.PreferencesGroup({title: _('Colours')});
        page.add(colourGroup);

        colourGroup.add(this._colorRow(_('Background colour'), settings, 'background-color'));
        colourGroup.add(this._colorRow(_('Text colour'), settings, 'text-color'));

        // --- Typography group ---
        const typGroup = new Adw.PreferencesGroup({title: _('Typography')});
        page.add(typGroup);

        typGroup.add(this._spinRow(_('Font size (pt)'), settings, 'font-size', 6, 28));

        const weightRow = new Adw.ComboRow({
            title: _('Font weight'),
            model: this._stringList(['normal', 'bold']),
            selected: settings.get_string('font-weight') === 'bold' ? 1 : 0,
        });
        weightRow.connect('notify::selected', () => {
            settings.set_string('font-weight', weightRow.selected === 1 ? 'bold' : 'normal');
        });
        typGroup.add(weightRow);

        // --- Size group ---
        const sizeGroup = new Adw.PreferencesGroup({title: _('Size & Spacing')});
        page.add(sizeGroup);

        sizeGroup.add(this._spinRow(_('Banner width (px)'), settings, 'notification-width', 200, 900));
        sizeGroup.add(this._spinRow(_('Inner padding (px)'), settings, 'notification-padding', 0, 48));
        sizeGroup.add(this._spinRow(_('Margin (px)'), settings, 'notification-margin', 0, 100));

        // --- Icon group ---
        const iconGroup = new Adw.PreferencesGroup({title: _('Icon')});
        page.add(iconGroup);

        const showIconRow = new Adw.SwitchRow({title: _('Show icon')});
        settings.bind('show-icon', showIconRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        iconGroup.add(showIconRow);

        const iconSizeRow = this._spinRow(_('Icon size (px)'), settings, 'icon-size', 16, 96);
        settings.bind('show-icon', iconSizeRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        iconGroup.add(iconSizeRow);

        return page;
    }

    // -------------------------------------------------------------------------
    // Layout page
    // -------------------------------------------------------------------------

    _buildLayoutPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Layout'),
            icon_name: 'video-display-symbolic',
        });

        // --- Position group ---
        const posGroup = new Adw.PreferencesGroup({
            title: _('Banner position'),
            description: _('Corner of the screen where notification banners appear'),
        });
        page.add(posGroup);

        const positions = [
            'top-left', 'top-center', 'top-right',
            'bottom-left', 'bottom-center', 'bottom-right',
        ];
        const posLabels = [
            _('Top left'), _('Top centre'), _('Top right'),
            _('Bottom left'), _('Bottom centre'), _('Bottom right'),
        ];

        const posRow = new Adw.ComboRow({
            title: _('Position'),
            model: this._stringList(posLabels),
            selected: Math.max(0, positions.indexOf(settings.get_string('notification-position'))),
        });
        posRow.connect('notify::selected', () => {
            settings.set_string('notification-position', positions[posRow.selected]);
        });
        posGroup.add(posRow);

        // --- Monitor group ---
        const monGroup = new Adw.PreferencesGroup({
            title: _('Multi-monitor'),
            description: _('How notifications are distributed across connected monitors'),
        });
        page.add(monGroup);

        const modes = ['primary-only', 'follow-mouse', 'duplicate-all'];
        const modeLabels = [
            _('Primary monitor only'),
            _('Follow mouse pointer'),
            _('Replicate on all monitors'),
        ];
        const modeDescs = [
            _('Notifications always appear on the primary monitor (default GNOME behaviour).'),
            _('Each banner appears on whichever monitor the mouse pointer is on when the notification arrives.'),
            _('Every notification banner appears simultaneously on all connected monitors.'),
        ];

        let firstCheck = null;
        modes.forEach((mode, i) => {
            const check = new Gtk.CheckButton({
                valign: Gtk.Align.CENTER,
                active: settings.get_string('monitor-mode') === mode,
            });
            if (firstCheck === null)
                firstCheck = check;
            else
                check.group = firstCheck;

            check.connect('toggled', () => {
                if (check.active)
                    settings.set_string('monitor-mode', mode);
            });

            const row = new Adw.ActionRow({
                title: modeLabels[i],
                subtitle: modeDescs[i],
                activatable_widget: check,
            });
            row.add_prefix(check);
            monGroup.add(row);
        });

        // --- Fullscreen group ---
        const fsGroup = new Adw.PreferencesGroup({
            title: _('Fullscreen'),
        });
        page.add(fsGroup);

        const fsRow = new Adw.SwitchRow({
            title: _('Show notifications in fullscreen'),
            subtitle: _('When enabled, banners appear even while an app is running fullscreen. GNOME normally suppresses them in that state.'),
        });
        settings.bind('show-in-fullscreen', fsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        fsGroup.add(fsRow);

        // --- Timing group ---
        const timingGroup = new Adw.PreferencesGroup({title: _('Timing')});
        page.add(timingGroup);

        timingGroup.add(this._spinRow(_('Auto-hide delay (s)'), settings, 'notification-timeout', 1, 30));

        return page;
    }

    // -------------------------------------------------------------------------
    // Sound page
    // -------------------------------------------------------------------------

    _buildSoundPage(settings, window) {
        const page = new Adw.PreferencesPage({
            title: _('Sound'),
            icon_name: 'audio-volume-high-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: _('Sound override'),
            description: _('Replace or silence the default notification sound.'),
        });
        page.add(group);

        const enableRow = new Adw.SwitchRow({title: _('Override notification sound')});
        settings.bind('sound-override-enabled', enableRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        group.add(enableRow);

        // File picker row
        const currentPath = settings.get_string('sound-file');
        const fileRow = new Adw.ActionRow({
            title: _('Sound file'),
            subtitle: _('Leave empty to silence notifications'),
        });
        settings.bind('sound-override-enabled', fileRow, 'sensitive',
            Gio.SettingsBindFlags.DEFAULT);

        const fileLabel = new Gtk.Label({
            label: currentPath ? GLib.path_get_basename(currentPath) : _('(none – silence)'),
            ellipsize: 3, // Pango.EllipsizeMode.END
            xalign: 1,
            valign: Gtk.Align.CENTER,
            hexpand: true,
        });

        const chooseBtn = new Gtk.Button({
            label: _('Choose…'),
            valign: Gtk.Align.CENTER,
        });
        chooseBtn.connect('clicked', () => {
            this._openFilePicker(settings, fileLabel, window);
        });

        const clearBtn = new Gtk.Button({
            label: _('Clear'),
            valign: Gtk.Align.CENTER,
        });
        clearBtn.connect('clicked', () => {
            settings.set_string('sound-file', '');
            fileLabel.label = _('(none – silence)');
        });

        fileRow.add_suffix(fileLabel);
        fileRow.add_suffix(chooseBtn);
        fileRow.add_suffix(clearBtn);
        group.add(fileRow);

        return page;
    }

    _openFilePicker(settings, fileLabel, window) {
        const dialog = new Gtk.FileDialog({
            title: _('Select a sound file'),
            modal: true,
        });

        // Filter for audio files
        const filter = new Gtk.FileFilter();
        filter.set_name(_('Audio files'));
        ['audio/mpeg', 'audio/ogg', 'audio/x-wav', 'audio/flac', 'audio/aac'].forEach(
            mime => filter.add_mime_type(mime));
        ['*.mp3', '*.ogg', '*.wav', '*.flac', '*.aac', '*.oga'].forEach(
            pat => filter.add_pattern(pat));

        const filters = new Gio.ListStore({item_type: Gtk.FileFilter.$gtype});
        filters.append(filter);
        dialog.filters = filters;

        const currentPath = settings.get_string('sound-file');
        if (currentPath) {
            try {
                dialog.initial_file = Gio.File.new_for_path(currentPath);
            } catch { /* ignore */ }
        }

        dialog.open(window, null, (dlg, result) => {
            try {
                const file = dlg.open_finish(result);
                const path = file.get_path();
                settings.set_string('sound-file', path);
                fileLabel.label = GLib.path_get_basename(path);
            } catch { /* user cancelled */ }
        });
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    _spinRow(title, settings, key, min, max) {
        const adj = new Gtk.Adjustment({lower: min, upper: max, step_increment: 1});
        const spin = new Gtk.SpinButton({adjustment: adj, valign: Gtk.Align.CENTER});
        settings.bind(key, spin, 'value', Gio.SettingsBindFlags.DEFAULT);

        const row = new Adw.ActionRow({title, activatable_widget: spin});
        row.add_suffix(spin);
        return row;
    }

    _colorRow(title, settings, key) {
        const dialog = new Gtk.ColorDialog({title, with_alpha: true});
        const btn = new Gtk.ColorDialogButton({
            dialog,
            valign: Gtk.Align.CENTER,
        });

        // Load initial colour from settings
        const rgba = new Gdk.RGBA();
        rgba.parse(settings.get_string(key));
        btn.rgba = rgba;

        btn.connect('notify::rgba', () => {
            settings.set_string(key, btn.rgba.to_string());
        });

        // Sync back when setting changes from elsewhere
        settings.connect(`changed::${key}`, () => {
            const r = new Gdk.RGBA();
            r.parse(settings.get_string(key));
            if (r.to_string() !== btn.rgba.to_string())
                btn.rgba = r;
        });

        const row = new Adw.ActionRow({title, activatable_widget: btn});
        row.add_suffix(btn);
        return row;
    }

    _stringList(labels) {
        const store = new Gtk.StringList();
        labels.forEach(l => store.append(l));
        return store;
    }
}
