interface ImportMetaEnv {
  /** The public origin, from VITE_PUBLIC_URL (vite.config.ts). */
  readonly VITE_PUBLIC_URL: string;
  /** The public origin plus the base path, with a trailing slash. */
  readonly VITE_APP_URL: string;
}
