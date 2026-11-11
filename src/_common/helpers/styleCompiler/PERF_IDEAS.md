# Style Compiler Static Performance Ideas

Benchmarks use the static suites only:

```sh
node --expose-gc node_modules/vitest/vitest.mjs bench src/_common/helpers/styleCompiler/styleCompiler.bench.ts --logHeapUsage -t "style compiler static"
```

The numbers are noisy, so every decision is based on the largest `5k elements / 200 sections`
case first, then checked against the smaller cases.

## Baseline

Status: measured.

| Case | Static counting | Static string |
| --- | ---: | ---: |
| 250 elements / 25 sections | 92.37 ms | 91.51 ms |
| 1k elements / 50 sections | 363.58 ms | 349.61 ms |
| 5k elements / 200 sections | 1,997.61 ms | 2,040.15 ms |

## Ideas

### 1. Cache declaration resolvers by target kind

Hypothesis: `getDeclarationResolvers(target)` recreates arrays and closure functions for every
target/state/breakpoint. Since resolvers only depend on `target.kind`, module-level cached arrays
should remove repeated allocation.

Result:

| Case | Static counting | Static string |
| --- | ---: | ---: |
| 250 elements / 25 sections | 90.68 ms (-1.8%) | 89.23 ms (-2.5%) |
| 1k elements / 50 sections | 333.36 ms (-8.3%) | 348.81 ms (-0.2%) |
| 5k elements / 200 sections | 1,866.66 ms (-6.6%) | 1,871.67 ms (-8.3%) |

Status: implemented.
Decision: keep.

### 2. Static cleanup-light compiler path

Hypothesis: static one-shot compilation pays for the same nested cleanup graph as the reactive path.
A static-specific path can compile directly and keep only rule handles for final `stop()`, avoiding
per-declaration cleanup closures.

Result, measured after Idea 1 was kept:

| Case | Static counting | Static string |
| --- | ---: | ---: |
| 250 elements / 25 sections | 81.40 ms (-10.2%) | 75.86 ms (-15.0%) |
| 1k elements / 50 sections | 298.51 ms (-10.5%) | 302.18 ms (-13.4%) |
| 5k elements / 200 sections | 1,432.50 ms (-23.3%) | 1,499.65 ms (-19.9%) |

Status: implemented.
Decision: keep.

### 3. Keep string stylesheet insertion order instead of sorting on result

Hypothesis: static compilation already inserts rules in deterministic cascade order. Keeping an
ordered entry list can avoid `Array.sort()` during CSS serialization.

Result, measured after Ideas 1 and 2:

| Case | Static counting | Static string | Memory note |
| --- | ---: | ---: | --- |
| 250 elements / 25 sections | 73.58 ms (-9.6%) | 74.53 ms (-1.7%) | neutral |
| 1k elements / 50 sections | 278.40 ms (-6.7%) | 284.76 ms (-5.8%) | slightly higher in string case |
| 5k elements / 200 sections | 1,378.73 ms (-3.8%) | 1,484.13 ms (-1.0%) | peak heap grew from 195.88 MB to 264.29 MB in the string case |

Status: reverted.
Decision: drop. The 5k string-time win is too small for the extra memory and adapter complexity.

### 4. Avoid repeated component configuration reads per declaration

Hypothesis: declaration resolvers repeatedly call `reader.componentConfiguration(target)` and
`ignoredStyleProperties()`. Caching the configuration result per target/state/breakpoint should
avoid repeated reader work.

Result, measured after Ideas 1 and 2 were kept:

| Case | Static counting | Static string |
| --- | ---: | ---: |
| 250 elements / 25 sections | 78.66 ms (-3.4%) | 82.12 ms (+8.3%) |
| 1k elements / 50 sections | 286.87 ms (-3.9%) | 302.86 ms (+0.2%) |
| 5k elements / 200 sections | 1,407.88 ms (-1.7%) | 1,468.15 ms (-2.1%) |

Status: implemented.
Decision: keep. The large static case improves and sampled memory is lower; the 250 string loss is treated as small-case noise.

