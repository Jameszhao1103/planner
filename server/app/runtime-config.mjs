export function resolveRuntimeMode(env = process.env) {
  const provider = env.PLANNER_PROVIDER ?? inferProvider(env);
  return provider === "google" ? "google" : "mock";
}

function inferProvider(env) {
  if (env.GOOGLE_USE_REAL === "1" || env.GOOGLE_ENABLE_REAL === "1") {
    return "google";
  }

  return env.GOOGLE_MAPS_API_KEY || env.GOOGLE_API_KEY ? "google" : "mock";
}
