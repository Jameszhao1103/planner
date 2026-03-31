import { loadWorkspaceEnv } from "../../shared/env.ts";

export const GOOGLE_PLACES_BASE_URL = "https://places.googleapis.com";
export const GOOGLE_ROUTES_BASE_URL = "https://routes.googleapis.com";

export type GoogleAdaptersConfig = {
  apiKey: string;
  placesBaseUrl?: string;
  routesBaseUrl?: string;
  timeoutMs?: number;
};

export type ResolvedGoogleAdaptersConfig = {
  apiKey: string;
  placesBaseUrl: string;
  routesBaseUrl: string;
  timeoutMs: number;
};

export function resolveGoogleAdaptersConfig(
  input: Partial<GoogleAdaptersConfig> = {},
  env: Record<string, string | undefined> = loadWorkspaceEnv()
): ResolvedGoogleAdaptersConfig {
  const apiKey = input.apiKey ?? env.GOOGLE_MAPS_API_KEY ?? env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing Google Maps Platform API key. Set GOOGLE_MAPS_API_KEY or pass apiKey explicitly."
    );
  }

  return {
    apiKey,
    placesBaseUrl: input.placesBaseUrl ?? env.GOOGLE_PLACES_BASE_URL ?? GOOGLE_PLACES_BASE_URL,
    routesBaseUrl: input.routesBaseUrl ?? env.GOOGLE_ROUTES_BASE_URL ?? GOOGLE_ROUTES_BASE_URL,
    timeoutMs:
      input.timeoutMs ??
      parsePositiveInteger(env.GOOGLE_API_TIMEOUT_MS) ??
      10_000,
  };
}

function parsePositiveInteger(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
