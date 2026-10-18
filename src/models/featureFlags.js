// Advanced features are intentionally not exposed in release preferences.
// Set this to true locally to reveal Hidden Options. This is a UI/product gate,
// not a security boundary against someone modifying their own client.
var HIDDEN_OPTIONS = false;
var DEVELOPMENT_DEFAULTS = false;
function enabled(settings, key) {
    if (!HIDDEN_OPTIONS) return false;
    return settings.get_user_value(key) === null ? DEVELOPMENT_DEFAULTS : settings.get_boolean(key);
}
