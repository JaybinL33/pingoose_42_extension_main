// Advanced features are intentionally not exposed in release preferences.
// General settings can also unlock these options with a local phrase. This is a UI/product gate,
// not a security boundary against someone modifying their own client.
var HIDDEN_OPTIONS = false;
var DEVELOPMENT_DEFAULTS = false;
function unlocked(settings) {
    return HIDDEN_OPTIONS || settings.get_boolean('hidden-options-unlocked');
}
function unlock(settings, phrase) {
    if (phrase.trim().toLowerCase() !== 'pingoose-hidden') return false;
    settings.set_boolean('hidden-options-unlocked', true);
    return true;
}
function enabled(settings, key) {
    if (!unlocked(settings)) return false;
    return settings.get_user_value(key) === null ? DEVELOPMENT_DEFAULTS : settings.get_boolean(key);
}
