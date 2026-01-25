# Agent Instructions

- Use `BLUEPRINT.md` as the primary architecture reference for this project.
- When making architectural or significant product changes, update `BLUEPRINT.md` first or in the same change set.
- If new components, data flows, or system constraints are introduced, reflect them in `BLUEPRINT.md`.
- Always use the latest version of a file. If the file contains changes you did not make, assume they were intentionally added, and incorporate them in your decision making.
- Keep the UI layout sketch in `BLUEPRINT.md` updated as the layout evolves.
- When implementing new features, add or update tests when it makes sense to do so.
- Run `npm test` after modifying files that should be covered by unit/integration tests (hooks, audio engine, or core UI logic), and report results.
- Run `npm run lint` after modifying JS/TS source files, and fix any lint errors.
