# Frozen pre-v0.4 strategy

`policy.ts` and `evaluation.ts` are the actual strategy used by the controller and hints before v0.4. Only relative imports were adjusted for this directory. The original entry points remain untouched for compatibility.

Use `chooseAiAction` and `rankAiMoves` from `./policy`, supplying the same public `PlayerObservation`, shared `getLegalMoves` output, and independent AI RNG used by the original. This baseline has no artificial budget restriction and its candidates or scoring weights have not been weakened.

`manifest.json` records the original and frozen SHA-256 values and shared rule/candidate dependency hashes. The implementation fingerprint describes these frozen source files, not a strength rating. A future shared-rule correctness change must be documented for both policies and must not silently retain an outdated fingerprint claim.

During v0.4 integration, the existing `getResult` function in the shared reducer was exported so the observation adapter could reuse the authoritative settlement definition. Its body was not changed. The equivalence test permits only that exact `export` addition when checking the historical reducer hash, and writes current dependency hashes separately to `artifacts/ai-v0.4/baseline/shared-dependencies-current.json`; the original manifest remains untouched.
