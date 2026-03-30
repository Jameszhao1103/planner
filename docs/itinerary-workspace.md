# Itinerary Workspace

## Product Shape

The product is not a generic travel chatbot. It is an itinerary workspace with four synchronized views:

- Map: where the traveler moves
- Timeline: when the traveler does each thing
- Plan: what the traveler will actually execute and share
- Assistant: how the traveler edits the plan quickly

Every view must read from the same itinerary object. The chat surface never writes markdown directly and never edits map-only state. It produces structured commands that mutate itinerary state, then every view re-renders from that shared state.

## Desktop Wireframe

```text
+----------------------------------------------------------------------------------------------------+
| Trip Header                                                                                       |
| Asheville Long Weekend                     3 travelers        4 conflicts        Reoptimize Day    |
+---------------------------------------------------------------+------------------------------------+
| Map                                                           | Markdown Plan                      |
| - markers for flights, hotel, meals, sights                   | - generated from itinerary state   |
| - colored route lines by travel mode                          | - grouped by day                   |
| - hover shows duration, distance, arrival time                | - exportable and printable         |
| - click focuses the linked itinerary item                     | - mirrors timeline item ordering   |
|                                                               |                                    |
+---------------------------------------------------------------+------------------------------------+
| Timeline                                                      | Assistant                          |
| - day tabs                                                    | - command-first chat               |
| - time blocks                                                 | - diff preview before apply        |
| - conflict chips                                              | - quick actions                    |
| - lock state and drag affordances                             | - command history                  |
+---------------------------------------------------------------+------------------------------------+
```

## Layout Rules

- The top row should orient the user quickly: map for geography, markdown for the readable trip summary.
- Timeline and assistant sit below as the main editing and replanning surfaces.
- Selecting any item highlights it in all four surfaces.
- Conflicts are anchored to itinerary items, not to a single view.
- Locking is item-level and optionally route-level. Locked items can be moved only by explicit override.

## Mobile Collapse

- The default mobile view becomes a segmented workspace: `Timeline`, `Map`, `Plan`, `Assistant`.
- The selected itinerary item remains sticky across tabs.
- Command results should land on a compact before-and-after diff instead of a wide side panel.

## Core State Model

The itinerary object is the source of truth. Derived artifacts are cached but not user-authored:

- Map reads item coordinates and route polylines
- Timeline reads `start_at`, `end_at`, status, and conflict metadata
- Markdown reads day ordering, titles, notes, and transport summaries
- Assistant reads the full itinerary plus validation output and writes planner commands

The data model should separate authored state from derived state:

- Authored: trip metadata, user preferences, locks, selected places, reservations, notes
- Derived: routes, travel time, conflict detection, markdown sections, optimization suggestions

## Validation Loop

Each mutation follows the same execution path:

1. Apply the structured planner command to a working itinerary draft.
2. Resolve place candidates and route legs.
3. Recompute derived schedule fields such as arrival and slack.
4. Validate opening hours, transit feasibility, lock violations, and overlap conflicts.
5. Persist the itinerary if validation passes or save it with warnings if the command is allowed to be soft-invalid.
6. Refresh map, timeline, markdown, and assistant diff from the updated itinerary.

## Conflict Types

The first MVP only needs a small set of machine-readable conflicts:

- `opening_hours_conflict`
- `overlap_conflict`
- `travel_time_underestimated`
- `locked_item_violation`
- `meal_window_missing`
- `pace_limit_exceeded`
- `reservation_time_mismatch`

Conflicts should store severity, affected item ids, and a human-readable message for UI display.

## MVP Scope

Keep the first release narrow:

- Flight selection and anchoring
- Auto-generated daily itinerary
- Map rendering for stops and route polylines
- Daily timeline with conflict markers
- Markdown generation from structured state
- Assistant commands for replace, move, add meal, relax day, compress day, and switch transport mode
- Opening-hours validation

## Deferred Work

These are better left out of the first version:

- Multi-user collaboration
- Realtime shared editing
- Booking and checkout flows
- Full budget optimization
- Complex multi-city trip packing

## Command Interface Principles

- The assistant is a planner command interface, not a free-form conversational editor.
- Every applied command must return a visible diff of itinerary changes.
- The assistant can suggest multi-step plans, but execution still happens through explicit structured commands.
- Quick-action buttons should emit the same command schema as chat-generated actions.

## Recommended Next Build Step

Implement the shared itinerary store first. Once that contract exists, the map, timeline, markdown, and chat layers can be built independently against the same shape.
