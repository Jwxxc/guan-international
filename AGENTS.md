# GUAN International Edition

This is an independent English/Chinese static web sharing edition. Do not edit or depend on the original GUAN workspace or its applications, private models, research artifacts or personal data.

- Default to English on a new visit; persist language under `guan.international.language.v1`. Language changes are presentation-only and must not remount a live game.
- Use the existing React, strict TypeScript and Vite stack with pnpm and its lockfile. Development binds only to 127.0.0.1.
- Keep engine state immutable. All plays pass validateAction/applyAction. Preserve physical card IDs, rules versions, saved journals and policy identities.
- AI receives only its own PlayerObservation and public information. Never pass hidden hands, full game state or seeds to a policy.
- Keep Casual, Balanced, Balanced Plus, Balanced Pro and DanLM in that display order. DanLM is explicitly unavailable on the static website; never silently replace a saved strategy.
- The published site has no native inference, automatic learning, multiplayer host, account service or analytics. Preserve truthful capability messages.
- Localize display text in src/i18n and at component render boundaries. Do not localize stored actions, protocol IDs, rule labels inside the engine or AI inputs.
- Honor the frozen house rules in docs/RULES_CLASSIC_V1.md; older journals keep their own version.
- Preserve selection, hand grouping, replay isolation and keyboard focus. Drag release never submits a play.
- Public assets must use the configured Vite base path, including dynamically generated joker paths.
- Run pnpm test, pnpm build and the relevant browser tests. Validate the production subpath and actual publicly deployed page before claiming publication works.
- .gitignore is an explicit publication manifest. Never add private model directories, browser saves, personal game archives, local service tokens, research exports or application bundles.
