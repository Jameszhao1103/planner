# Planner Commands

## Intent

The assistant should never mutate the itinerary through free-form prose. It should translate user intent into a small command set that the planner service can validate, execute, diff, and log.

## Execution Contract

Each user request follows the same path:

1. Interpret the utterance into one or more planner commands.
2. Resolve missing place candidates or routing data.
3. Execute against a working itinerary draft.
4. Validate conflicts and lock constraints.
5. Return a before-and-after diff for explicit apply.
6. Persist the mutation and append the change log.

## MVP Command Catalog

### Lock and protect

- `lock_item`
  - Use for flights, reservations, ticketed activities, and user-mandated stops.
  - Example: "Lock dinner on Saturday."
- `unlock_item`
  - Use when the user explicitly allows replanning around a previously fixed item.

### Reschedule

- `move_item`
  - Move an existing item to a new time while preserving its place.
  - Example: "Push the museum visit to 3 PM."
- `optimize_day`
  - Reorder flexible items for route efficiency while respecting locks.
  - Example: "Reoptimize Tuesday."
- `relax_day`
  - Reduce density by adding slack or removing lower-priority stops.
  - Example: "Second day is too packed."
- `compress_day`
  - Tighten spacing and reduce idle gaps without violating locks or opening hours.
  - Example: "Make Friday more efficient."

### Replace and insert

- `replace_place`
  - Swap the place behind an existing item while keeping the item role.
  - Example: "Replace dinner with a better American restaurant."
- `insert_item`
  - Add a new meal, activity, buffer, or free-time block.
  - Example: "Add coffee near the museum after lunch."
- `delete_item`
  - Remove an item entirely.
  - Example: "Drop the brewery stop."
- `fill_meal`
  - A specialized insert that looks for a meal candidate near the current route.
  - Example: "Add lunch near Biltmore."

### Transit and repair

- `set_transport_mode`
  - Change the travel mode for a segment or linked item pair.
  - Example: "Anything over 20 minutes walking should be a taxi."
- `resolve_conflict`
  - Accept a targeted repair proposal tied to a validation issue.
  - Example: "Fix the restaurant closing-time conflict."
- `regenerate_markdown`
  - Refresh derived plan text after itinerary mutations.
  - This should usually happen automatically as part of the write pipeline.

## Utterance to Command Examples

- User: "把周六晚餐换成评分高一点的美式餐厅。"
  - Commands: `replace_place` then `regenerate_markdown`
- User: "第二天太赶了，删掉一个景点。"
  - Commands: `relax_day`
- User: "把步行 25 分钟以上的活动都改成打车。"
  - Commands: one or more `set_transport_mode`
- User: "午饭安排在博物馆附近。"
  - Commands: `fill_meal`

## Command Design Rules

- Commands should be composable. One user utterance can expand into multiple commands.
- Commands should be minimal. Avoid large opaque payloads if a named action can express the change.
- Commands should be auditable. The UI must show which items changed and why.
- Commands should be deterministic after external lookups finish.
- Commands should target itinerary ids wherever possible, not raw text labels.

## Suggested Response Shape

When the assistant proposes a mutation, the backend should return:

- parsed commands
- candidate replacements if search was ambiguous
- affected item ids
- derived conflicts introduced or resolved
- markdown sections regenerated
- a concise human summary for the diff UI

## Quick Actions

The visible shortcut buttons should emit the exact same command schema as chat:

- Reoptimize day
- Add lunch
- Replace activity
- Relax schedule
- Compress schedule
- Switch long walks to taxi

This keeps the assistant and the explicit UI controls on one mutation pipeline.
