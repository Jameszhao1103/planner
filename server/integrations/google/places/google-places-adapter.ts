import {
  OPENING_HOURS_WEEKDAYS,
  formatHourMinute,
  type OpeningHoursWindow,
  type PlaceCategory,
} from "../shared/domain-types.ts";
import { GoogleHttpClient } from "../shared/http-client.ts";
import {
  PLACE_DETAILS_FIELD_MASK,
  resolvePlaceSearchFieldMask,
} from "./field-masks.ts";
import type {
  GoogleOpeningHours,
  GooglePlace,
  GooglePlaceSearchRequest,
  GooglePlaceSearchResponse,
  GooglePriceLevel,
  PlaceCandidate,
  PlaceDetailsRequest,
  PlaceSearchRequest,
  PlaceSnapshot,
  PlacesAdapter,
} from "./types.ts";

export class GooglePlacesAdapter implements PlacesAdapter {
  private readonly client: GoogleHttpClient;

  constructor(client: GoogleHttpClient) {
    this.client = client;
  }

  async searchByText(input: PlaceSearchRequest): Promise<PlaceCandidate[]> {
    const request = mapSearchRequest(input);
    const includeHours = Boolean(input.openNow);
    const response = await this.client.postJson<GooglePlaceSearchResponse>({
      path: "/v1/places:searchText",
      fieldMask: resolvePlaceSearchFieldMask(includeHours),
      body: request,
    });

    return (response.places ?? []).map(mapGooglePlaceToCandidate);
  }

  async getPlaceDetails(input: PlaceDetailsRequest): Promise<PlaceSnapshot> {
    const placeId = normalizePlaceId(input.placeId);
    const response = await this.client.getJson<GooglePlace>({
      path: `/v1/places/${placeId}`,
      fieldMask: PLACE_DETAILS_FIELD_MASK,
      query: {
        languageCode: input.languageCode,
        regionCode: input.regionCode,
      },
    });

    return mapGooglePlaceToSnapshot(response);
  }
}

function mapSearchRequest(input: PlaceSearchRequest): GooglePlaceSearchRequest {
  return {
    textQuery: input.query,
    languageCode: input.languageCode,
    regionCode: input.regionCode,
    includedType: input.includedType,
    openNow: input.openNow,
    minRating: input.minRating,
    priceLevels: buildPriceLevels(input.maxPriceLevel),
    pageSize: input.pageSize,
    strictTypeFiltering: input.strictTypeFiltering ?? Boolean(input.includedType),
    locationBias: input.locationBias
      ? {
          circle: {
            center: {
              latitude: input.locationBias.center.lat,
              longitude: input.locationBias.center.lng,
            },
            radius: input.locationBias.radiusMeters,
          },
        }
      : undefined,
  };
}

function mapGooglePlaceToCandidate(place: GooglePlace): PlaceCandidate {
  return {
    placeId: place.id,
    name: place.displayName?.text ?? "Unknown place",
    formattedAddress: place.formattedAddress,
    location: {
      lat: place.location?.latitude ?? 0,
      lng: place.location?.longitude ?? 0,
    },
    primaryType: place.primaryType,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    priceLevel: mapPriceLevel(place.priceLevel),
    regularOpeningHours: mapOpeningHours(place.regularOpeningHours),
    currentOpenNow: place.currentOpeningHours?.openNow,
  };
}

function mapGooglePlaceToSnapshot(place: GooglePlace): PlaceSnapshot {
  return {
    placeId: place.id,
    provider: "google_places",
    name: place.displayName?.text ?? "Unknown place",
    formattedAddress: place.formattedAddress,
    location: {
      lat: place.location?.latitude ?? 0,
      lng: place.location?.longitude ?? 0,
    },
    category: mapGoogleTypesToCategory(place.types),
    googleMapsUri: place.googleMapsUri,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    priceLevel: mapPriceLevel(place.priceLevel),
    regularOpeningHours: mapOpeningHours(place.regularOpeningHours),
    currentOpeningHoursText: place.currentOpeningHours?.weekdayDescriptions,
    types: place.types ?? [],
  };
}

function mapGoogleTypesToCategory(types?: string[]): PlaceCategory {
  const value = new Set(types ?? []);

  if (value.has("airport")) return "airport";
  if (value.has("lodging") || value.has("hotel")) return "hotel";
  if (value.has("restaurant") || value.has("food")) return "restaurant";
  if (value.has("museum")) return "museum";
  if (value.has("park")) return "park";
  if (value.has("shopping_mall") || value.has("store")) return "shopping";
  if (value.has("train_station") || value.has("subway_station")) return "station";
  if (value.has("tourist_attraction") || value.has("point_of_interest")) return "landmark";

  return "other";
}

function mapOpeningHours(openingHours?: GoogleOpeningHours): OpeningHoursWindow[] | undefined {
  const periods = openingHours?.periods ?? [];
  if (periods.length === 0) {
    return undefined;
  }

  const windows = periods.flatMap((period) => {
    if (!period.open || !period.close) {
      return [];
    }

    if (
      period.open.day === undefined ||
      period.close.day === undefined ||
      period.open.day !== period.close.day
    ) {
      return [];
    }

    return [
      {
        weekday: OPENING_HOURS_WEEKDAYS[period.open.day] ?? "monday",
        open: formatHourMinute(period.open.hour, period.open.minute),
        close: formatHourMinute(period.close.hour, period.close.minute),
      },
    ];
  });

  return windows.length > 0 ? windows : undefined;
}

function buildPriceLevels(maxPriceLevel?: number): GooglePriceLevel[] | undefined {
  if (maxPriceLevel === undefined || maxPriceLevel <= 0) {
    return undefined;
  }

  const all: GooglePriceLevel[] = [
    "PRICE_LEVEL_INEXPENSIVE",
    "PRICE_LEVEL_MODERATE",
    "PRICE_LEVEL_EXPENSIVE",
    "PRICE_LEVEL_VERY_EXPENSIVE",
  ];

  return all.slice(0, Math.max(0, Math.min(maxPriceLevel, all.length)));
}

function mapPriceLevel(value?: GooglePriceLevel): number | undefined {
  switch (value) {
    case "PRICE_LEVEL_FREE":
      return 0;
    case "PRICE_LEVEL_INEXPENSIVE":
      return 1;
    case "PRICE_LEVEL_MODERATE":
      return 2;
    case "PRICE_LEVEL_EXPENSIVE":
      return 3;
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return 4;
    default:
      return undefined;
  }
}

function normalizePlaceId(placeId: string): string {
  return placeId.startsWith("places/") ? placeId.slice("places/".length) : placeId;
}
