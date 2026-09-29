# Local open-source workspace

Work only in this sibling export. Never modify the original internal repository,
copy its runtime credentials/data/private Git history, or reconnect its services.

The application stores records in LOCAL_DATA_DIR/workspace.json and media in
LOCAL_DATA_DIR/media. Do not introduce database engines, cloud object storage, cloud identity,
payments, telemetry, or remote business API/proxy dependencies. Model
suppliers are called directly using credentials owned by the local user.

Read relevant Next.js 16 guides in node_modules/next/dist/docs before framework
changes. Route/page modules must export only fields supported by Next.js.
Use four spaces, no semicolons and single quotes.

src/lib/prisma.ts is a typed compatibility facade over the JSON file store.
prisma/schema.prisma describes record shapes/types only; migration history is
retained but inactive. Never instantiate PrismaClient or run database migrations.
Preserve atomic file writes, locking, transaction rollback and local media path
checks. Model credentials belong only in ignored environment files or external
credential files. UI configuration stores preferences, never secrets.

Use npm ci, npm run dev (loopback only), npm run build, npm run lint,
npm run typecheck and npm test. FFmpeg/ffprobe must be installed. Tests must use
OS temporary data directories and mocked model responses; never spend on real
provider calls without an explicit request. Keep all test media and user data
out of Git. Do not remove existing dependencies/caches as routine troubleshooting.

Sync with scripts/sync-from-internal.py. The private .git/open-source-sync.json
allowlist protects local runtime changes. Merge protected files manually; never
restore cloud behavior. Keep documentation, lockfiles and historical migrations
unless removal is independently justified. Report actual checks and limitations.
