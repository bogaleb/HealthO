/**
 * Release identity (Phase 8). The version follows SemVer from the root package.json and is stamped at build/deploy
 * time via APP_VERSION + GIT_SHA (CI and the Dockerfile pass them). Shown only on health endpoints — no secrets.
 */
export const RELEASE_VERSION_FALLBACK = "0.3.0-rc.1";

export function releaseInfo(env: Record<string, string | undefined> = process.env) {
  const sha = (env.GIT_SHA ?? "").trim();
  return {
    version: (env.APP_VERSION ?? "").trim() || RELEASE_VERSION_FALLBACK,
    gitSha: /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 12) : "unknown",
    builtAt: (env.BUILD_TIME ?? "").trim() || null,
  };
}
