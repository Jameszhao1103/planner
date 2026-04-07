import type {
  OpeningHoursWindow,
  PlaceCategory,
  PlaceSnapshot,
  PlacesAdapter,
  RouteSnapshot,
  RoutesAdapter,
  TravelMode,
} from "../integrations/google/index.ts";

export type ItineraryPace = "relaxed" | "balanced" | "packed";
export type ItineraryItemKind =
  | "flight"
  | "transit"
  | "check_in"
  | "check_out"
  | "lodging"
  | "activity"
  | "meal"
  | "buffer"
  | "free_time";
export type ItineraryItemStatus = "confirmed" | "suggested" | "draft";
export type ItineraryItemSource = "user" | "ai" | "imported";
export type ConflictSeverity = "info" | "warning" | "error";
export type ConflictType =
  | "opening_hours_conflict"
  | "overlap_conflict"
  | "travel_time_underestimated"
  | "locked_item_violation"
  | "meal_window_missing"
  | "pace_limit_exceeded"
  | "reservation_time_mismatch";

export type Traveler = {
  id: string;
  name: string;
  age_band?: "child" | "adult" | "senior";
  mobility_notes?: string;
};

export type TimeWindow = {
  start: string;
  end: string;
};

export type TripPreferences = {
  pace: ItineraryPace;
  max_walk_minutes: number;
  preferred_transport_modes: TravelMode[];
  meal_windows: {
    breakfast?: TimeWindow;
    lunch: TimeWindow;
    dinner: TimeWindow;
  };
  must_visit_place_ids?: string[];
  avoid_place_ids?: string[];
};

export type ItineraryItem = {
  id: string;
  kind: ItineraryItemKind;
  title: string;
  subtitle?: string;
  start_at: string;
  end_at: string;
  duration_minutes?: number;
  status: ItineraryItemStatus;
  locked: boolean;
  source: ItineraryItemSource;
  category?: string;
  place_id?: string;
  route_id?: string;
  reservation_id?: string;
  notes?: string;
  tags?: string[];
  slack_minutes_before?: number;
  slack_minutes_after?: number;
  validation_conflict_ids?: string[];
};

export type ItineraryDay = {
  date: string;
  label: string;
  summary?: string;
  items: ItineraryItem[];
};

export type ItineraryPlace = {
  place_id: string;
  provider?: "google_places" | "manual";
  name: string;
  category: PlaceCategory;
  lat: number;
  lng: number;
  address?: string;
  rating?: number;
  price_level?: number;
  opening_hours?: OpeningHoursWindow[];
  maps_uri?: string;
};

export type ItineraryRouteStep = {
  instruction: string;
  duration_minutes: number;
  distance_meters: number;
  polyline?: string;
};

export type ItineraryRoute = {
  route_id: string;
  mode: TravelMode;
  from_item_id: string;
  to_item_id: string;
  duration_minutes: number;
  distance_meters: number;
  polyline?: string;
  provider?: "google_routes" | "manual";
  steps?: ItineraryRouteStep[];
};

export type ItineraryConflict = {
  id: string;
  type: ConflictType;
  severity: ConflictSeverity;
  message: string;
  item_ids: string[];
  resolution_hint?: string;
};

export type MarkdownSection = {
  day_date: string;
  content: string;
  generated_at?: string;
};

export type TripSummary = {
  trip_id: string;
  title: string;
  timezone: string;
  start_date: string;
  end_date: string;
  traveler_count: number;
  day_count: number;
  conflict_count: number;
  locked_item_count: number;
  last_updated_at?: string;
};

export type ChangeLogEntry = {
  id: string;
  timestamp: string;
  actor: "user" | "assistant" | "system";
  summary: string;
  command_ids?: string[];
};

export type Itinerary = {
  trip_id: string;
  version: number;
  title: string;
  timezone: string;
  start_date: string;
  end_date: string;
  travelers?: Traveler[];
  preferences: TripPreferences;
  days: ItineraryDay[];
  places: ItineraryPlace[];
  routes: ItineraryRoute[];
  conflicts: ItineraryConflict[];
  markdown_sections?: MarkdownSection[];
  change_log: ChangeLogEntry[];
};

