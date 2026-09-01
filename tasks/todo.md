# Cuelume audio tasks

- [x] Add preference and root binding.
  - Acceptance: enabled by default, stored switch, volume 0.25.
  - Verify: focused preference and setup tests.
- [x] Add scrub cue controller.
  - Acceptance: new keys tick, duplicates stay silent, rapid changes are throttled, reset works.
  - Verify: focused unit tests.
- [x] Add requested chart cues.
  - Acceptance: performance, activity, candles, creator markers, and timeline use explicit cues.
  - Verify: component tests and browser interaction.
- [x] Run final gates.
  - Acceptance: full suite, typecheck, lint, format, build, React Doctor, and no new browser
    errors compared with unchanged `main`.
  - Result: passed. Existing update-depth and duplicate marker-key errors reproduce on `main`.
