import { createGoogleAdapters } from "../server/integrations/google/index.ts";
import { createSamplePlaceCatalog } from "../server/demo/sample-trip.ts";

const { placesAdapter, routesAdapter } = createGoogleAdapters();
const catalog = createSamplePlaceCatalog();
const downtown = catalog.find((place) => place.place_id === "place_curate");
const hotel = catalog.find((place) => place.place_id === "place_foundry");

if (!downtown || !hotel) {
  throw new Error("Sample catalog is missing downtown or hotel anchor.");
}

const search = await placesAdapter.searchByText({
  query: "american restaurant downtown Asheville",
  includedType: "restaurant",
  locationBias: {
    center: {
      lat: downtown.lat,
      lng: downtown.lng,
    },
    radiusMeters: 3000,
  },
  minRating: 4.2,
  pageSize: 3,
});

const leg = await routesAdapter.computeLeg({
  origin: {
    location: {
      lat: hotel.lat,
      lng: hotel.lng,
    },
  },
  destination: {
    location: {
      lat: downtown.lat,
      lng: downtown.lng,
    },
  },
  travelMode: "drive",
  includeSteps: true,
});

console.log(
  JSON.stringify(
    {
      ok: true,
      provider: "google",
      search_results: search.map((candidate) => ({
        place_id: candidate.placeId,
        name: candidate.name,
        rating: candidate.rating,
        price_level: candidate.priceLevel,
      })),
      route_check: {
        distance_meters: leg.distanceMeters,
        duration_minutes: leg.durationMinutes,
        has_polyline: Boolean(leg.polyline),
      },
    },
    null,
    2
  )
);
