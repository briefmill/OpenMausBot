# Preserving the custom Team map features

Repository: `briefmill/OpenMausBot`.
Feature branch: `codex/team-map-layout-sync`.
Snapshot tag: `custom/team-map-browser-sync-v0.1.161`.
Source baseline: upstream v0.1.161, commit `c31dd5d101098c81ff9025249caf24e4e172cb4d`.

This branch includes passive live browser monitors using the existing VM monitor UI, owner-device layout synchronization, pointer-drag persistence and expanded-department collision handling. It also contains verification instructions and synthetic screenshots/video. Private workspace screenshots and compiled deployment files are not part of this source PR.

Keep this branch/tag when updating the customized app. Merge newer upstream changes into the customization branch or cherry-pick the feature commits onto the next customization baseline, resolve conflicts, then run the documented browser/map checks before building. Replacing the app with an unmodified upstream binary does not retain custom source changes automatically.

The production deployment wrapper and mailbox/access adapters are separate deployment concerns. Preserve the qualified current wrapper when rebuilding; do not restore the obsolete preload wrapper. See `docs/verification/team-map-layout-sync.md` for the deployment and regression evidence.