### 5. Resolve slot style maps once per state/breakpoint

Hypothesis: each declaration resolves its property independently through class/subclass/source
precedence. The first step is to precompute shared slot context once per state/breakpoint: base
state, state reader, and class ids.

Result, measured after Ideas 1, 2, and 4 were kept:

| Case | Static counting | Static string |
| --- | ---: | ---: |
| 250 elements / 25 sections | 76.37 ms (-2.9%) | 69.06 ms (-15.9%) |
| 1k elements / 50 sections | 267.56 ms (-6.7%) | 278.64 ms (-8.0%) |
| 5k elements / 200 sections | 1,347.86 ms (-4.3%) | 1,356.62 ms (-7.6%) |

Status: refactored.
Decision: keep the shared context, but keep it slot-only. Normal declarations no longer resolve
inherited breakpoints or base-state values in JavaScript; CSS handles that cascade through rule order.

### 6. Skip empty static rule handles

Hypothesis: static compilation inserts a rule handle for every target/state/breakpoint before it
knows whether any declaration will be emitted. Delaying `insertRule` until the first valid
declaration should avoid adapter handles for empty rules.

Result, measured after Ideas 1, 2, 4, and 5 were kept:

| Case | Static counting | Static string |
| --- | ---: | ---: |
| 250 elements / 25 sections | 68.72 ms (-10.0%) | 74.61 ms (+8.0%) |
| 1k elements / 50 sections | 254.20 ms (-5.0%) | 268.89 ms (-3.5%) |
| 5k elements / 200 sections | 1,300.33 ms (-3.5%) | 1,318.02 ms (-2.8%) |

Status: implemented.
Decision: keep. The large static case improves and rule-handle memory stays lower; the small string case is noisy.

### 7. Cache class readers inside cascade context

Hypothesis: cascade resolution repeatedly calls `reader.styleClass(classId)`,
`classReader.style().state('base')`, and `classReader.subClass(subClassId)` for every property. Caching
those readers/states once per state/breakpoint scope should reduce repeated reader allocation.

Result, measured after Ideas 1, 2, 4, 5, and 6 were kept:

| Case | Static counting | Static string |
| --- | ---: | ---: |
| 250 elements / 25 sections | 76.09 ms (+10.7%) | 76.59 ms (+2.7%) |
| 1k elements / 50 sections | 282.74 ms (+11.2%) | 295.31 ms (+9.8%) |
| 5k elements / 200 sections | 1,428.25 ms (+9.8%) | 1,481.77 ms (+12.4%) |

Status: reverted.
Decision: drop. The extra `Map` lookups/allocation are more expensive than repeated reader calls.

### 8. Cache serialized CSS property names

Hypothesis: generated declarations reuse the same property names many times. Caching
`serializeCssProperty(property)` should avoid repeated trim/camel-case normalization/regex
validation for static compilation.

Result, measured after Ideas 1, 2, 4, 5, and 6 were kept:

| Case | Static counting | Static string |
| --- | ---: | ---: |
| 250 elements / 25 sections | 71.04 ms (+3.4%) | 75.54 ms (+1.2%) |
| 1k elements / 50 sections | 256.02 ms (+0.7%) | 265.97 ms (-1.1%) |
| 5k elements / 200 sections | 1,310.95 ms (+0.8%) | 1,389.88 ms (+5.5%) |

Status: reverted.
Decision: drop. The cache does not pay for itself on the large static string case.

### 9. Avoid `Array.filter` in declaration resolver normalization

Hypothesis: every declaration resolver normalizes nullable declaration arrays with
`.filter(Boolean)`. Replacing it with a small loop should reduce callback/allocation overhead in
the hot declaration path.

Result, measured after Ideas 1, 2, 4, 5, and 6 were kept:

| Case | Static counting | Static string |
| --- | ---: | ---: |
| 250 elements / 25 sections | 88.56 ms (+28.9%) | 88.26 ms (+18.3%) |
| 1k elements / 50 sections | 308.16 ms (+21.2%) | 359.96 ms (+33.9%) |
| 5k elements / 200 sections | 1,281.59 ms (-1.4%) | 1,537.11 ms (+16.6%) |

