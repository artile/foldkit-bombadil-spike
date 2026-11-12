# Foldkit × Bombadil: runtime Messages, DOM actions, and headless properties

A small, public experiment: can [Bombadil custom actions](https://antithesishq.github.io/bombadil/browser/3.5-custom-actions.html) send Messages into a **real [Foldkit](https://github.com/foldkit/foldkit) browser runtime**?

Yes. The test bridge uses Foldkit 0.170.0's public embedding Port API:

```ts
const inbound = Port.inbound(Message)
const program = Runtime.makeElement({
  // Model, init, pure update, pure view, container …
  ports: { inbound: { testMessage: inbound } },
  subscriptions: Subscription.make<Model, Message>()(() => ({
    hostMessage: Port.subscriptionEntry(inbound, message => message),
  })),
})
const handle = Runtime.embed(program)
handle.ports.testMessage.send(Message.ClickedRefresh())
```

The bridge never calls `update`. Foldkit's subscription feeds the runtime, the runtime executes Commands, their replies enter the same Message loop, and Foldkit patches the browser view. See [host.ts](src/host.ts), [command.ts](src/command.ts), and the [custom-action specification](spec/direct.ts).

The separate headless interpreter **does** call pure `update`. That is a different test layer, labelled as such throughout.

[Measured results and limits](report/RESULTS.md) · [Raw measurements](measurements/2026-11-12-m1max/) · [Generated summary](measurements/2026-11-12-m1max/summary.toml)

## Try it

Requirements: [mise](https://mise.jdx.dev/), a supported Bombadil platform (macOS arm64, Linux x64/arm64), and Git. The recorded run used macOS arm64. No account, secret, external API or database is needed. Package installation and Bombadil's initial Chrome setup can need Internet access; fixture traffic stays on loopback.

```sh
mise install
mise exec -- bun install --frozen-lockfile
mise run check
mise exec -- bun run start
```

Open `http://127.0.0.1:4173/`. Type a search or choose a preset. Requests wait until you advance the logical clock with **delay**, then choose an oldest/newest success or failure. There is no real request to a vendor or wall-clock timer controlling the fixture.

`/production` loads a separate build with no window bridge, inbound test subscription or transport-control panel. It is still a fixture without a real backend; use `/` for this experiment. A new page/document resets Model, pending Commands, logical time and counters.

Pinned packages: `foldkit=0.170.0`, `@foldkit/ui=0.170.0`, `effect=4.1.0`, `@effect/platform-browser=4.1.0`, `@antithesishq/bombadil=0.7.10`, `fast-check=4.8.0`. `bun.lock` includes exact resolutions and integrity hashes. Foldkit's installed peers require Effect/platform-browser `~4.1.0`; those pins match. No `@effect/vitest` dependency is used; Story/Scene tests run with Bun's test runner.

## Run Bombadil

With the fixture server running, on macOS arm64:

```sh
mise exec -- node_modules/@antithesishq/bombadil/binaries/bombadil-darwin-arm64 browser test \
  http://127.0.0.1:4173/ spec/dom.ts --headless --time-limit 15s \
  --exit-on-violation --output-path .scratch/my-dom-run

mise exec -- node_modules/@antithesishq/bombadil/binaries/bombadil-darwin-arm64 browser test \
  http://127.0.0.1:4173/ spec/direct.ts --headless --time-limit 15s \
  --exit-on-violation --output-path .scratch/my-direct-run
```

Use the corresponding `bombadil-linux-x64` or `bombadil-linux-arm64` binary on Linux. The benchmark chooses it automatically. The supplied npm macOS binary matches the official 0.7.10 binary used for this run: SHA-256 `3d7866e2e8356390a0f2560853e3c775839f8c8ff648c9552c0105f7f78d1d72`. Binaries and Chrome are not committed.

The DOM specification produces Bombadil's built-in `Click` actions with element fingerprints and coordinates. It does not simulate clicks inside a custom action. Both browser paths choose from the same currently valid semantic actions. Search benchmarks use the presets all/a/b; free-text typing is covered by a Foldkit Scene test.

## Reproduce the measurements

Stop the manual server first. The runner requires a clean Git worktree, starts its own server at `127.0.0.1:4173`, and closes it in `finally`. Choose a fresh output directory; it refuses to overwrite a recorded run. Expect several minutes of serial Chrome runs.

```sh
mise exec -- bun run build
mise exec -- bun scripts/benchmark.ts measurements/my-fresh-run
mise exec -- bun scripts/report.ts measurements/my-fresh-run
```

You can override `BOMBADIL` with an absolute path to another **0.7.10** binary. Its version and SHA-256 are recorded. The recorded sample's source commit appears in `environment.toml`; later commits add the report, evidence, test guards a process-log capture fix and a Dialog panel CSS repair. Timing/discovery data stays pinned to its measured commit.

The original 15-second fixed-trace series includes incomplete attempts. They stay in the evidence. A separate, predeclared follow-up repeats **all ten** fixed browser comparisons with a 30-second limit, then combines that series with the original discovery/headless data:

```sh
mise exec -- bun scripts/fixed-benchmark.ts measurements/my-fixed30-run
mise exec -- bun scripts/report.ts measurements/my-fresh-run measurements/my-fixed30-run
mise exec -- bun scripts/validate-evidence.ts measurements/my-fresh-run measurements/my-fixed30-run
```

The runner performs:

1. Effect **native `Arbitrary`** checks, then a separate fast-check baseline: 1,000 cases for each of five fixed seeds, clean plus all mutants. Generated integers select from the current valid action set. Commands/replies remain request-matched. Shrink and replay records include semantic traces.
2. Five serial 15-second Bombadil discovery runs per browser path and variant. DOM/direct order alternates each repeat. Bombadil 0.7.10 exposes no seed option, so none is invented.
3. Five runs of the **same 60-action trace**, with every browser action issued and observed separately. The `traceComplete` property is an intentional completion marker, not an app defect. Each path reaches the same final Model with 40 application Messages and 20 FetchPage Commands.
4. Three replays per detected browser representative, plus a bounded experimental Bombadil shrink for one stale-response trace per browser path and three replays of each produced shrunk trace.

Headless only:

```sh
mise exec -- bun scripts/headless-benchmark.ts .scratch/headless-run
```

Rebuild the checked-in report without running Chrome:

```sh
mise exec -- bun scripts/report.ts measurements/2026-11-12-m1max measurements/2026-11-12-fixed30
```

Original Bombadil `trace.jsonl` files are unchanged. Screenshots, downloads and profiles are omitted to keep the repository small; image references in JSONL therefore point to files that are not shipped. Replay reads the action trace. For screenshots, run a fresh test and inspect its output before removing images.

```sh
mise exec -- node_modules/@antithesishq/bombadil/binaries/bombadil-darwin-arm64 browser test \
  'http://127.0.0.1:4173/?mutant=stale' spec/direct.ts --headless \
  --reproduce measurements/2026-11-12-m1max/browser/discovery-direct-stale-1 \
  --output-path .scratch/replay
```

The final checkout also fixes a transparent Dialog panel found during visual QA. The historical benchmark commits remain explicit. To repeat the deterministic final-layout check (both paths, clean plus recovery mutant):

```sh
mise exec -- bun scripts/recovery-check.ts measurements/my-final-recovery
```

## What is checked

The app is a generic 12-item searchable, paginated catalogue with a real Foldkit Dialog. `update` is shared by every path. `FetchPage` is a real Foldkit Command. In the browser, its Effect waits on an injected `Transport` service; success/failure controls resume that Command's own continuation. The direct bridge accepts user Messages only and rejects forged reply or Dialog lifecycle Messages.

The test-only transition observer checks Model/Command rules independently of the DOM: replies belong to pending requests; stale replies leave the current result alone; the active pending request is not issued twice; error dismissal clears the error and closes the dialog; successful page data matches the request. It latches violations after each observed runtime update. Bombadil reads the latch and settled snapshots, rather than claiming its extractors see every intermediate render. Trigger and action counters expose which rules actually ran.

The headless interpreter records Command descriptors and synthesizes their valid matching replies. It resolves native Dialog Commands as successful test outcomes. It does not execute DOM, focus, browser Mount cleanup or rendering effects. These platform assumptions are explicit in [headless.ts](src/headless.ts).

| Variant | Planted change | Expected detector |
|---|---|---|
| `clean` | No defect | No violation |
| `stale` | Accept a superseded success response | DOM, direct, headless |
| `duplicate` | Remove the active-pending request guard | DOM, direct, headless |
| `recovery` | Dismiss the Dialog but keep the failure | DOM, direct, headless |
| `wiring` | Next page's `OnClick` sends the current page | DOM only |

Select a variant with `/?mutant=stale`, and so on. Mutants stay in the fixture source so anyone can rerun the same experiment. A wiring observer compares a page button's declared intent with its resulting Foldkit Message. That control demonstrates the direct/headless blind spot; it does not validate all input wiring.

## How to read the numbers

Keep discovery separate from throughput. Bombadil explores a browser using coverage feedback; Effect Arbitrary and fast-check generate and shrink valid action traces with different distributions. Their random discovery numbers are not equivalent work. The fixed trace holds the semantic work constant, while the executed layers still differ.

Browser useful time includes Bombadil instrumentation, state extraction, screenshots, browser input, rendering and Command/runtime work. Direct actions also wait for bridge acknowledgement and view convergence. Warm headless timing includes pure update, its Command interpreter and the same model oracle. It excludes browser startup and all browser/platform behavior. It is useful for deciding which checks belong at which layer, not for a blanket “faster/better” claim.

The bridge waits for the rendered Model snapshot to converge; this does not prove that every visible label or list is correct. Scene tests and the wiring control cover selected UI behavior.

No Chrome-tree CPU/RSS, energy, dollar cost or authoring-time claims are made. Hegel was not evaluated. See the report for repeat counts, ranges, detection denominators, trigger coverage, shrink results, replay failures and limits.

## Sources

The app and all catalogue data are new generic fixture code. No private product code, text, credentials, org/customer data or vendor API is included.

API shapes were checked against the Foldkit `foldkit@0.170.0` reference and its public examples/guides, then against installed declarations:

- [Foldkit embedding example](https://github.com/foldkit/foldkit/tree/foldkit%400.170.0/examples/embedding)
- [Foldkit generate-program guide](https://github.com/foldkit/foldkit/tree/foldkit%400.170.0/skills/generate-program)
- [Bombadil custom actions](https://antithesishq.github.io/bombadil/browser/3.5-custom-actions.html)
- [Bombadil reproduction](https://antithesishq.github.io/bombadil/browser/4.1-reproducing-violations.html)

MIT licensed. Contributions that add a new test layer should keep its guarantees and timing scope explicit.
