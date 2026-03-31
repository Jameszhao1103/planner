import {
  InMemoryPreviewRepository,
  InMemoryTripRepository,
  PlannerService,
  recomputeDerivedState,
} from "../planner/index.ts";
import { RuleBasedCommandTranslator } from "../planner/rule-based-command-translator.ts";
import { MockPlacesAdapter, MockRoutesAdapter } from "../integrations/mock/index.ts";
import { createGoogleAdapters } from "../integrations/google/index.ts";
import {
  createSamplePlaceCatalog,
  createSampleTrip,
  SAMPLE_TRIP_ID,
} from "../demo/sample-trip.ts";
import { resolveRuntimeMode } from "./runtime-config.mjs";

export async function createRuntime() {
  const provider = resolveRuntimeMode();
  const catalog = createSamplePlaceCatalog();
  const seedTrip = createSampleTrip();
  const adapters =
    provider === "google"
      ? createGoogleAdapters()
      : {
          placesAdapter: new MockPlacesAdapter(catalog),
          routesAdapter: new MockRoutesAdapter(catalog),
        };
  const { placesAdapter, routesAdapter } = adapters;
  const seedNow = new Date("2026-03-30T21:00:00-04:00");

  await recomputeDerivedState(seedTrip, {
    placesAdapter,
    routesAdapter,
    now: seedNow,
  });

  const tripRepository = new InMemoryTripRepository([seedTrip]);
  const previewRepository = new InMemoryPreviewRepository();
  const plannerService = new PlannerService(tripRepository, previewRepository, {
    placesAdapter,
    routesAdapter,
    commandTranslator: new RuleBasedCommandTranslator(),
    clock: () => new Date(),
  });

  const runtime = {
    provider,
    sampleTripId: SAMPLE_TRIP_ID,
    catalog,
    placesAdapter,
    routesAdapter,
    tripRepository,
    previewRepository,
    plannerService,
    async reset() {
      return createRuntime();
    },
  };

  return runtime;
}