export type PlannerCommandAction =
  | "lock_item"
  | "unlock_item"
  | "move_item"
  | "reorder_item"
  | "add_day"
  | "delete_day"
  | "replace_place"
  | "insert_item"
  | "restore_item"
  | "delete_item"
  | "set_transport_mode"
  | "optimize_day"
  | "relax_day"
  | "compress_day"
  | "fill_meal"
  | "regenerate_markdown"
  | "resolve_conflict";

export type PlannerCommand = {
  command_id: string;
  action: PlannerCommandAction;
  reason: string;
  preview_only?: boolean;
  day_date?: string;
  item_id?: string;
  target_item_id?: string;
  place_query?: string;
  place_id?: string;
  new_start_at?: string;
  new_end_at?: string;
  mode?: TravelMode;
  kind?: "activity" | "meal" | "buffer" | "free_time" | "transit";
  constraints?: {
    near_place_id?: string;
    min_rating?: number;
    max_price_level?: number;
    respect_locks?: boolean;
    max_walk_minutes?: number;
  };
  payload?: Record<string, unknown>;
};

export type PlannerCommandInput = {
  utterance?: string;
  commands?: PlannerCommand[];
  context?: PlannerCommandContext;
};

export type PlannerCommandContext = {
  selected_day?: string;
  selected_item_id?: string;
};

export type PlannerPreviewRequest = {
  tripId: string;
  baseVersion: number;
  input: PlannerCommandInput;
};

export type PlannerApplyRequest = {
  tripId: string;
  baseVersion: number;
  previewId: string;
};

export type PlannerExecuteRequest = {
  tripId: string;
  baseVersion: number;
  input: PlannerCommandInput;
};

export type PlannerRenameTripRequest = {
  tripId: string;
  baseVersion: number;
  title: string;
};

export type PlannerCreateTripRequest = {
  title: string;
  startDate: string;
  endDate: string;
  timezone: string;
  travelerCount?: number;
};

export type PlannerRejectPreviewRequest = {
  tripId: string;
  previewId: string;
};

export type PlannerPreviewDiff = {
  summary: string;
  patch: {
    changed_days: string[];
    changed_item_ids: string[];
    changed_route_ids: string[];
    changed_place_ids: string[];
  };
};

export type PlannerPreview = {
  previewId: string;
  tripId: string;
  baseVersion: number;
  resultVersion: number;
  commands: PlannerCommand[];
  changedItemIds: string[];
  warnings: string[];
  resolvedConflicts: string[];
  introducedConflicts: string[];
  diff: PlannerPreviewDiff;
  tripPreview: Itinerary;
  createdAt: string;
};

export type PlannerPreviewResponse = {
  preview_id: string;
  base_version: number;
  result_version: number;
  commands: PlannerCommand[];
  changed_item_ids: string[];
  warnings: string[];
  resolved_conflicts: string[];
  introduced_conflicts: string[];
  diff: PlannerPreviewDiff;
  trip_preview: Itinerary;
};

export type PlannerApplyResponse = {
  trip: Itinerary;
  applied_command_ids: string[];
};

export type PlannerExecuteResponse = {
  trip: Itinerary;
  applied_command_ids: string[];
  changed_item_ids: string[];
  summary: string;
  undo_commands: PlannerCommand[];
};

export type PlannerRenameTripResponse = {
  trip: Itinerary;
  summary: string;
};

export type PlannerCreateTripResponse = {
  trip: Itinerary;
  summary: string;
};

export interface PlannerCommandTranslator {
  translate(input: {
    trip: Itinerary;
    utterance: string;
    context?: PlannerCommandContext;
  }): Promise<PlannerCommand[]>;
}

export type PlannerDerivationContext = {
  routesAdapter: RoutesAdapter;
  preferredModes: TravelMode[];
  maxWalkMinutes: number;
};

export type PlannerDependencies = {
  placesAdapter: PlacesAdapter;
  routesAdapter: RoutesAdapter;
  clock?: () => Date;
  commandTranslator?: PlannerCommandTranslator;
};

export type CommandExecutionContext = PlannerDependencies & {
  now: Date;
};

export type PlaceResolution = {
  snapshot: PlaceSnapshot;
  title: string;
};

export type RouteComputation = {
  route: ItineraryRoute;
  snapshot: RouteSnapshot;
};
