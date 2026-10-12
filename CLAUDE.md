# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Reelhouse: a self-hosted dashboard that scans S3-compatible buckets (AWS, R2, MinIO, KeyCDN, Wasabi, B2), computes metrics (notably total video play time, extracted remotely via HTTP Range probes), previews files, and mirrors objects to the local disk of the "on-premise box" it runs on, preserving folder hierarchy.

## Commands

Run from the repo root unless noted.

- `npm run dev`: API server (tsx, port 3001) plus Vite dev server (port 5173, proxies `/api` and `/ws` to 3001). Use http://localhost:5173.
- `npm run server`: API server only. It also serves `client/dist` if that folder has been built, so http://localhost:3001 works as a production setup.
- `npm run build`: builds the client (`tsc && vite build` in `client/`).
- Typecheck the server: `npx tsc --noEmit -p .` (the root `tsconfig.json` covers only `server/src`).
- Typecheck the client: `cd client && npx tsc --noEmit -p tsconfig.json`.

There is no test suite and no linter. Verify server changes by running the server and hitting endpoints with curl. The server creates `data/` (SQLite) and `downloads/` relative to the **current working directory**. To experiment without touching the real DB, start it from a scratch directory: `PORT=3999 node <repo>/node_modules/tsx/dist/cli.mjs <repo>/server/src/index.ts`. The UI's "Load Demo CDN Library" button (`POST /api/demo/seed`) adds a demo source with sample files.

Environment variables: `PORT` (default 3001) and `CORS_ORIGINS` (comma-separated; default `http://localhost:5173,http://127.0.0.1:5173`).

## Architecture

Two packages: the root is the Express server (`server/src`, CommonJS project run directly via `tsx`, no build step) and `client/` is a separate React 19 + Vite + Tailwind v4 app with its own `package.json`.

### Server (`server/src`)

- `index.ts`: the entire HTTP API (Express 5) plus the WebSocket server at `/ws`. Routes call the repos and services directly; there are no route modules. Also holds the request-validation helpers (`parseDirectoryPath`, `sendError`, `findLocalCopy`).
- `db.ts`: better-sqlite3 schema and repositories (`sourceRepo`, `fileRepo`, `downloadRepo`). Schema changes go in the "safe migrations" block as `try { ALTER TABLE ... } catch {}`, because existing databases are never recreated. Rows are mapped from snake_case columns to camelCase objects in the `map*Row` functions.
- `services/storageService.ts`: S3 client per source, including provider-specific endpoint defaults, listing, range reads, presigned URLs.
- `services/scannerService.ts`: lists the bucket page by page, upserts `files` rows, checks whether each object already exists locally, and (on a deep scan) extracts media duration and resolution. It reads a local copy when one is synced, otherwise it probes the remote object with a Range request (`utils/mediaInspector.ts`: a hand-written MP4 box parser plus music-metadata).
- `services/downloadService.ts`: in-memory queue (concurrency 3) writing to a temp file and renaming it when complete. Every download belongs to a `download_batches` row (types: manual_batch, date_range, sync_all, folder). On completion the file is marked `synced` and its actual path is stored in `files.local_file_path`.
- `services/metricsService.ts`: aggregates `files` rows into the `ScanMetrics` payload.
- `errors.ts`: `BadRequestError` and `NotFoundError`. Services throw these and `sendError` in `index.ts` maps them to 400 and 404 (anything else is 500).

Progress is pushed to the client, not polled: scanner and download services expose `onProgress` listeners that `index.ts` broadcasts as `scan:progress` and `download:progress` WebSocket messages.

### Where downloaded files live (cross-cutting rule)

A source's `localPath` is its *default* mirror folder and may be empty. Any download can instead target a custom `destinationDir`. As a result, a file's local copy may be either `path.join(source.localPath, key)` or `files.local_file_path`. Code that looks for local copies (scanner, `/stream`, `/raw`) must check both, in that order. Don't assume everything lives under `localPath`.

### Client (`client/src`)

- `App.tsx` owns nearly all state and every API call that changes data. Components are mostly presentational and receive callbacks as props.
- Downloads go through `ensureDownloadLocation` in `App.tsx`. If the source has no `localPath`, it opens `DownloadLocationModal` and returns a promise that resolves once the user confirms (`true`) or dismisses the modal (`false`). Requests are sent through the shared `postDownload` helper.
- `client/src/types.ts` is a hand-maintained copy of the API types in `server/src/types.ts`; keep the two in sync.
- Paths sent to the server are resolved to absolute paths there, against the server's working directory.

### Security constraints

The server writes to the host's disk on request, so cross-origin access is locked down: CORS uses an allowlist, non-GET requests with a foreign `Origin` header are rejected with 403, and the `/ws` handshake checks the origin too. Download keys are prevented from escaping the destination folder (`../`). Keep these checks in place when adding endpoints that write to disk.
