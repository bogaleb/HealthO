export const APP_MODES = ["DEVELOPMENT", "DEMO_SYNTHETIC", "PILOT_APPROVED", "PRODUCTION_APPROVED"] as const;
export type AppMode = (typeof APP_MODES)[number];

export function appMode(): AppMode {
  const m = process.env.APP_MODE as AppMode | undefined;
  return m && (APP_MODES as readonly string[]).includes(m) ? m : "DEVELOPMENT";
}

/** True for any mode in which only synthetic data may exist. */
export function isSyntheticMode(mode: AppMode = appMode()): boolean {
  return mode === "DEVELOPMENT" || mode === "DEMO_SYNTHETIC";
}

export const SYNTHETIC_LABEL = "SYNTHETIC DEMO DATA";
