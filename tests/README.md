# Offline regression tests

From the repository root, run:

```sh
node tests/run.js
```

Plain Node.js (18+), no dependencies, credentials, or network. A failure exits nonzero.
The harness parses the inline HTML script into a VM, stubs DOM/window/Plotly,
localStorage, clocks and fetch, and suppresses only the initial data load. Server
code is evaluated separately after removing its export keyword. Unexpected fetches
fail. Fixture data is defined in `fixtures.js`.

The analytic scenario fixture uses equal OI, IV and expiry at two different strikes.
Gamma equality occurs at `sqrt(Kcall * Kput) * exp(-(r + sigma²/2) * T)`.
A second fixture checks two roots. Tests also cover missing straddle legs, walls,
P/C, null Greeks and coverage, IV weights, nearest strikes, metric labels, scoped
swing values, cooldown, server dedup/errors/timeout, timestamps, demo expirations,
baselines, stale age, escaping, and out-of-order chain/intraday responses.

Scenario roots are numerical sign changes on a 0.05%-spot base grid spanning ±20%
(including ±15%), augmented around narrow expiry peaks and bisected. Identically
zero profiles have no isolated flip. IV is held fixed; date-only expirations assume
16:00 America/New_York (DST-aware), since settlement session metadata is unavailable.
This is not a proof that arbitrarily narrow paired roots cannot lie between samples.
Missing-IV scenario coverage is disclosed separately from provider-Greek coverage.
WEEK means today plus the next six calendar dates in New York.

No visual browser or live upstream validation is performed by this harness. CDN SRI
hashes remain a documented follow-up requiring network access.
