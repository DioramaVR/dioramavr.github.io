// Site-wide settings that aren't release data.
export const PATREON = 'https://www.patreon.com/cw/dioramavr';
// Always the newest installer (GitHub's "latest release" link). Shown once the registry has app.latest.
export const INSTALLER_URL = 'https://github.com/DioramaVR/dvr-installer-public/releases/latest/download/DioramaVR-Setup.exe';
// The standard disclaimer (user's choice, 2026-11-07); credits.json carries the same text.
export const DISCLAIMER = 'DioramaVR is an unofficial fan project. It isn’t affiliated with or endorsed by the makers of the games it supports. Game names and art belong to their owners.';
export const PITCH = 'Free and open-source VR mods that turn your games into dioramas';
// The one control every DioramaVR mod shares; the mod menu has everything else.
export const MENU_CONTROL = {
  keys: ['Both grips', 'Both triggers'],
  action: 'Hold both grips and pull both triggers to open the mod menu. Everything else is in there: the controls, the settings, and where the game’s windows go.',
};