Status: reverted.
Decision: drop. The hand-written path hurts the static string case substantially.

### 10. Avoid element UID clone when there are no library component roots

Hypothesis: compilation always clones `elementUids` and builds a `Set` before handling library
component root elements. When the compile scope has no library components, static compilation can
iterate the original UID list directly.

Result, measured after Ideas 1, 2, 4, 5, and 6 were kept:

| Case | Static counting | Static string |
| --- | ---: | ---: |
| 250 elements / 25 sections | 96.55 ms (+40.5%) | 99.09 ms (+32.8%) |
| 1k elements / 50 sections | 318.38 ms (+25.2%) | 353.03 ms (+31.3%) |
| 5k elements / 200 sections | 1,332.73 ms (+2.5%) | 1,479.68 ms (+12.3%) |

Status: reverted.
Decision: drop. The helper/branch version is slower than the simple inline clone/set path.

### 11. Serialize declaration maps without spread/map arrays

Hypothesis: string output spends time allocating arrays in `serializeDeclarations`. A direct loop
should reduce string serialization overhead.

Result, measured after Ideas 1, 2, 4, 5, and 6 were kept:

| Case | Static counting | Static string |
| --- | ---: | ---: |
| 250 elements / 25 sections | 92.08 ms (+34.0%) | 90.92 ms (+21.9%) |
| 1k elements / 50 sections | 349.66 ms (+37.6%) | 361.18 ms (+34.3%) |
| 5k elements / 200 sections | 1,535.93 ms (+18.1%) | 1,716.99 ms (+30.3%) |

Status: reverted.
Decision: drop. V8 handles the array/map/join version better than incremental string concatenation here.

## Final Kept Result

Measured after reverting the losing experiments and keeping Ideas 1, 2, 4, 5, and 6.

| Case | Baseline static counting | Final static counting | Baseline static string | Final static string |
| --- | ---: | ---: | ---: | ---: |
| 250 elements / 25 sections | 92.37 ms | 75.86 ms (-17.9%) | 91.51 ms | 80.00 ms (-12.6%) |
| 1k elements / 50 sections | 363.58 ms | 289.38 ms (-20.4%) | 349.61 ms | 299.95 ms (-14.2%) |
| 5k elements / 200 sections | 1,997.61 ms | 1,452.58 ms (-27.3%) | 2,040.15 ms | 1,547.40 ms (-24.2%) |

Final decision: keep the compiler-internal optimizations above. I do not have another local,
low-risk static hot path idea left that can be benchmarked in isolation without changing the public
reader API.

## Reactive Scope Experiments

These benchmarks use:

```sh
node --expose-gc node_modules/vitest/vitest.mjs bench src/_common/helpers/styleCompiler/styleCompiler.bench.ts --logHeapUsage -t "full reactive initial compile|reactive property change"
```

### Baseline

Measured after the static optimizations above, before changing the reactive scope tree.

| Case | Initial compile | Property change |
| --- | ---: | ---: |
| 250 elements / 25 sections | 1,802.13 ms | 0.1448 ms |
| 1k elements / 50 sections | 7,473.03 ms | 0.1556 ms |

### 12. Move target creation into target scope and remove the state scope

Hypothesis: target selector reads should be tracked by target-level effects, not the root
stylesheet effect. The state effect mostly loops breakpoints and can be merged into the target
effect while keeping breakpoint/rule and declaration effects fine-grained.

Result:

| Case | Initial compile | Property change |
| --- | ---: | ---: |
| 250 elements / 25 sections | 1,718.00 ms (-4.7%) | 0.1456 ms (+0.6%) |
| 1k elements / 50 sections | 6,960.50 ms (-6.9%) | 0.1709 ms (+9.8%) |

Status: implemented.
Decision: keep. Initial compile improves on both sizes. Property-change numbers stay
sub-millisecond and the 1k regression is small in absolute terms with a noisy sample.

Retry after the machine load settled:

