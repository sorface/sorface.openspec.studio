## 1. Backend API

- [x] 1.1 Extend Git domain types with branch commit records and cherry-pick command input.
- [x] 1.2 Add `GET /git/branch-commits` endpoint with branch validation, bounded commit listing and integration tests.
- [x] 1.3 Add `POST /git/cherry-picks` endpoint that validates clean worktree, expected HEAD, branch and selected commits.
- [x] 1.4 Execute cherry-pick as an async Git operation with cancellation, progress events and conflict/error classification.

## 2. Frontend Workflow

- [x] 2.1 Extend Git API client, types and controller with branch commit loading and cherry-pick operation start.
- [x] 2.2 Add a compact "Подтянуть commits" section to GitPanel with branch select, commit checklist, empty/loading/error states and disabled unsafe actions.
- [x] 2.3 Update operation display copy so cherry-pick progress and failed conflict state are understandable.

## 3. Verification

- [x] 3.1 Add focused frontend tests for branch commit selection and operation trigger behavior.
- [x] 3.2 Run `npm --prefix openspec.frontend run check` and fix regressions.
