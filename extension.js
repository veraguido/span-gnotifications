// SPDX-License-Identifier: GPL-2.0-or-later
// Span GNotifications – customise GNOME notification UI and multi-monitor distribution

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

// Maps position string → Clutter horizontal alignment for the banner bin
const H_ALIGN = {
    'top-left':      Clutter.ActorAlign.START,
    'top-center':    Clutter.ActorAlign.CENTER,
    'top-right':     Clutter.ActorAlign.END,
    'bottom-left':   Clutter.ActorAlign.START,
    'bottom-center': Clutter.ActorAlign.CENTER,
    'bottom-right':  Clutter.ActorAlign.END,
};

export default class SpanGNotifications extends Extension {
    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    enable() {
        this._settings = this.getSettings();
        this._injectionManager = new InjectionManager();
        this._mirrors = [];
        this._cssFile = null;
        this._savedAlignment = Main.messageTray.bannerAlignment;

        this._refreshAlignment();
        this._refreshCSS();
        this._installPatches();

        this._settings.connectObject('changed', (_, key) => this._onSettingChanged(key), this);
    }

    disable() {
        this._settings?.disconnectObject(this);

        this._injectionManager?.clear();
        this._injectionManager = null;

        // Restore horizontal alignment
        Main.messageTray.bannerAlignment = this._savedAlignment;

        // Restore monitor constraint to primary
        const c = this._findMonitorConstraint();
        if (c)
            c.primary = true;

        this._destroyAllMirrors();
        this._unloadCSS();

        this._settings = null;
    }

    // -------------------------------------------------------------------------
    // Settings reactions
    // -------------------------------------------------------------------------

    _onSettingChanged(key) {
        if (key === 'notification-position') {
            this._refreshAlignment();
            this._refreshCSS();
        }

        if (['background-color', 'text-color', 'font-size', 'font-weight',
             'notification-width', 'notification-padding', 'notification-margin'].includes(key))
            this._refreshCSS();

        // All other keys (monitor-mode, show-icon, icon-size, sound-*)
        // are read dynamically inside the patches – no extra action needed.
    }

    // -------------------------------------------------------------------------
    // Horizontal banner alignment (public MessageTray API)
    // -------------------------------------------------------------------------

    _refreshAlignment() {
        const pos = this._settings.get_string('notification-position');
        Main.messageTray.bannerAlignment = H_ALIGN[pos] ?? Clutter.ActorAlign.END;
    }

    _isBottom() {
        return this._settings.get_string('notification-position').startsWith('bottom');
    }

    // -------------------------------------------------------------------------
    // MonitorConstraint helpers
    // -------------------------------------------------------------------------

    _findMonitorConstraint() {
        for (const c of Main.messageTray.get_constraints()) {
            if (c instanceof Layout.MonitorConstraint)
                return c;
        }
        return null;
    }

    _targetMonitorIdx() {
        if (this._settings.get_string('monitor-mode') === 'follow-mouse')
            return global.display.get_current_monitor();
        return Main.layoutManager.primaryIndex;
    }

    _workAreaForTarget() {
        return Main.layoutManager.getWorkAreaForMonitor(this._targetMonitorIdx());
    }

    // -------------------------------------------------------------------------
    // Method patching via InjectionManager
    // -------------------------------------------------------------------------

