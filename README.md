# Planner Workspace Foundation

This repository starts with the core product contracts for an itinerary workspace:

- A four-panel workspace wireframe for map, timeline, markdown, and chat
- A shared itinerary schema that every view reads from
- A planner command schema for LLM-driven state mutations

Files:

- `wireframes/itinerary-workspace.html`
- `docs/itinerary-workspace.md`
- `docs/planner-commands.md`
- `docs/system-architecture.md`
- `docs/api-contracts.md`
- `docs/frontend-store.md`
- `docs/google-adapters.md`
- `docs/planner-engine.md`
- `schemas/itinerary.schema.json`
- `schemas/planner-command.schema.json`
- `examples/sample-itinerary.json`
- `server/planner/`

Run locally:

- `npm run dev`
- Open `http://localhost:3000`

Use real Google adapters:

- set `GOOGLE_MAPS_API_KEY=...`
- optional: set `PLANNER_PROVIDER=google`
- run `npm run test:google`
- then run `npm run dev` and check the provider pill in the UI

Test locally:

- `npm test`

The intent is to keep a single itinerary state as the source of truth, then derive:

- map markers and route polylines
- timeline blocks and conflict warnings
- markdown trip notes
- command execution and replanning
