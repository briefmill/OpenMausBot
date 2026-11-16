# Team map layout synchronization

Owner devices save department positions, per-department bot order and the Show screens choice through `/api/team-map/layout`. The server persists these preferences under its existing data directory. Paired owner devices without a user ID share the owner layout; sessions with a user ID use a separate hashed filename. Guests and service-trust loopback callers cannot read or change these preferences.

Updates merge the changed departments rather than replacing the complete layout. A saved device-local arrangement is imported only if no server arrangement exists. The open map refreshes every five seconds while visible. Pan and zoom remain local. Device-local storage remains a fallback, but failed network saves are not yet queued durably across a browser restart.

Verification on 2026-11-16:

- Four isolated HTTP tests pass for persistence, merges, first-import protection, bounds and access denial.
- The real Chrome TeamCanvas fixture passes, including two independent browser profiles that display the same saved department position and hidden-screen preference.
- Browser preview unit/component/service tests pass alongside these route tests: 67 total targeted tests.
- App and server type checks and the custom renderer build pass.

Deployed on 2026-11-16 as Railway deployment `804b0101-da6b-432e-ab86-fb4e77252ad0`, status SUCCESS. Production UI verification found 46 browser tiles and one live browser frame. The owner layout persistence and two-profile continuity checks used isolated fixtures, without moving the live map to test it.

The first deployment used an outdated startup wrapper and was restored to the previous working build. The final candidate preserves the exact qualified production runtime baseline (`0f4bbb77627847d82de415134f0b029c633abf48b0b63680f525a732b92761dd`) and current `main161-boot.mjs` wrapper. Five uniquely matched changes add the browser viewer guard and layout route, leaving existing mailbox and access controls intact. The preserved bundle passed packaged-server startup, restart, proxy, authorization and encrypted-backup checks, plus layout persistence across restart and service-trust denial. The temporary SSH key used to retrieve and verify the qualified runtime was revoked successfully.

Fedora UI and server files were installed with rollback backups. The native Fedora window and a physical Windows device have not been visually verified; connected desktop apps load the updated hosted renderer after reopening.
