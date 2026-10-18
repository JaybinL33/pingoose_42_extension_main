const Me = imports.misc.extensionUtils.getCurrentExtension();


var Controller = class Controller {
    _applySectionOrder() {
        const indicator = this._indicator;
        const groups = {
            profile: [indicator.profileItem, indicator.profileSeparator],
            overview: [indicator.overviewItem, indicator.overviewSeparator],
            slots: [indicator.slotsButtonItem, indicator.slotsItem],
            evaluations: [indicator.evaluationItem, indicator.evaluationSeparator],
            agenda: [indicator.agendaItem, indicator.agendaSeparator],
            notifications: [indicator.notificationItem, indicator.notificationSeparator],
            chat: [this._chatPanel?._chatUi?.item],
            services: [this._servicePanel?.item],
        };
        const order = Me.imports.models.appearance.read(this._settings);
        const box = indicator.menu.box;
        // Keep the options toolbar first and the signed-out welcome view last.
        let index = 1;
        for (const key of order) {
            for (const item of groups[key]) {
                const actor = item?.actor || item;
                if (!actor || actor.get_parent() !== box) continue;
                if (box.get_child_at_index(index) !== actor) box.set_child_at_index(actor, index);
                index++;
            }
        }
        const visible = order.filter(key => {
            const item = groups[key][0];
            return !!(item?.actor || item)?.visible;
        });
        for (const key of ['profile', 'overview', 'evaluations', 'agenda']) {
            const separator = groups[key][1];
            if (separator) (separator.actor || separator).visible = visible.includes(key) && key !== visible[visible.length - 1];
        }
    }

    _updatePanelLabel() {
        const indicator = this._indicator;
        if (!indicator) return;
        if (indicator.loginOnly) { indicator.count.text = 'Login Required'; return; }
        const feedback = (this._evaluations || []).filter(row => Date.parse(row.begin) <= Date.now()).length +
            (this._agenda || []).filter(row => row.feedback).length;
        const unread = this._unreadIds?.size ?? (this._notifications || []).filter(row => row.unread).length;
        const badge = count => count > 5 ? '5+' : String(count);
        if (feedback) indicator.count.text = `Feedback ${badge(feedback)}`;
        else if (unread) indicator.count.text = `New ${badge(unread)}`;
        else if (indicator.profileReady) indicator.count.text = '42';
    }

    _syncOptionalSections() {
        this._chatPanel?.sync();
        this._servicePanel?.sync();
        this._projectPanel?.sync();
        this._updatePanelLabel();
        const indicator = this._indicator;
        if (indicator.slotsItem) indicator.slotsItem.visible = !!this._slotsExpanded && !indicator.loginOnly;
        const enabled = key => this._settings ? this._settings.get_boolean(`show-${key}`) : true;
        if (indicator.slotsButtonItem) indicator.slotsButtonItem.visible = !indicator.loginOnly && enabled('slots');
        if (indicator.slotsItem) indicator.slotsItem.visible = !!this._slotsExpanded && !indicator.loginOnly && enabled('slots');
        if (indicator.profileSeparator) indicator.profileSeparator.visible = !indicator.loginOnly && enabled('profile');
        if (indicator.profileItem) indicator.profileItem.visible = !indicator.loginOnly && enabled('profile');
        if (indicator.overviewItem) {
            indicator.projectsColumn.visible = enabled('projects');
            indicator.studyColumn.visible = enabled('logtime');
            indicator.overviewItem.visible = !indicator.loginOnly && (enabled('projects') || enabled('logtime'));
        }
        const evaluationsVisible = !indicator.loginOnly && !this._settingsVisible && !!this._evaluations?.length && enabled('evaluations');
        const notificationsVisible = !indicator.loginOnly && !this._settingsVisible && !!this._notifications?.length && enabled('notifications');
        const agendaVisible = !indicator.loginOnly && !this._settingsVisible && !!this._agenda?.length && enabled('agenda');
        indicator.agendaItem.actor.visible = agendaVisible;
        indicator.agendaSeparator.actor.visible = agendaVisible && notificationsVisible;
        indicator.evaluationItem.actor.visible = evaluationsVisible;
        indicator.evaluationSeparator.actor.visible = evaluationsVisible && (agendaVisible || notificationsVisible);
        indicator.notificationItem.actor.visible = notificationsVisible;
        // Caps, not fixed heights: short lists occupy only their natural height.
        // Preserve more room for notifications when the slot list is expanded.
        const slotsVisible = !!this._slotsExpanded && !indicator.loginOnly && enabled('slots');
        const evaluationMax = notificationsVisible ? (slotsVisible ? 190 : 300) : (slotsVisible ? 280 : 360);
        indicator.evaluationScroll?.set_style(`min-height: 0; max-height: ${evaluationMax}px;`);
        indicator.notificationSeparator.actor.visible = false;
        if (indicator.overviewSeparator) indicator.overviewSeparator.actor.visible = evaluationsVisible || agendaVisible || notificationsVisible;
    }

};
