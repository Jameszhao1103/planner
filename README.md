# Planner Workspace Foundation

This repository starts with the core product contracts for an itinerary workspace:

- A four-panel workspace wireframe for map, timeline, markdown, and chat
- A shared itinerary schema that every view reads from
- A planner command schema for LLM-driven state mutations

Files:

- `wireframes/itinerary-workspace.html`
- `docs/itinerary-workspace.md`
- `docs/planner-commands.md`
- `schemas/itinerary.schema.json`
- `schemas/planner-command.schema.json`
- `examples/sample-itinerary.json`

The intent is to keep a single itinerary state as the source of truth, then derive:

- map markers and route polylines
- timeline blocks and conflict warnings
- markdown trip notes
- command execution and replanning
