// Chat UI adapted from origin/deeeev-gangjeon; displayed beside the main menu.
const {Clutter, GLib, Pango, St} = imports.gi;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const PopupMenu = imports.ui.popupMenu;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Chat = Me.imports.services.chat;
function wrapLabel(label) {
    label.clutter_text.line_wrap = true;
    label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return label;
}
var ChatPanel = class ChatPanel {
    constructor(indicator) {
        this._indicator = indicator;
        this._settings = imports.misc.extensionUtils.getSettings();
        this._blocked = this._settings.get_strv('blocked-chat-seats');
        this._expanded = false;
        this._buildChat();
        if (this._settings.get_boolean('chat-enabled')) this._chat.start();
        this._settingsSignal = this._settings.connect('changed', (_settings, key) => {
            if (key === 'blocked-chat-seats') {
                this._blocked = this._settings.get_strv(key);
                this._chat.setBlocked(this._blocked);
                if (!this._chat.peer(this._chatActive)) this._chatActive = null;
                this._renderChat();
            }
            if (key === 'chat-enabled') {
                this.reset();
                if (this._settings.get_boolean(key)) this._chat.start();
            }
            this.sync();
        });
    }
    sync() {
        if (!this._chatUi) return;
        if (this._indicator.loginOnly) this._awaitingLogin = true;
        else if (this._awaitingLogin) {
            this._awaitingLogin = false;
            if (this._settings.get_boolean('chat-enabled') && this._chat.state === 'stopped') this._chat.start();
        }
        const visible = !this._indicator.loginOnly && this._settings.get_boolean('chat-enabled') && this._settings.get_boolean('show-chat');
        this._chatUi.item.visible = visible;
        this._chatUi.root.visible = this._expanded && visible;
        if (this._expanded && this._indicator.menu.isOpen && !this._indicator.loginOnly && this._chatActive)
            this._chat.markRead(this._chatActive);
    }
    _updatePanelLabel() {
        const count = this._chat.unread;
        this._chatUi.toggle.label = count ? `Cluster Chat · ${count > 5 ? '5+' : count}` : 'Cluster Chat';
    }
    reset() {
        this._chatBannerSource?.destroy();
        this._chatBannerSource = null;
        this._expanded = false;
        this._chatUi.entry.text = '';
        this._chatUi.peerEntry.text = '';
        this._chatUi.peerEntry.remove_style_class_name('pingoose-chat-entry-error');
        this._chatUi.peerRow.hide();
        this._chat.destroy();
        this._chat = new Chat.ChatService(Chat.PORT, this._blocked);
        this._chat.connect('server-state', () => this._renderChatStatus());
        this._chat.connect('peer-changed', () => { this._renderChatChips(); this._updatePanelLabel(); });
        this._chat.connect('message', (_chat, key, entry) => this._chatMessage(key, entry));
        this._chatActive = null;
        this._renderChatStatus();
        this._renderChat();
        this._updatePanelLabel();
        this.sync();
    }
    destroy() {
        this._chatBannerSource?.destroy();
        this._chatBannerSource = null;
        this._settings.disconnect(this._settingsSignal);
        this._chat.destroy();
        this._chatUi = null;
    }
    _buildChat() {
        const indicator = this._indicator;
        const center = Clutter.ActorAlign.CENTER;
        this._chat = new Chat.ChatService(Chat.PORT, this._blocked);
        this._chatActive = null;
        const ui = this._chatUi = {stick: true};
        const root = new St.BoxLayout({vertical: true, reactive: true, visible: false,
            y_expand: false, y_align: Clutter.ActorAlign.START, style_class: 'pingoose-chat pingoose-chat-panel'});
        ui.root = root;
        // Share the popup grab so interacting with chat does not close the main menu.
        const bin = indicator.menu._boxPointer.bin;
        const main = indicator.menu.box;
        // Each column keeps its natural height instead of stretching to the tallest panel.
        main.request_mode = Clutter.RequestMode.HEIGHT_FOR_WIDTH;
        main.x_expand = false;
        main.y_expand = false;
        main.y_align = Clutter.ActorAlign.START;
        bin.remove_child(main);
        indicator.menu.actor.add_style_class_name('pingoose-panel-host');
        main.add_style_class_name('pingoose-main-panel');
        const columns = new St.BoxLayout({request_mode: Clutter.RequestMode.HEIGHT_FOR_WIDTH,
            style_class: 'pingoose-chat-columns'});
        columns.add_child(root);
        columns.add_child(main);
        bin.set_child(columns);
        indicator.sideColumns = columns;
        // Main stays last; moving a panel immediately before it preserves the others' order.
        indicator.bringPanelNearMain = panel => columns.set_child_below_sibling(panel, main);
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.remove_all_children();
        item.add_style_class_name('pingoose-overview-item');
        const toggle = new St.Button({label: 'Cluster Chat', can_focus: true, x_expand: true,
            style_class: 'pingoose-visit-intra'});
        ui.toggle = toggle;
        item.add_child(toggle);
        indicator.menu.addMenuItem(item);
        ui.item = item;
        toggle.connect('clicked', () => {
            this._expanded = !this._expanded;
            if (this._expanded) indicator.bringPanelNearMain(root);
            if (this._expanded && this._chat.state === 'stopped') this._chat.start();
            this.sync();
        });

        const header = new St.BoxLayout({style_class: 'pingoose-chat-header'});
        header.add_child(new St.Label({text: 'Cluster Chat', x_expand: true, y_align: center, style_class: 'pingoose-heading'}));
        // Clicking the status retries the listener when the port was taken.
        ui.status = new St.Button({can_focus: true, y_align: center, style_class: 'pingoose-chat-status'});
        ui.status.connect('clicked', () => { if (this._chat.state !== 'listening') this._chat.start(); });
        const dismiss = new St.Button({label: '×', can_focus: true,
            accessible_name: 'Close Cluster Chat', style_class: 'pingoose-dismiss'});
        dismiss.connect('clicked', () => { this._expanded = false; this.sync(); });
        header.add_child(dismiss);
        root.add_child(header);
        root.add_child(ui.status);

        const chipRow = new St.BoxLayout({style_class: 'pingoose-chat-chip-row'});
        const chipScroll = new St.ScrollView({x_expand: true, overlay_scrollbars: false, style_class: 'pingoose-chat-chip-scroll'});
        chipScroll.set_policy(St.PolicyType.NEVER, St.PolicyType.NEVER);
        ui.chipScroll = chipScroll;
        ui.chipOverflow = false;
        chipScroll.connect('notify::allocation', () => this._syncChipOverflow());
        ui.chips = new St.BoxLayout({style_class: 'pingoose-chat-chips'});
        chipScroll.add_actor(ui.chips);
        chipRow.add_child(chipScroll);
        const add = new St.Button({label: '+', can_focus: true, y_align: center,
            accessible_name: 'New chat', style_class: 'pingoose-chat-add'});
        chipRow.add_child(add);
        root.add_child(chipRow);

        ui.peerRow = new St.BoxLayout({visible: false, style_class: 'pingoose-chat-input-row'});
        ui.peerEntry = new St.Entry({hint_text: 'Seat number (e.g. c2r3s4)', can_focus: true,
            x_expand: true, style_class: 'pingoose-chat-entry'});
        const connect = new St.Button({label: 'Connect', can_focus: true, style_class: 'pingoose-chat-send'});
        ui.peerRow.add_child(ui.peerEntry);
        ui.peerRow.add_child(connect);
        root.add_child(ui.peerRow);
        const submitPeer = () => {
            const seat = ui.peerEntry.text.trim();
            const key = Chat.SEAT.test(seat) ? this._chat.open(seat) : null;
            if (!key) {
                ui.peerEntry.add_style_class_name('pingoose-chat-entry-error');
                return;
            }
            ui.peerEntry.text = '';
            ui.peerRow.hide();
            this._selectChat(key);
        };
        ui.peerEntry.clutter_text.connect('activate', submitPeer);
        ui.peerEntry.clutter_text.connect('text-changed', () => ui.peerEntry.remove_style_class_name('pingoose-chat-entry-error'));
        connect.connect('clicked', submitPeer);
        add.connect('clicked', () => {
            ui.peerRow.visible = !ui.peerRow.visible;
            if (ui.peerRow.visible) global.stage.set_key_focus(ui.peerEntry);
        });

        const scroll = new St.ScrollView({x_expand: true, overlay_scrollbars: false, style_class: 'pingoose-chat-scroll'});
        scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        ui.log = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'pingoose-chat-log'});
        scroll.add_actor(ui.log);
        root.add_child(scroll);
        // Follow new messages only while the view is already at the bottom.
        const adjustment = scroll.vscroll.adjustment;
        adjustment.connect('notify::value', () => {
            ui.stick = adjustment.value + adjustment.page_size >= adjustment.upper - 4;
        });
        adjustment.connect('changed', () => {
            if (ui.stick) adjustment.value = adjustment.upper - adjustment.page_size;
        });

        const inputRow = new St.BoxLayout({style_class: 'pingoose-chat-input-row'});
        ui.entry = new St.Entry({can_focus: true, x_expand: true, style_class: 'pingoose-chat-entry'});
        ui.entry.clutter_text.max_length = 1000;
        ui.send = new St.Button({can_focus: true, accessible_name: 'Send', style_class: 'pingoose-chat-send'});
        ui.send.set_child(new St.Icon({icon_name: 'mail-send-symbolic', icon_size: 16}));
        inputRow.add_child(ui.entry);
        inputRow.add_child(ui.send);
        root.add_child(inputRow);
        const submit = () => {
            if (!this._chatActive || !this._chat.send(this._chatActive, ui.entry.text)) return;
            ui.entry.text = '';
        };
        ui.entry.clutter_text.connect('activate', submit);
        ui.send.connect('clicked', submit);
        this._chat.connect('server-state', () => this._renderChatStatus());
        this._chat.connect('peer-changed', () => { this._renderChatChips(); this._updatePanelLabel(); });
        this._chat.connect('message', (_chat, key, entry) => this._chatMessage(key, entry));
        indicator.menu.connect('open-state-changed', (_menu, open) => {
            this.sync();
            if (!open || !this._chat || !this._expanded) return;
            if (this._chatActive) this._chat.markRead(this._chatActive);
            this._updatePanelLabel();
        });
        this._renderChatStatus();
        this._renderChat();
    }

    _renderChatStatus() {
        const ui = this._chatUi;
        if (!ui) return;
        const state = this._chat.state;
        const seat = GLib.get_host_name().split('.')[0];
        ui.status.label = state === 'listening' ? `● ${seat} · Ready`
            : state === 'port-busy' ? `● :${this._chat.port} in use · Retry` : 'Open a chat to connect';
        ui.status.style_class = `pingoose-chat-status pingoose-chat-status-${state === 'listening' ? 'ok' : 'err'}`;
    }

    _renderChatChips() {
        const ui = this._chatUi;
        if (!ui) return;
        const center = Clutter.ActorAlign.CENTER;
        ui.chips.destroy_all_children();
        for (const peer of this._chat.peers) {
            const chip = new St.BoxLayout({style_class: peer.key === this._chatActive
                ? 'pingoose-chat-chip pingoose-chat-chip-active' : 'pingoose-chat-chip'});
            const pick = new St.Button({can_focus: true, style_class: 'pingoose-chat-chip-button'});
            const content = new St.BoxLayout({style_class: 'pingoose-chat-chip-content'});
            const dot = peer.connections.length ? 'on' : peer.connecting ? 'wait' : 'off';
            content.add_child(new St.Label({text: '●', y_align: center, style_class: `pingoose-chat-dot pingoose-chat-dot-${dot}`}));
            content.add_child(new St.Label({text: peer.key, y_align: center}));
            if (peer.unread) {
                content.add_child(new St.Label({text: peer.unread > 9 ? '9+' : String(peer.unread),
                    y_align: center, style_class: 'pingoose-chat-badge'}));
            }
            pick.set_child(content);
            pick.connect('clicked', () => this._selectChat(peer.key));
            const close = new St.Button({label: '×', can_focus: true, y_align: center,
                accessible_name: `Close chat with ${peer.key}`, style_class: 'pingoose-chat-chip-close'});
            close.connect('clicked', () => {
                this._chat.close(peer.key);
                if (this._chatActive !== peer.key) return;
                this._chatActive = this._chat.peers[0]?.key ?? null;
                this._renderChat();
            });
            chip.add_child(pick);
            chip.add_child(close);
            ui.chips.add_child(chip);
        }
        this._syncChipOverflow();
    }

    _syncChipOverflow() {
        const ui = this._chatUi;
        if (!ui?.chipScroll || ui.chipScroll.width <= 0) return;
        const children = ui.chips.get_children();
        const spacing = ui.chips.get_theme_node().get_length('spacing');
        const natural = children.reduce((sum, child) => sum + child.get_preferred_width(-1)[1], 0) +
            Math.max(0, children.length - 1) * spacing;
        const available = ui.chipScroll.get_theme_node().get_content_box(ui.chipScroll.get_allocation_box()).get_width();
        const overflow = natural > available + 1;
        if (overflow === ui.chipOverflow) return;
        ui.chipOverflow = overflow;
        ui.chipScroll.set_policy(overflow ? St.PolicyType.ALWAYS : St.PolicyType.NEVER, St.PolicyType.NEVER);
    }

    _renderChat() {
        const ui = this._chatUi;
        this._renderChatChips();
        ui.log.destroy_all_children();
        ui.placeholder = null;
        ui.stick = true;
        const peer = this._chatActive ? this._chat.peer(this._chatActive) : null;
        ui.entry.reactive = ui.send.reactive = !!peer;
        ui.entry.hint_text = peer ? `Message ${peer.key}…` : 'Add a seat with + first';
        if (!peer?.history.length) {
            ui.placeholder = wrapLabel(new St.Label({x_expand: true, style_class: 'pingoose-chat-empty',
                text: peer ? 'No messages yet.'
                    : 'Use + to add a seat, such as c2r3s4.\nThe other person must have Cluster Chat open at least once.'}));
            ui.log.add_child(ui.placeholder);
            return;
        }
        for (const entry of peer.history) this._appendChatEntry(entry);
    }

    _appendChatEntry(entry) {
        const ui = this._chatUi;
        while (ui.log.get_children().length >= 200) ui.log.get_children()[0].destroy();
        ui.placeholder?.destroy();
        ui.placeholder = null;
        if (entry.dir === 'sys') {
            ui.log.add_child(wrapLabel(new St.Label({text: `${entry.text} · ${entry.time}`,
                x_align: Clutter.ActorAlign.CENTER, style_class: 'pingoose-chat-system'})));
            return;
        }
        const out = entry.dir === 'out';
        const align = out ? Clutter.ActorAlign.END : Clutter.ActorAlign.START;
        const bubble = new St.BoxLayout({vertical: true, x_expand: true, x_align: align,
            style_class: `pingoose-chat-bubble pingoose-chat-bubble-${out ? 'out' : 'in'}`});
        // Plain text only: peer input must never be parsed as Pango markup.
        bubble.add_child(wrapLabel(new St.Label({text: entry.text, style_class: 'pingoose-chat-text'})));
        bubble.add_child(new St.Label({text: entry.time, x_align: align, style_class: 'pingoose-chat-time'}));
        ui.log.add_child(bubble);
    }

    _chatMessage(key, entry) {
        if (!this._chatUi) return;
        if (!this._chatActive) {
            this._chatActive = key;
            this._renderChat();
        } else if (key === this._chatActive) {
            if (entry.dir === 'out') this._chatUi.stick = true;
            this._appendChatEntry(entry);
        }
        if (entry.dir !== 'in') return;
        if (this._indicator.menu.isOpen && this._expanded && !this._indicator.loginOnly && this._chatActive === key) {
            this._chat.markRead(key);
            return;
        }
        this._renderChatChips();
        this._updatePanelLabel();
        this._notifyChat(key, entry.text);
    }

    _notifyChat(key, text) {
        const now = GLib.get_monotonic_time();
        if (this._lastChatBanner && now - this._lastChatBanner < 3000000) return;
        this._lastChatBanner = now;
        if (!this._chatBannerSource) {
            this._chatBannerSource = new MessageTray.Source('Cluster Chat', 'user-available-symbolic');
            this._chatBannerSource.connect('destroy', () => { this._chatBannerSource = null; });
            Main.messageTray.add(this._chatBannerSource);
        }
        const banner = new MessageTray.Notification(this._chatBannerSource, `Cluster Chat · ${key}`, text.slice(0, 200));
        banner.setTransient(true);
        banner.connect('activated', () => {
            if (!this._chat.peer(key) || !this._settings.get_boolean('chat-enabled')) return;
            this._settings.set_boolean('show-chat', true);
            this._expanded = true;
            this._indicator.bringPanelNearMain(this._chatUi.root);
            this._indicator.menu.open();
            this.sync();
            this._selectChat(key);
        });
        this._chatBannerSource.showNotification(banner);
    }

    _selectChat(key) {
        this._chatActive = key;
        this._chat.markRead(key);
        this._renderChat();
        this._updatePanelLabel();
        global.stage.set_key_focus(this._chatUi.entry);
    }

};
