# Frontend Store Design

## Goal

The frontend should feel like one workspace, not four loosely coupled widgets. The store therefore needs one canonical trip state, one preview draft state, and a thin UI layer.

## Store Shape

```ts
type WorkspaceState = {
  trip: Itinerary | null;
  preview: Itinerary | null;
  baseVersion: number | null;
  selectedDay: string | null;
  selectedItemId: string | null;
  highlightedConflictId: string | null;
  assistantInput: string;
  pendingRequest:
    | null
    | "loading_trip"
    | "previewing_command"
    | "applying_command";
  lastPreviewSummary: string | null;
};
```

`trip` is the persisted canonical state.

`preview` is a temporary draft returned by `commands/preview`.

The UI should render from `preview ?? trip` whenever preview mode is active.

## Store Actions

- `loadTrip(tripId)`
- `selectDay(dayDate)`
- `selectItem(itemId)`
- `highlightConflict(conflictId)`
- `setAssistantInput(text)`
- `previewCommand(input)`
- `applyPreview(previewId)`
- `rejectPreview(previewId)`
- `clearPreview()`

## Rendering Rule

Every panel should consume `activeTrip = preview ?? trip`.

That means:

- the map uses preview routes before apply
- the timeline shows previewed moves immediately
- the markdown panel shows regenerated copy before apply
- the assistant panel can compare canonical and preview state side by side

## Derived Selectors

### `selectActiveTrip`

Returns `preview ?? trip`.

### `selectDayItems(dayDate)`

Returns sorted day items from the active trip.

### `selectMapOverlays`

Maps active trip items and routes into:

- markers
- route polylines
- focused item id
- highlighted conflict ids

### `selectTimelineBlocks`

Transforms active trip day items into calendar blocks:

- start minute
- end minute
- visual category
- lock state
- conflict badges

### `selectMarkdownSections`

Returns the markdown text blocks already derived by the backend. The frontend should not regenerate narrative text.

### `selectAssistantDiff`

Compares `trip` and `preview` and returns:

- changed items
- changed routes
- resolved conflicts
- introduced conflicts

## Component Tree

```text
TripWorkspacePage
TripHeader
MapPanel
MarkdownPanel
TimelinePanel
AssistantPanel
ConflictDrawer
```

## Component Inputs

### `TripHeader`

- trip title
- traveler count
- conflict count
- quick actions

### `MapPanel`

- markers
- routes
- selected item id
- callback for marker click

### `MarkdownPanel`

- markdown sections
- selected day
- scroll target item id if you want cross-panel syncing

### `TimelinePanel`

- day tabs
- blocks
- selected item id
- highlighted conflict id
- callbacks for drag, lock toggle, item click

### `AssistantPanel`

- assistant input
- preview summary
- command diff
- quick actions
- apply / reject buttons

## Interaction Flow

## Chat Preview

1. User types a request.
2. `AssistantPanel` calls `previewCommand`.
3. Store sets `pendingRequest = "previewing_command"`.
4. API returns `preview`.
5. Store saves preview and diff summary.
6. All panels re-render from `preview`.

## Apply

1. User accepts the preview.
2. Store calls `applyPreview`.
3. On success, `trip = response.trip` and `preview = null`.
4. `baseVersion` updates.

## Reject

1. User discards preview.
2. Store clears preview.
3. Panels fall back to canonical `trip`.

## Conflict-Driven Navigation

Conflicts should work as navigable references, not just badges.

- clicking a conflict highlights affected items
- map recenters if the selected item has coordinates
- markdown scrolls to the matching day section
- assistant can offer a one-click `resolve_conflict` preview

## Avoid These Frontend Mistakes

- do not keep separate route state in the map component
- do not let markdown become an independently edited document in MVP
- do not let assistant mutate local trip state without a server preview
- do not run opening-hours logic in multiple places

## Recommended First Components To Build

1. `TripWorkspacePage`
2. `useWorkspaceStore`
3. `MapPanel`
4. `MarkdownPanel`
5. `TimelinePanel`
6. `AssistantPanel`

Once these exist, the planner engine can be integrated without changing the page shape again.
