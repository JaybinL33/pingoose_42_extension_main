var Controller=class Controller {
    _applyPanelLayout(){
        const indicator=this._indicator;
        if(!indicator?.sideColumns)return;
        const columns=indicator.sideColumns;
        const settings=this._settings;
        columns.set_style(`spacing: 0; padding-top: ${settings.get_int('popup-top-margin')}px; padding-right: ${settings.get_int('popup-left-margin')}px;`);
        const panels=columns.get_children().filter(child=>child!==indicator.menu.box && child.visible);
        panels.forEach((panel,index)=>panel.set_style(`margin-right: ${settings.get_int(index===panels.length-1?'main-panel-gap':'panel-gap')}px;`));
        indicator.syncPanelLayout=()=>this._applyPanelLayout();
    }
};
