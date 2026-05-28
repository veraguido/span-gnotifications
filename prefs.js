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

        // --- Global override group ---
        const globalGroup = new Adw.PreferencesGroup({
            title: _('Global sound override'),
            description: _('Replace or silence the default notification sound for all applications. Falls back to OS sound when disabled.'),
        });
        page.add(globalGroup);

        const enableRow = new Adw.SwitchRow({title: _('Override notification sound')});
        settings.bind('sound-override-enabled', enableRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        globalGroup.add(enableRow);

        const currentPath = settings.get_string('sound-file');
        const fileRow = new Adw.ActionRow({
            title: _('Sound file'),
            subtitle: _('Leave empty to silence notifications'),
        });
        settings.bind('sound-override-enabled', fileRow, 'sensitive',
            Gio.SettingsBindFlags.DEFAULT);

        const fileLabel = new Gtk.Label({
            label: currentPath ? GLib.path_get_basename(currentPath) : _('(none – silence)'),
            ellipsize: 3,
            xalign: 1,
            valign: Gtk.Align.CENTER,
            hexpand: true,
        });
        const chooseBtn = new Gtk.Button({label: _('Choose…'), valign: Gtk.Align.CENTER});
        chooseBtn.connect('clicked', () => this._openFilePicker(settings, fileLabel, window));
        const clearBtn = new Gtk.Button({label: _('Clear'), valign: Gtk.Align.CENTER});
        clearBtn.connect('clicked', () => {
            settings.set_string('sound-file', '');
            fileLabel.label = _('(none – silence)');
        });
        fileRow.add_suffix(fileLabel);
        fileRow.add_suffix(chooseBtn);
        fileRow.add_suffix(clearBtn);
        globalGroup.add(fileRow);

        // --- Per-application overrides group ---
        const addBtn = new Gtk.Button({label: _('Add'), valign: Gtk.Align.CENTER});
        addBtn.add_css_class('suggested-action');

        const appGroup = new Adw.PreferencesGroup({
            title: _('Per-application overrides'),
            description: _('Override the sound for a specific application. Takes precedence over the global setting; apps not listed here use OS sound or the global override above.'),
            header_suffix: addBtn,
        });
        page.add(appGroup);

        let appRows = [];
        const refreshAppRows = () => {
            appRows.forEach(r => appGroup.remove(r));
            appRows = [];
            const overrides = settings.get_value('app-sound-overrides').deep_unpack();
            Object.entries(overrides)
                .sort(([a], [b]) => a.localeCompare(b))
                .forEach(([appTitle, soundPath]) => {
                    const row = this._buildAppOverrideRow(settings, appTitle, soundPath, window);
                    appGroup.add(row);
                    appRows.push(row);
                });
        };
        settings.connect('changed::app-sound-overrides', refreshAppRows);
        refreshAppRows();

        addBtn.connect('clicked', () => this._showAddOverrideDialog(settings, window));

        return page;
    }

    _buildAppOverrideRow(settings, appTitle, soundPath, window) {
        const row = new Adw.ActionRow({title: appTitle});

        const fileLabel = new Gtk.Label({
            label: soundPath ? GLib.path_get_basename(soundPath) : _('(silence)'),
            ellipsize: 3,
            xalign: 1,
            valign: Gtk.Align.CENTER,
            hexpand: true,
        });

        const changeBtn = new Gtk.Button({label: _('Change…'), valign: Gtk.Align.CENTER});
        changeBtn.connect('clicked', () => this._openFilePickerForApp(settings, appTitle, window));

        const silenceBtn = new Gtk.Button({label: _('Silence'), valign: Gtk.Align.CENTER});
        silenceBtn.connect('clicked', () => {
            const ov = {...settings.get_value('app-sound-overrides').deep_unpack()};
            ov[appTitle] = '';
            settings.set_value('app-sound-overrides', new GLib.Variant('a{ss}', ov));
        });

        const removeBtn = new Gtk.Button({
            icon_name: 'list-remove-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Remove override'),
        });
        removeBtn.add_css_class('destructive-action');
        removeBtn.connect('clicked', () => {
            const ov = {...settings.get_value('app-sound-overrides').deep_unpack()};
            delete ov[appTitle];
            settings.set_value('app-sound-overrides', new GLib.Variant('a{ss}', ov));
        });

        row.add_suffix(fileLabel);
        row.add_suffix(changeBtn);
        row.add_suffix(silenceBtn);
        row.add_suffix(removeBtn);
        return row;
    }

    _showAddOverrideDialog(settings, window) {
        const apps = Gio.AppInfo.get_all()
            .filter(app => app.should_show())
            .sort((a, b) => a.get_display_name().localeCompare(b.get_display_name()));

        const model = new Gtk.StringList();
        apps.forEach(app => model.append(app.get_display_name()));

        const expr = new Gtk.PropertyExpression(Gtk.StringObject.$gtype, null, 'string');
        const dropdown = new Gtk.DropDown({
            model,
            expression: expr,
            enable_search: true,
            selected: 0,
            hexpand: true,
            valign: Gtk.Align.CENTER,
        });

        const listBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        const appRow = new Adw.ActionRow({title: _('Application')});
        appRow.add_suffix(dropdown);
        listBox.append(appRow);

        const dialog = new Adw.AlertDialog({heading: _('Add application override')});
        dialog.set_extra_child(listBox);
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('silence', _('Add (silence)'));
        dialog.add_response('choose', _('Add with sound…'));
        dialog.set_response_appearance('choose', Adw.ResponseAppearance.SUGGESTED);

        dialog.connect('response', (_dlg, response) => {
            if (response === 'cancel')
                return;

            const appName = apps[dropdown.selected]?.get_display_name();
            if (!appName)
                return;

            if (response === 'silence') {
                const ov = {...settings.get_value('app-sound-overrides').deep_unpack()};
                ov[appName] = '';
                settings.set_value('app-sound-overrides', new GLib.Variant('a{ss}', ov));
                return;
            }

            // 'choose': AlertDialog is already dismissed at this point —
            // open the file picker against the bare window, no modal conflict.
            this._openFileDialogRaw(window, null, path => {
                const ov = {...settings.get_value('app-sound-overrides').deep_unpack()};
                ov[appName] = path;
                settings.set_value('app-sound-overrides', new GLib.Variant('a{ss}', ov));
            });
        });

        dialog.present(window);
    }

    _openFilePicker(settings, fileLabel, window) {
        this._openFileDialogRaw(window, settings.get_string('sound-file'), path => {
            settings.set_string('sound-file', path);
            fileLabel.label = GLib.path_get_basename(path);
        });
    }

    _openFilePickerForApp(settings, appTitle, window) {
        const currentPath = settings.get_value('app-sound-overrides').deep_unpack()[appTitle] ?? '';
        this._openFileDialogRaw(window, currentPath, path => {
            const ov = {...settings.get_value('app-sound-overrides').deep_unpack()};
            ov[appTitle] = path;
            settings.set_value('app-sound-overrides', new GLib.Variant('a{ss}', ov));
        });
    }

    _openFileDialogRaw(window, initialPath, onPicked) {
        const dialog = new Gtk.FileDialog({title: _('Select a sound file'), modal: true});

        const filter = new Gtk.FileFilter();
        filter.set_name(_('Audio files'));
        ['audio/mpeg', 'audio/ogg', 'audio/x-wav', 'audio/flac', 'audio/aac'].forEach(
            mime => filter.add_mime_type(mime));
        ['*.mp3', '*.ogg', '*.wav', '*.flac', '*.aac', '*.oga'].forEach(
            pat => filter.add_pattern(pat));
        const filters = new Gio.ListStore({item_type: Gtk.FileFilter.$gtype});
        filters.append(filter);
        dialog.filters = filters;

        if (initialPath) {
            try { dialog.initial_file = Gio.File.new_for_path(initialPath); } catch { /* ignore */ }
        }

        dialog.open(window, null, (dlg, result) => {
            try {
                const path = dlg.open_finish(result)?.get_path();
                if (path)
                    onPicked(path);
            } catch { /* cancelled */ }
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
