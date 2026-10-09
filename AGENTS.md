# AGENTS.md

# Project Context

This is a Firebase-backed React application. Keep edits focused and preserve local conventions.

Read `README.md` for Firebase setup, environment values, and local development. Firebase client settings belong in ignored `.env.local`; never commit service-account credentials.

## Key Files

- `src/`: frontend application source.
- `src/lib/firebase/`: Firebase initialization, Auth provider, Firestore adapter, and import pipeline.
- `firestore.rules` and `storage.rules`: per-user data access rules.
- `vite.config.js`: Vite configuration.

Run the checks in `package.json` before finishing code changes.
