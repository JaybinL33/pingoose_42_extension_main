const {GLib}=imports.gi;
imports.searchPath.unshift(GLib.build_filenamev([GLib.get_current_dir(),'src','tests']));
imports['chat-scoped-loopback'];
