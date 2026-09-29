# International web edition

This is a separate sharing edition of GUAN, with English as the first-visit default and Simplified Chinese selectable on the home screen or in Settings. The original workspace and installed application are not updated.

The language preference uses its own key. Existing engine, AI, journal, exchange and save formats are unchanged. Translation happens at render boundaries: exact messages and parameterized historical labels share a catalog, while IDs and accepted actions retain their original values. React updates text without remounting the game. Choosing a language while paused preserves the physical hand, selection and stored journal.

The static distribution supports Casual, Balanced, Balanced Plus and Balanced Pro in the browser. DanLM, its hints, new DanLM spectator sessions, automatic learning and hosted multiplayer require services this website does not provide. Disabled controls and explanatory text describe those limits. No service or model is started on the original computer by this build.

The public repository uses an explicit allowlist. Private weights, local services, applications, research exports and user records are excluded. Frozen browser compatibility models are retained because legacy strategy descriptors import them. No training or model-strength changes were made.

## Validation

- 158 release regression tests passed across 12 files: rules, deterministic play, persistence, classic exchange/progression, hand arrangements, replay, strategy identities and localization.
- All 18 Chromium and WebKit checks passed. They cover first-visit English, remembered Chinese, language switching with unchanged paused cards/selection/journals, accepted play and restore, tribute/return/resistance, reaching A, failing to clear A, winning a match and replay.
- Layout checks exercise single row, double row and columns at 1280×720 and 1024×768.
- The production build uses /guan-international/ as the base path. Assets and workers are checked on that subpath and on the deployed site.

No claim is made about DanLM strength or new AI evaluation. The site gives each visitor an independent local game, not a shared online table.
