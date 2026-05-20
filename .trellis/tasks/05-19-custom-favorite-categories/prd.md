# Custom Favorite Categories

## Goal

Add user-defined categories for favorite image generation records so users can organize saved outputs beyond a single favorite flag.

## What I already know

* The user wants a category feature for custom favorites.
* Current favorites are stored per task as `TaskRecord.isFavorite`.
* Task records live in IndexedDB `tasks`; there is no separate category store today.
* Search and favorite filtering are implemented in `src/components/SearchBar.tsx` and `src/components/TaskGrid.tsx`.
* Favorite toggles exist on task cards, detail modal, and the multi-select action bar.
* Export/import serializes full task records through `manifest.json`, but standalone category metadata needs explicit manifest support if categories become separate entities.

## Assumptions (temporary)

* Categories are local-only, like current task records and settings.
* Categories only apply to favorites for this task; general tagging of every task is out of scope unless requested.
* Existing uncategorized favorites remain visible under the current favorite filter.

## Open Questions

* None.

## Requirements (evolving)

* Users can assign a custom category to a favorite record.
* Each favorite record supports one category only.
* Users assign or edit a single record's category from the detail modal.
* Users can filter favorite records by category.
* Users can rename categories.
* Users can delete categories; deleting a category clears it from assigned tasks.
* Users can reorder categories for display in selectors and filters.
* Users can choose a color for each category.
* New users get one default category immediately so category controls are visible without manual setup.
* Users with old persisted category state, including an old empty category array, are migrated to one default category.
* Users manage categories from the settings modal.
* Users can keep using the existing favorite toggle without being forced to categorize.
* Existing records remain compatible when the new field is missing.
* Category data persists in IndexedDB and survives export/import.

## Acceptance Criteria (evolving)

* [ ] A favorite record can be assigned to a custom category.
* [ ] Each favorite has at most one category.
* [ ] Category assignment for a single record is available in the detail modal.
* [ ] The task grid can show records filtered by a selected favorite category.
* [ ] Categories can be renamed, deleted, reordered, and recolored.
* [ ] A default category exists on first load, in fresh local state, and after loading old persisted category state.
* [ ] Category management is available in the settings modal.
* [ ] Deleting a category clears that category from records that used it.
* [ ] Uncategorized favorites still appear when filtering by all favorites.
* [ ] Existing records without category data still render without errors.
* [ ] Exported and imported records preserve assigned category data.
* [ ] Relevant store/runtime tests cover category persistence or filtering behavior.
* [ ] `npm run build` and `npm test` pass.

## Definition of Done (team quality bar)

* Tests added or updated where behavior changes.
* Lint/typecheck/build and tests pass.
* UI works on desktop and mobile widths.
* Docs or Trellis specs updated if new project conventions are learned.
* Rollback considered: removing the feature should leave old task records readable.

## Out of Scope (explicit)

* Cloud sync or multi-device category syncing.
* Nested categories.
* Multi-label favorites.
* Per-image categories inside one multi-output task.
* Bulk import/export UX redesign.

## Decision (ADR-lite)

**Context**: Current favorites are represented by a single boolean field on `TaskRecord`, and the task grid already has a simple favorite filter.

**Decision**: Use single-category favorites for the MVP. Each favorite can have zero or one custom category.

**Consequences**: This keeps storage, filtering, and bulk actions simple. If multi-label support is needed later, the task-level category field can migrate to a list.

**Context**: Category editing needs a UI entry point. Task cards are already compact and optimized for preview/actions.

**Decision**: Put single-record category assignment in the detail modal.

**Consequences**: The card UI stays clean. Assigning a category requires opening the detail modal, which is acceptable for the MVP.

**Context**: The user chose full category management: rename, delete, ordering, and color.

**Decision**: Model favorite categories as standalone local entities, and store task assignment by category id rather than by raw category name.

**Consequences**: Rename and color updates do not require rewriting every task. Delete still needs to clear matching task assignments. Export/import must include category metadata.

**Context**: Full category management needs a stable UI area. The existing settings modal already hosts persistent app configuration and data management.

**Decision**: Add favorite category management to the settings modal.

**Consequences**: Category management stays centralized. The detail modal remains focused on assigning the current record to one category.

**Context**: If the category list starts empty, the main category filter is hidden and users may think the deployed feature is missing.

**Decision**: Seed a default favorite category in fresh local state and when legacy persisted state has no initialized category metadata.

**Consequences**: Category controls are visible immediately. Users can rename, recolor, reorder, or delete the default category like any other category. Persisted stores use an initialization marker so an old empty category array is migrated once, while a user-deleted empty list stays empty afterward.

## Technical Approach

* Add a `FavoriteCategory` type with `id`, `name`, `color`, `sortOrder`, and `createdAt`.
* Provide a deterministic default category for fresh stores and legacy persisted stores with no initialized category metadata.
* Add `favoriteCategoryId?: string | null` to `TaskRecord`.
* Persist categories in Zustand state because category metadata is small app-level local configuration.
* Store task assignments in IndexedDB with each task record.
* Filter by `favoriteCategoryId` in `TaskGrid` and expose the category selector from `SearchBar`.
* Add category assignment controls in `DetailModal`.
* Add category management controls in `SettingsModal`.
* Extend export/import manifest data so category metadata survives backups.

## Implementation Plan

* PR1: Add types, store state/actions, export/import support, and tests for category persistence.
* PR2: Add category filter and detail modal assignment UI.
* PR3: Add settings modal management UI for rename, delete, reorder, and color.
* PR4: Run build/test, visually verify desktop and mobile layouts, then clean up docs/spec notes if needed.

## Technical Notes

* `src/types.ts` defines `TaskRecord`.
* `src/lib/db.ts` stores tasks as whole records in IndexedDB.
* `src/store.ts` stores search/filter UI state in Zustand; only settings, params, prompt, input images, and Codex prompt dismissals persist through Zustand middleware.
* `src/components/SearchBar.tsx` owns favorite and status filters.
* `src/components/TaskGrid.tsx` applies filtering and disables drag when filters are active.
* `src/components/TaskCard.tsx`, `src/components/DetailModal.tsx`, and `src/components/InputBar/SelectionActionBar.tsx` update favorite state.
* `src/lib/exportImport.ts` already exports task records wholesale.
* `src/components/SettingsModal.tsx` already contains persistent configuration sections and data management actions; category management can live there.
