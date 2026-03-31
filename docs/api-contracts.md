# API Contracts

## Principles

- The client should load one workspace payload and derive all four panels from it.
- Chat and quick actions should use the same preview/apply pipeline.
- The API should be version-aware so itinerary edits remain deterministic.

## Base Response Envelope

Every successful JSON response should follow this high-level shape:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "request_id": "req_123",
    "trip_id": "trip_asheville_001",
    "version": 3
  }
}
```

Every failure response should follow this shape:

```json
{
  "ok": false,
  "error": {
    "code": "version_conflict",
    "message": "Trip version is stale.",
    "details": {}
  }
}
```

## Trip Workspace Endpoints

### `GET /api/trips/:tripId`

Returns the full workspace payload needed for the first render.

```json
{
  "trip": {},
  "workspace": {
    "selected_day": "2026-04-12",
    "summary_counts": {
      "days": 3,
      "conflicts": 1,
      "locked_items": 4
    }
  }
}
```

### `POST /api/trips`

Creates a new trip shell before itinerary generation.

Request:

```json
{
  "title": "Asheville Long Weekend",
  "timezone": "America/New_York",
  "start_date": "2026-04-12",
  "end_date": "2026-04-14"
}
```

Response:

```json
{
  "trip_id": "trip_asheville_001",
  "version": 1
}
```

## Generation Endpoints

### `POST /api/trips/:tripId/generate`

Creates the initial itinerary from anchors and preferences.

Request:

```json
{
  "base_version": 1,
  "anchors": {
    "flight_ids": [
      "flight_001"
    ],
    "hotel_place_id": "place_foundry"
  },
  "preferences": {
    "pace": "balanced",
    "max_walk_minutes": 20
  }
}
```

Response:

```json
{
  "trip": {},
  "generated_from": [
    "flight_001",
    "place_foundry"
  ]
}
```

## Command Preview and Apply

### `POST /api/trips/:tripId/commands/preview`

This is the core mutation endpoint. It accepts either free-form user text or explicit commands.

Request:

```json
{
  "base_version": 3,
  "input": {
    "utterance": "把周六晚餐换成评分高一点的美式餐厅"
  }
}
```

Alternative request:

```json
{
  "base_version": 3,
  "input": {
    "commands": [
      {
        "command_id": "cmd_001",
        "action": "replace_place",
        "item_id": "item_dinner",
        "reason": "User requested a higher-rated dinner option",
        "constraints": {
          "min_rating": 4.5
        }
      }
    ]
  }
}
```

Response:

```json
{
  "preview_id": "preview_001",
  "base_version": 3,
  "result_version": 4,
  "commands": [],
  "changed_item_ids": [
    "item_dinner",
    "route_river_arts_to_dinner"
  ],
  "warnings": [],
  "resolved_conflicts": [
    "conflict_curate_close"
  ],
  "introduced_conflicts": [],
  "diff": {
    "summary": "Replaced dinner with a later-opening restaurant and updated the route.",
    "patch": {}
  },
  "trip_preview": {}
}
```

### `POST /api/trips/:tripId/commands/apply`

Applies a previously previewed mutation.

Request:

```json
{
  "base_version": 3,
  "preview_id": "preview_001"
}
```

Response:

```json
{
  "trip": {},
  "applied_command_ids": [
    "cmd_001"
  ]
}
```

### `POST /api/trips/:tripId/commands/reject`

Discard a preview and clear server-side preview cache if you keep one.

Request:

```json
{
  "preview_id": "preview_001"
}
```

## Quick-Action Endpoints

These are optional wrappers. They are convenient, but internally they should still emit planner commands.

### `POST /api/trips/:tripId/actions/reoptimize-day`

```json
{
  "base_version": 3,
  "day_date": "2026-04-12"
}
```

### `POST /api/trips/:tripId/actions/fill-meal`

```json
{
  "base_version": 3,
  "day_date": "2026-04-12",
  "near_item_id": "item_biltmore_visit",
  "meal_type": "lunch"
}
```

These endpoints can be implemented later. For the first build, it is acceptable to map UI buttons directly to `commands/preview`.

## Supporting Reference Endpoints

### `GET /api/trips/:tripId/conflicts`

Returns machine-readable conflicts and display strings if conflict lists become too large to send in every payload.

### `GET /api/places/search?q=...`

Used for manual place search or disambiguation when the user picks a replacement explicitly.

### `POST /api/routes/compute`

Usually internal-only. Public exposure is optional. The UI does not need raw route computation if the planner engine already owns it.

## Concurrency Rules

- Every preview and apply request must include `base_version`.
- `apply` must fail with `409 version_conflict` if the trip changed after preview generation.
- The client should automatically refetch the trip on `409`.

## Error Codes

- `version_conflict`
- `invalid_command`
- `place_ambiguous`
- `place_not_found`
- `route_unavailable`
- `locked_item_violation`
- `validation_failed`

## Suggested Preview Diff Shape

Use a compact diff that the UI can render without understanding the whole planner engine:

```json
{
  "summary": "Moved dinner earlier and shortened the walk segment.",
  "item_changes": [
    {
      "item_id": "item_dinner",
      "change_type": "updated"
    }
  ],
  "route_changes": [
    {
      "route_id": "route_003",
      "change_type": "updated"
    }
  ],
  "markdown_changed_days": [
    "2026-04-12"
  ]
}
```

## Why This Contract Works

- one read endpoint powers all four panels
- one preview/apply pipeline powers chat and buttons
- version checks keep the shared state coherent
- diff payloads make assistant actions explainable instead of opaque
