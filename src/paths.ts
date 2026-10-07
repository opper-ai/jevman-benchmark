// The app may be served below a path prefix (APP_BASE_PATH at build time, e.g. /jevman-benchmark/), so every
// request and link the client makes goes through here instead of starting at the host's root.

/** Vite's `base`: '/' at the root, or '/jevman-benchmark/' below a prefix. Always ends with a slash. */
export const BASE_URL: string = import.meta.env.BASE_URL;

/** `path` ('/api/me', '/?pacman=…', '/leaderboard') below `base` (which ends with a slash). */
export const withBase = (base: string, path: string): string => base + path.replace(/^\/+/, '');

/** An app path below the base path this build was made for. */
export const appPath = (path: string): string => withBase(BASE_URL, path);

/** The address share links point at: the bare origin at the root (as before), else the app's own address. */
export const shareUrlFor = (base: string, publicUrl: string, appUrl: string): string => (base === '/' ? publicUrl : appUrl);

/** E.g. https://opper.ai/jevman-benchmark/ (VITE_PUBLIC_URL + APP_BASE_PATH), or just VITE_PUBLIC_URL at the root. */
export const SHARE_URL: string = shareUrlFor(BASE_URL, import.meta.env.VITE_PUBLIC_URL, import.meta.env.VITE_APP_URL);
