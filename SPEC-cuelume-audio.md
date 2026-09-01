# Spec: Cuelume interface and chart sounds

## Objective

Add restrained interaction sounds to the dashboard. Users can disable all sounds from
Preferences. Charts play a short cue only when scrubbing reaches a new discrete value. Sound
must never replace visible or accessible feedback. Creator and stock navigation plays one
short page-transition cue on activation, never on hover.

## Tech stack

- React 19 and TanStack Start
- Cuelume 0.2.2
- Bun tests with jsdom where browser state is required

## Commands

- Install: `bun add cuelume@0.2.2`
- Test: `bun test`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Format check: `bun run fmt:check`
- Build: `bun run build`
- Browser: `bun run dev`

## Project structure

- `src/lib/preferences.tsx`: persisted sound preference
- `src/lib/interface-sounds.ts`: Cuelume setup and scrub deduplication
- `src/components/Preferences.tsx`: sound switch
- Existing chart components: explicit scrub and marker adoption
- Tests stay beside the code they cover

## Code style

```ts
const scrub = createScrubSoundController();
scrub.move(point.date);
scrub.reset();
```

Use existing React, TypeScript, Base UI, and test conventions. Do not add a second settings
store or a general event system.

## Testing strategy

- Unit-test persisted defaults and stored values.
- Unit-test point deduplication, throttling, and reset behavior.
- Assert sound controls and chart hooks in focused component tests where practical.
- Run the full repository gates.
- Verify the preference and requested charts in a real browser with no new console errors
  compared with the unchanged `main` branch.

## Boundaries

- Always: use a low global volume, deduplicate point changes, throttle scrub cues, and preserve
  keyboard behavior.
- Ask first: change the default enabled state, add a volume slider, or add sounds outside the
  requested interaction set.
- Never: play sounds during passive animation, depend on audio for meaning, or write audio state
  outside the existing Preferences system.

## Success criteria

- Interface sounds default to enabled at volume 0.25.
- Preferences has a persistent "Interface sounds" switch.
- Disabling the switch silences future cues.
- Creator performance versus SPY, call activity, candlestick data, creator call markers, and call
  timeline emit at most one cue per new scrub value.
- Creator and stock navigation emits one `page` cue on click or keyboard activation.
- Rapid scrub movement is rate-limited and does not queue audio.
- Server rendering remains safe.
- Tests, typecheck, lint, format check, build, React Doctor, and browser checks pass without new
  feature-specific errors.
