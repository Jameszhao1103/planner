import { loadWorkspaceEnv } from "../shared/env.ts";

export function resolveRuntimeEnv(env = loadWorkspaceEnv()) {
  return env;
}

export function resolveRuntimeMode(env = resolveRuntimeEnv()) {
  const provider = env.PLANNER_PROVIDER ?? inferProvider(env);
  return provider === "google" ? "google" : "mock";
}

export function resolveMapsBrowserApiKey(env = resolveRuntimeEnv()) {
  return (
    env.GOOGLE_MAPS_BROWSER_API_KEY ??
    env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
    env.GOOGLE_MAPS_API_KEY ??
    env.GOOGLE_API_KEY ??
    null
  );
}

function inferProvider(env) {
  if (env.GOOGLE_USE_REAL === "1" || env.GOOGLE_ENABLE_REAL === "1") {
    return "google";
  }

  return env.GOOGLE_MAPS_API_KEY || env.GOOGLE_API_KEY ? "google" : "mock";
}
