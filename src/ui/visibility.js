

var Controller = class Controller {
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