| Variant | 250 initial | 250 property | 1k initial | 1k property |
| --- | ---: | ---: | ---: | ---: |
| Idea 12 | 1,753.66 ms | 0.1548 ms | 7,303.01 ms | 0.1576 ms |
| Target-scope only, state scope restored | 1,909.81 ms | 0.1560 ms | 7,913.03 ms | 0.1505 ms |

The 1k initial compile still has high RME, but both initial-compile sizes favor removing the state
scope. Property changes are effectively equivalent in absolute terms.

### 13. Remove the custom CSS key-collection scope

Hypothesis: collecting custom CSS keys directly in the breakpoint/rule scope can remove one effect
layer per rule while preserving per-custom-property effects.

Result:

| Case | Initial compile | Property change |
| --- | ---: | ---: |
| 250 elements / 25 sections | 1,726.92 ms (-4.2%) | 0.1490 ms (+2.9%) |
| 1k elements / 50 sections | 6,916.30 ms (-7.4%) | 0.1727 ms (+11.0%) |

Status: reverted.
Decision: drop. The 1k initial compile is only slightly better than Idea 12, the 250 case is worse,
property updates are worse, and custom CSS key changes would invalidate the whole rule instead of
only the custom CSS subtree.

### 14. Remove the static-specific compiler path

Hypothesis: the static-specific `compileStaticScope`/`compileStaticTarget` path may not be worth the
extra code if the generic scope path is close enough when backed by `staticStyleScope`.

Result, measured by temporarily routing `staticStyleScope` through the generic reactive compiler
path:

| Case | Current static counting | Generic static counting | Current static string | Generic static string |
| --- | ---: | ---: | ---: | ---: |
| 250 elements / 25 sections | 81.92 ms | 92.29 ms (+12.7%) | 79.12 ms | 94.01 ms (+18.8%) |
| 1k elements / 50 sections | 299.97 ms | 382.01 ms (+27.4%) | 314.91 ms | 383.22 ms (+21.7%) |
| 5k elements / 200 sections | 1,472.91 ms | 1,936.66 ms (+31.5%) | 1,604.59 ms | 1,979.36 ms (+23.4%) |

Status: reverted.
Decision: drop. There is no tested break-even point; even the 250-element case is slower, and the
large-page regression is too high for the simplification.

### 15. Target chunk scopes with insertion-order rules

Hypothesis: the reactive graph can be simpler if one target chunk owns all rules for one rendered
surface. A target-list scope reconciles target scopes by key; each target scope disposes all of its
rules and reinserts the chunk when any style data it reads changes. Because selectors are
target-specific, cross-target order is not significant today. This also removes numeric rule-order
metadata and lets stylesheet adapters serialize active rules in insertion order.

Result:

| Case | Static counting | Static string |
| --- | ---: | ---: |
| 250 elements / 25 sections | 36.38 ms | 36.57 ms |
| 1k elements / 50 sections | 133.11 ms | 131.41 ms |
| 5k elements / 200 sections | 621.58 ms | 691.80 ms |

| Case | Initial compile | Property change | Class change | Reorder | Add element | Remove element |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 250 elements / 25 sections | 575.72 ms | 2.1233 ms | 1.1503 ms | 0.4734 ms | 2.2977 ms | 0.1559 ms |
| 1k elements / 50 sections | 2,266.64 ms | 2.1110 ms | 1.1420 ms | 1.4075 ms | 2.9993 ms | 0.4109 ms |

Memory samples:

| Case | Peak initial heap | Peak initial RSS | Peak property heap | Peak add heap | Peak remove heap |
| --- | ---: | ---: | ---: | ---: | ---: |
| 250 elements / 25 sections | 124.64 MB | 342.61 MB | 171.68 MB | 59.49 MB | 110.28 MB |
| 1k elements / 50 sections | 357.66 MB | 448.52 MB | 136.05 MB | 125.97 MB | 137.05 MB |

