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

Phase 2 adds 11 deterministic cases (33 total): split call/put cancellation,
expiry gross gamma and scoped shares, wall/straddle overlays and all scenario
roots, DST-aware band expiry, bounded/deduplicated daily snapshot history and
simulation isolation, OI-weighted IV term/skew missingness, analytic Black-Scholes
vanna/charm comparisons, exclusion behavior, explainer disclosures, and empty-view
rendering. The original 22 tests remain unchanged.

History stores only observed chain timestamps under `gexmap_intraday_v1_`, with
separate symbol/live/simulated keys, the current New York date and at most 288
entries per key. Refreshing cached data does not create a new observation. Gaps
longer than ten minutes break the line. No collection occurs while closed.

Modeled sensitivities use central finite differences of Black-Scholes delta,
checked against half steps. Results use signed OI × 100, in delta shares per
+1 IV percentage point (vanna) or elapsed calendar day (charm). Contracts with
less than one hour remaining, missing inputs or unstable estimates are excluded.
Empty coverage produces n/a, not zero. Rates are 4.3%, dividend yield zero.

Offline verification:

```sh
for f in api/*.js; do cp "$f" /tmp/gexmap-check.mjs; node --check /tmp/gexmap-check.mjs || exit; done
node tests/run.js  # also compiles the inline script with vm.Script
git diff --check
```

Responsive source audit: new chart containers are fluid, grid children can shrink,
IV and price/history panels stack below `lg`, and expiry tables scroll; Trinity uses the original fluid three-panel chart grid.
No browser executable is installed in this environment, so rendered desktop/mobile
layout and real Plotly interactions still need a browser check. No network was used.

Trinity restoration adds 6 cases (39 total), retaining all prior 33 tests: original
bar colors, inclusive ±1.5% strike window and 15-strike cap, fixture dollar GEX
including null Greeks, computed regime and LIVE/SIMULATED provenance, cached-only
rendering and Plotly layout, missing coverage/errors, loading and response races.
