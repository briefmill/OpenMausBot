# Team map layout synchronization

Owner devices save department positions, per-department bot order and the Show screens choice through `/api/team-map/layout`. The server persists these preferences under its existing data directory. Paired owner devices without a user ID share the owner layout; sessions with a user ID use a separate hashed filename. Guests and service-trust loopback callers cannot read or change these preferences.

Updates merge the changed departments rather than replacing the complete layout. A saved device-local arrangement is imported only if no server arrangement exists. The open map refreshes every five seconds while visible. Pan and zoom remain local. Device-local storage remains a fallback, but failed network saves are not yet queued durably across a browser restart.

Verification on 2026-11-16:

- Four isolated HTTP tests pass for persistence, merges, first-import protection, bounds and access denial.
- The real Chrome TeamCanvas fixture passes, including two independent browser profiles that display the same saved department position and hidden-screen preference.
- Browser preview unit/component/service tests pass alongside these route tests: 67 total targeted tests.
- App and server type checks and the custom renderer build pass.

Not yet deployed. The browser-preview deployment discovered an existing Front Desk NODE_OPTIONS preload that checks the old server bundle hash and rejects a rebuilt server. The last working deployment was restored successfully as `b63942e1-61db-463a-b8bd-6d5ce66cf45c`. Preserve and requalify that runtime patch before deploying either feature. Do not disable its guard.
