export type ThemePreference = 'system' | 'light' | 'dark';
const key = 'aegis-theme';
// The choice for this page, even if storage refuses to keep it.
let chosen: ThemePreference | undefined;
const query = () => window.matchMedia('(prefers-color-scheme: dark)');
// Storage can be unavailable (private windows, blocked site data); the theme
// then follows the system for this visit.
export function themePreference(): ThemePreference {
  if (chosen) return chosen;
  try {
    const value = localStorage.getItem(key);
    if (value === 'system' || value === 'light' || value === 'dark')
      return value;
  } catch {
    // Fall through to the system theme.
  }
  // AEGIS (W-FIX 3a): dark-first   the brand base is graphite, so with
  // no saved choice the app opens dark instead of following the OS.
  // 'system' remains selectable in Settings > Appearance.
  return 'dark';
}
export function resolveTheme(preference: ThemePreference, systemDark: boolean) {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}
function apply() {
  const theme = resolveTheme(themePreference(), query().matches);
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#0b1120' : '#eef1f6');
}
export function setThemePreference(preference: ThemePreference) {
  chosen = preference;
  try {
    localStorage.setItem(key, preference);
  } catch {
    // Applies for this visit only.
  }
  apply();
}
export function watchSystemTheme() {
  apply();
  query().addEventListener('change', apply);
}