Status: implemented.
Decision: keep. Initial compile and static output get much faster, add/remove/reorder no longer
force every existing target scope to rebuild, and the adapter contract is simpler. The tradeoff is
intentional: a single property change reruns the whole target chunk, so it moves from
sub-millisecond fine-grained updates to roughly 2 ms in the counting adapter. The structural-update
samples have high RME because those benches run very few iterations, but they are no longer full
page rebuilds.

### 16. Runtime-level effects with scope run/stop

Hypothesis: the reactivity API is clearer if the runtime exposes `effect()` and scopes only expose
`run()`/`stop()`. Vue can then use `effectScope()` and `watchEffect` directly, while the static
runtime keeps a tiny active-scope stack for one-shot publisher compilation.

Result:

| Case | Static counting | Static string |
| --- | ---: | ---: |
| 250 elements / 25 sections | 35.66 ms | 34.67 ms |
| 1k elements / 50 sections | 129.51 ms | 136.64 ms |
| 5k elements / 200 sections | 620.04 ms | 696.61 ms |

| Case | Initial compile | Property change | Class change | Reorder | Add element | Remove element |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 250 elements / 25 sections | 577.92 ms | 2.1149 ms | 1.1505 ms | 0.4556 ms | 2.3688 ms | 0.1705 ms |
| 1k elements / 50 sections | 2,226.13 ms | 2.1162 ms | 1.1328 ms | 1.4733 ms | 2.7177 ms | 0.2900 ms |

Memory samples:

| Case | Peak initial heap | Peak initial RSS | Peak property heap | Peak add heap | Peak remove heap |
| --- | ---: | ---: | ---: | ---: | ---: |
| 250 elements / 25 sections | 118.94 MB | 383.55 MB | 159.22 MB | 59.75 MB | 54.15 MB |
| 1k elements / 50 sections | 241.72 MB | 573.02 MB | 248.87 MB | 238.59 MB | 474.33 MB |

Status: superseded by Idea 17.
Decision: the `scope.run(() => runtime.effect(...))` model was correct, but the static runtime
object was unnecessary once static mode became a sentinel handled by the scoped-effect primitive.

### 17. Static sentinel with one compiler path

Hypothesis: static mode can be represented as `STATIC_STYLE_RUNTIME` instead of a static runtime
object or a separate static compiler method. The compiler can always run the same root-target and
target-chunk effect algorithm, while `createStyleEffectScope` decides whether an effect subscribes
reactively or executes once.

Result:

| Case | Static counting | Static string |
| --- | ---: | ---: |
| 250 elements / 25 sections | 35.80 ms | 39.23 ms |
| 1k elements / 50 sections | 131.81 ms | 148.42 ms |
| 5k elements / 200 sections | 648.25 ms | 709.84 ms |

| Case | Initial compile | Property change | Class change | Reorder | Add element | Remove element |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 250 elements / 25 sections | 569.86 ms | 2.1551 ms | 1.1564 ms | 0.4618 ms | 2.3290 ms | 0.1704 ms |
| 1k elements / 50 sections | 2,288.31 ms | 2.1205 ms | 1.1388 ms | 1.4396 ms | 2.5119 ms | 0.2924 ms |
| 5k elements / 200 sections | 11,895.37 ms | 2.2055 ms | 1.1736 ms | 4.4855 ms | 4.7935 ms | 1.4367 ms |

Memory samples:

| Case | Peak initial heap | Peak initial RSS | Peak property heap | Peak add heap | Peak remove heap |
| --- | ---: | ---: | ---: | ---: | ---: |
| 250 elements / 25 sections | 88.83 MB | 390.88 MB | 245.97 MB | 149.49 MB | 55.72 MB |
| 1k elements / 50 sections | 357.99 MB | 543.54 MB | 249.53 MB | 248.17 MB | 133.78 MB |
| 5k elements / 200 sections | 1,525.58 MB | 1,991.02 MB | 534.78 MB | 536.21 MB | 540.77 MB |

Status: implemented.
Decision: keep. Static counting regresses modestly on the largest case compared with Idea 16, but
the old duplicated static compiler branch is gone. The 5k reactive suite now completes without OOM;
initial compile is still expensive, while hot updates stay near target-chunk cost because only the
changed target scope reruns.
