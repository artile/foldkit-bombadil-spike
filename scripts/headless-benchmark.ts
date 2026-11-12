import { Arbitrary, Effect, Schema } from 'effect'
import fc from 'fast-check'
import { Action } from '../src/actions'
import { Headless, runChoices } from '../src/headless'
import { Mutant } from '../src/model'
import { trace } from '../spec/trace'
import { writeToml } from './data'

const choiceSchema = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65535 }))
const choices = Arbitrary.array(Arbitrary.schema(choiceSchema), { minLength: 0, maxLength: 80 })
const fastChoices = fc.array(fc.integer({ min: 0, max: 65535 }), { minLength: 0, maxLength: 80 })
export const headlessBench = async (root: string) => {
  for (const engine of ['effect-arbitrary', 'fast-check']) {
    for (const mutant of Mutant.literals) for (const seed of [1001, 1002, 1003, 1004, 1005]) {
      let actions = 0, messages = 0, evaluations = 0
      let first: { ms: number, actions: number, trace: ReadonlyArray<string> } | undefined
      const coverage: Record<string, number> = {}
      const actionCoverage: Record<string, number> = {}
      const start = performance.now()
      const property = (input: ReadonlyArray<number>) => {
        const run = runChoices(mutant, input)
        evaluations++; actions += run.trace.length; messages += run.harness.observer.messages
        for (const [name, count] of Object.entries(run.harness.observer.coverage)) coverage[name] = (coverage[name] ?? 0) + count
        for (const action of run.trace) actionCoverage[action] = (actionCoverage[action] ?? 0) + 1
        const passed = run.harness.observer.violations.length === 0
        if (!passed && !first) first = { ms: performance.now() - start, actions, trace: run.trace }
        return passed
      }
      const result = engine === 'effect-arbitrary'
        ? await Effect.runPromise(Arbitrary.checkEffect(choices, property, { seed, runs: 1000, size: 80, maxShrinks: 1000 }))
        : fc.check(fc.property(fastChoices, property), { seed, numRuns: 1000 })
      const elapsed = performance.now() - start
      const replays: Array<boolean> = []
      const isEffect = '_tag' in result
      const failed = isEffect ? result._tag === 'Falsified' : result.failed
      let afterTrace: ReadonlyArray<string> = []
      let shrinks = 0
      let replayToken: string | undefined
      let initialInput: ReadonlyArray<number> = [], shrunkInput: ReadonlyArray<number> = []
      if (isEffect && result._tag === 'Falsified') {
        initialInput = result.initialInput; shrunkInput = result.shrunkInput; shrinks = result.shrinks; replayToken = result.replay
        afterTrace = runChoices(mutant, result.shrunkInput).trace
        for (let repeat = 0; repeat < 3; repeat++) {
          const replay = await Effect.runPromise(Arbitrary.checkEffect(choices, input => runChoices(mutant, input).harness.observer.violations.length === 0, { replay: result.replay }))
          replays.push(replay._tag === 'Falsified' && JSON.stringify(replay.shrunkInput) === JSON.stringify(result.shrunkInput))
        }
      } else if (!isEffect && result.failed && result.counterexample) {
        initialInput = [] // fast-check exposes its final counterexample, not the initial one here.
        shrunkInput = result.counterexample[0]; shrinks = result.numShrinks
        replayToken = result.counterexamplePath
        afterTrace = runChoices(mutant, shrunkInput).trace
        for (let repeat = 0; repeat < 3; repeat++) {
          const replay = fc.check(fc.property(fastChoices, input => runChoices(mutant, input).harness.observer.violations.length === 0), { seed, path: result.counterexamplePath, numRuns: 1000 })
          replays.push(replay.failed && JSON.stringify(replay.counterexample) === JSON.stringify(result.counterexample))
        }
      }
      await writeToml(`${root}/headless/${engine}-${mutant}-${seed}.toml`, {
        kind: 'discovery', engine, mutant, seed, runs_budget: 1000, maximum_trace_length: 80, elapsed_ms: elapsed,
        evaluations_including_shrink: evaluations, semantic_actions_including_shrink: actions, messages_including_shrink: messages,
        actions_per_second_including_shrink: actions / (elapsed / 1000), status: failed ? 'violation' : 'passed',
        first_violation_ms: first?.ms, first_violation_cumulative_actions: first?.actions,
        shrink_and_return_ms: first ? elapsed - first.ms : undefined, before_actions: first?.trace.length, after_actions: afterTrace.length,
        accepted_shrinks: shrinks, original_trace: first?.trace, shrunk_trace: afterTrace,
        initial_input: initialInput, shrunk_input: shrunkInput, replay_token: replayToken, replay_success: replays,
        trigger_coverage_including_shrink: coverage, action_coverage_including_shrink: actionCoverage,
      })
      console.log(`${engine} ${mutant} seed=${seed}: ${failed ? 'violation' : 'passed'} in ${elapsed.toFixed(1)}ms`)
    }
  }
  // Timed identical semantic trace. No generator or shrinker, no batching claim.
  for (let repeat = 1; repeat <= 5; repeat++) {
    const harness = new Headless('clean')
    const start = performance.now()
    for (const action of trace) harness.act(Schema.decodeUnknownSync(Action)(action))
    const elapsed = performance.now() - start
    await writeToml(`${root}/headless/fixed-trace-${repeat}.toml`, {
      kind: 'fixed-trace', engine: 'headless', repeat, elapsed_ms: elapsed, semantic_actions: trace.length,
      messages: harness.observer.messages, actions_per_second: trace.length / (elapsed / 1000),
      violations: harness.observer.violations, final_model: harness.observer.model, trigger_coverage: harness.observer.coverage,
    })
  }
}
if (import.meta.main) await headlessBench(process.argv[2] ?? 'measurements/run')