    _installPatches() {
        const ext = this;
        const tray = Main.messageTray;

        // --- _showNotification -------------------------------------------
        // Runs before the banner is created; we use it to:
        //   • steer the MonitorConstraint for follow-mouse
        //   • apply JS-level banner tweaks after the original runs
        //   • schedule mirror creation for duplicate-all
        this._injectionManager.overrideMethod(tray, '_showNotification', orig => function () {
            const mode = ext._settings.get_string('monitor-mode');
            const c = ext._findMonitorConstraint();

            if (c) {
                if (mode === 'follow-mouse') {
                    c.primary = false;
                    c.index = global.display.get_current_monitor();
                } else {
                    c.primary = true;
                }
            }

            orig.call(this);

            if (this._banner)
                ext._applyBannerJS(this._banner);

            if (mode === 'duplicate-all' && this._notification) {
                const notif = this._notification;
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    ext._spawnMirrors(notif);
                    return GLib.SOURCE_REMOVE;
                });
            }
        });

        // --- _updateShowingNotification ----------------------------------
        // Controls the "slide in" animation.  For bottom positions we need to
        // start below the screen (positive y offset) and animate upward.
        this._injectionManager.overrideMethod(tray, '_updateShowingNotification', orig => function () {
            if (!ext._isBottom()) {
                orig.call(this);
                return;
            }

            const wa = ext._workAreaForTarget();

            // Position banner below the visible area on first show
            if (this._notificationState === MessageTray.State.HIDDEN)
                this._bannerBin.y = wa.height;

            this._notification.acknowledged = true;
            this._notification.playSound();

            if (this._notification.urgency === MessageTray.Urgency.CRITICAL ||
                this._notification.source.policy.forceExpanded)
                this._expandBanner(true);

            this._notificationState = MessageTray.State.SHOWING;
            this._bannerBin.remove_all_transitions();

            this._bannerBin.ease({
                opacity: 255,
                duration: MessageTray.ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            this._bannerBin.set_pivot_point(0.5, 0.5);
            this._bannerBin.scale_x = 0.9;
            this._bannerBin.scale_y = 0.9;
            this._bannerBin.ease({
                y: wa.height - this._banner.height,
                scale_x: 1,
                scale_y: 1,
                duration: MessageTray.ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
                onComplete: () => {
                    this._notificationState = MessageTray.State.SHOWN;
                    this._showNotificationCompleted();
                    this._updateState();
                },
            });
        });

        // --- _hideNotification -------------------------------------------
        // Controls the "slide out" animation.  For bottom positions we slide
        // the banner back down below the screen.
        this._injectionManager.overrideMethod(tray, '_hideNotification', orig => function (animate) {
            // Animate out mirrors in parallel with the primary banner
            const toHide = ext._mirrors.splice(0);
            toHide.forEach(({banner, container}) => ext._animateMirrorOut(banner, container));

            if (!ext._isBottom()) {
                orig.call(this, animate);
                return;
            }

            const wa = ext._workAreaForTarget();
            this._notificationFocusGrabber.ungrabFocus();
            this._banner.disconnectObject(this);
            this._resetNotificationLeftTimeout();
            this._bannerBin.remove_all_transitions();

            const dur = animate ? MessageTray.ANIMATION_TIME : 0;
            this._notificationState = MessageTray.State.HIDING;

            this._bannerBin.ease({
                opacity: 0,
                duration: dur,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
            });
            this._bannerBin.ease({
                y: wa.height,
                duration: dur,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
                onStopped: () => {
                    this._notificationState = MessageTray.State.HIDDEN;
                    this._hideNotificationCompleted();
                    this._updateState();
                },
            });
        });

        // --- _updateState ------------------------------------------------
        // GNOME normally suppresses non-critical banners while any monitor is
        // in fullscreen (line 1079 of messageTray.js).  When show-in-fullscreen
        // is on we replicate the full method with that one check removed.
        this._injectionManager.overrideMethod(tray, '_updateState', orig => function () {
            if (!ext._settings.get_boolean('show-in-fullscreen')) {
                orig.call(this);
                return;
            }

            const hasMonitor = Main.layoutManager.primaryMonitor != null;
            this.visible = !this._bannerBlocked && hasMonitor && this._banner != null;
            if (this._bannerBlocked || !hasMonitor)
                return;

            if (this._updatingState)
                return;

            this._updatingState = true;

            let changed = false;
            this._notificationQueue = this._notificationQueue.filter(n => {
                changed ||= n.acknowledged;
                return !n.acknowledged;
            });
            if (changed)
                this.emit('queue-changed');

            const hasNotifications = Main.sessionMode.hasNotifications;

            if (this._notificationState === MessageTray.State.HIDDEN) {
                const nextNotification = this._notificationQueue[0] || null;
                if (hasNotifications && nextNotification) {
                    // Only this._busy matters; inFullscreen is intentionally ignored
                    const limited = this._busy;
                    const showNext = !limited || nextNotification.forFeedback ||
                        nextNotification.urgency === MessageTray.Urgency.CRITICAL;
                    if (showNext)
                        this._showNotification();
                }
            } else if (this._notificationState === MessageTray.State.SHOWING ||
                       this._notificationState === MessageTray.State.SHOWN) {
                const expired =
                    (this._userActiveWhileNotificationShown &&
                     this._notificationState === MessageTray.State.SHOWN &&
                     this._notificationTimeoutId === 0 &&
                     this._notification.urgency !== MessageTray.Urgency.CRITICAL &&
                     !this._pointerInNotification) || this._notificationExpired;
                const mustClose = this._notificationRemoved || !hasNotifications || expired;

                if (mustClose) {
                    this._hideNotification(hasNotifications && !this._notificationRemoved);
                } else if (this._notificationState === MessageTray.State.SHOWN &&
                           this._pointerInNotification) {
                    if (!this._banner.expanded)
                        this._expandBanner(false);
                    else
                        this._ensureBannerFocused();
                }
            }

            this._updatingState = false;
            this._notificationExpired = false;
        });

        // --- _showNotificationCompleted ----------------------------------
        // Replace the hardcoded 4000 ms timeout with the user-configured value.
        this._injectionManager.overrideMethod(tray, '_showNotificationCompleted', _orig => function () {
            if (this._notification.urgency !== MessageTray.Urgency.CRITICAL)
                this._updateNotificationTimeout(ext._settings.get_int('notification-timeout') * 1000);
        });

        // --- Notification.playSound --------------------------------------
        // When sound-override is enabled: play a custom file or go silent.
        this._injectionManager.overrideMethod(
            MessageTray.Notification.prototype, 'playSound',
            orig => function () {
                if (!ext._settings.get_boolean('sound-override-enabled')) {
                    orig.call(this);
                    return;
                }
                if (!this.source.policy.enableSound)
                    return;

                const path = ext._settings.get_string('sound-file');
                if (!path)
                    return; // empty path = silence

                const file = Gio.File.new_for_path(path);
                if (file.query_exists(null))
                    global.display.get_sound_player()
                        .play_from_file(file, 'Notification sound', null);
            }
        );
    }

    // -------------------------------------------------------------------------
    // Per-banner JS tweaks (icon size / visibility)
    // -------------------------------------------------------------------------

    _applyBannerJS(banner) {
        if (!banner._icon)
            return;

        const showIcon = this._settings.get_boolean('show-icon');

        if (!showIcon) {
            banner._icon.visible = false;
            // The NotificationMessage has a gicon→icon binding; re-hide if it fires
            const id = banner._icon.connect('notify::gicon', () => {
                banner._icon.visible = false;
            });
            banner.connect('destroy', () => {
                try { banner._icon.disconnect(id); } catch { /* already gone */ }
            });
        } else {
            banner._icon.icon_size = this._settings.get_int('icon-size');
        }
    }

    // -------------------------------------------------------------------------
    // Multi-monitor mirror banners (duplicate-all mode)
    // -------------------------------------------------------------------------

    _spawnMirrors(notification) {
        const primaryIdx = Main.layoutManager.primaryIndex;
        Main.layoutManager.monitors.forEach((_, i) => {
            if (i !== primaryIdx)
                this._spawnOneMirror(notification, i);
        });
    }

    _spawnOneMirror(notification, monitorIdx) {
        // Build a NotificationMessage that shares the same notification object
        const banner = new MessageList.NotificationMessage(notification);
        banner.can_focus = false;
        if (banner._header?.expandButton)
            banner._header.expandButton.visible = false;
        banner.add_style_class_name('notification-banner');
        this._applyBannerJS(banner);

        const pos = this._settings.get_string('notification-position');
        banner.x_align = H_ALIGN[pos] ?? Clutter.ActorAlign.END;

        // Use a vertical BoxLayout so we can control vertical position reliably.
        // BinLayout + y_align is not reliable because NotificationMessage's
        // preferred-height can span the full container, making START/END a no-op.
        const container = new St.Widget({
            visible: true,
            layout_manager: new Clutter.BoxLayout({orientation: Clutter.Orientation.VERTICAL}),
        });

        const constraint = new Layout.MonitorConstraint({primary: false});
        constraint.index = monitorIdx;
        constraint['work-area'] = true;
        container.add_constraint(constraint);

        // For bottom positions push the banner down with an expanding spacer.
        if (this._isBottom())
            container.add_child(new St.Widget({y_expand: true}));
        container.add_child(banner);

        Main.layoutManager.addChrome(container);
        this._mirrors.push({banner, container});

        // Animate in using translation so the layout is not disturbed
        const slideH = 80; // rough pre-layout height estimate
        banner.translation_y = this._isBottom() ? slideH : -slideH;
        banner.opacity = 0;
        banner.ease({
            opacity: 255,
            translation_y: 0,
            duration: MessageTray.ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });

        // Fallback: clean up if the notification object itself is destroyed
        notification.connectObject(
            'destroy', () => {
                this._mirrors = this._mirrors.filter(m => m.container !== container);
                if (!container.is_finalized())
                    this._animateMirrorOut(banner, container);
            },
            container
        );
    }

    _animateMirrorOut(banner, container) {
        const h = banner.height || 80;
        banner.ease({
            opacity: 0,
            translation_y: this._isBottom() ? h : -h,
            duration: MessageTray.ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
            onStopped: () => container.destroy(),
        });
    }

    _destroyAllMirrors() {
        this._mirrors.forEach(({container}) => container.destroy());
        this._mirrors = [];
    }

    // -------------------------------------------------------------------------
    // Dynamic CSS – colours, fonts, banner width
    // -------------------------------------------------------------------------

    _refreshCSS() {
        this._unloadCSS();

        const css = this._buildCSS();
        const path = GLib.build_filenamev([this.path, 'dynamic.css']);
        const file = Gio.File.new_for_path(path);

        try {
            file.replace_contents(
                new TextEncoder().encode(css),
                null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
            St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(file);
            this._cssFile = file;
        } catch (e) {
            console.error(`[SpanGNotifications] CSS load error: ${e}`);
        }
    }

    _unloadCSS() {
        if (!this._cssFile)
            return;
        try {
            St.ThemeContext.get_for_stage(global.stage).get_theme()
                .unload_stylesheet(this._cssFile);
        } catch { /* already gone */ }
        this._cssFile = null;
    }

    _buildCSS() {
        const w   = this._settings.get_int('notification-width');
        const p   = this._settings.get_int('notification-padding');
        const bg  = this._settings.get_string('background-color');
        const fg  = this._settings.get_string('text-color');
        const fs  = this._settings.get_int('font-size');
        const fw  = this._settings.get_string('font-weight');
        const mg  = this._settings.get_int('notification-margin');
        const pos = this._settings.get_string('notification-position');

        const isTop    = pos.startsWith('top');
        const isBottom = pos.startsWith('bottom');
        const isLeft   = pos.endsWith('left');
        const isRight  = pos.endsWith('right');

        const marginTop    = isTop    ? mg : 0;
        const marginBottom = isBottom ? mg : 0;
        const marginLeft   = isLeft   ? mg : 0;
        const marginRight  = isRight  ? mg : 0;

        return `/* span-gnotifications – auto-generated, do not edit */

.notification-banner {
  width: ${w}px;
  min-width: ${w}px;
  margin-top: ${marginTop}px;
  margin-bottom: ${marginBottom}px;
  margin-left: ${marginLeft}px;
  margin-right: ${marginRight}px;
}

.notification-banner .message {
  background-color: ${bg};
  padding: ${p}px;
}

.notification-banner .message-title {
  color: ${fg};
  font-size: ${fs + 1}pt;
  font-weight: bold;
}

.notification-banner .message-body {
  color: ${fg};
  font-size: ${fs}pt;
  font-weight: ${fw};
}

.notification-banner .message-source-title {
  color: ${fg};
  font-size: ${Math.max(6, fs - 1)}pt;
}

.notification-banner .event-time {
  color: ${fg};
  font-size: ${Math.max(6, fs - 2)}pt;
}
`;
    }
}
