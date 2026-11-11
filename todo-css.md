# CSS POC TODO

## Critical Follow-Ups

- [ ] QA very intensively on existing projects to ensure there is no breakage.
    - [ ] Large real pages with many elements/sections.
    - [ ] Existing projects with classes/subclasses in different orders.
    - [ ] Library components with root overrides and instance overrides.
    - [ ] Formulas/dynamic values on style and content properties.
    - [ ] Repeated elements, popups, conditional rendering, and page navigation.
    - [ ] Responsive breakpoints and native/custom states.
    - [ ] Editor canvas affordances: selection, hover, spacing overlays, bound/deprecated indicators.
    - [ ] Published-mode parity once publisher integration exists.

- [ ] Add back editor features mindfully instead of pushing editor concerns into the common compiler.
    - [x] Native state preview fallback exists in compiler `mode: 'editor'`.
    - [x] Old metadata is still available from `useComponentData` for editor logic.
    - [ ] Re-introduce or replace editor-only `isEditing` CSS behavior where needed.
    - [ ] Audit editor-only overlays/menus/tags that previously depended on resolved inline `style`.
    - [ ] Keep editor affordance CSS outside the pure compiler unless it is real front/published CSS.

- [ ] Find a long-term solution for style classes.
    - [x] Rolled back shared CSS marker classes.
    - [x] Current compiler resolves class/subclass values per target, preserving existing local class order behavior.
    - [ ] Decide product contract: keep local per-source class order, or introduce global class precedence as a breaking change.
    - [ ] If local order stays, accept less shared CSS or design dependency-aware invalidation for class edits.
    - [ ] If global precedence wins, design the class ordering model explicitly before reintroducing shared class CSS.

## Feature Status

- [ ] State status.
    - [x] Base state and configured states are compiled into target chunks.
    - [x] Custom states compile to `[data-ww-states~="..."]`.
    - [x] Runtime elements/sections write `data-ww-states` for active custom states.
    - [x] Editor forced-state preview writes `data-ww-forced-states`.
    - [x] Editor native/custom forced-state preview fallback exists in compiler `mode: 'editor'`.
    - [ ] QA native/custom state parity on real editor interactions and published output.
    - [ ] Audit parent/native states once the editor feature layer is reintroduced.

- [ ] Formula status.
    - [x] Formula values compile to CSS custom-property references.
    - [x] Editor runtime writes CSS custom-property overrides through the runtime stylesheet.
    - [x] Formula values coming from classes/subclasses are scoped per resolved target.
    - [x] Publisher only needs to render the static stylesheet; app/runtime stylesheet owns CSS variable overrides.
    - [ ] Publisher must serialize/inject dynamic variable metadata into the published app runtime so
          formula CSS variables can be evaluated after static CSS generation.
    - [ ] Handle or explicitly reject formula-driven compiler branching, such as formula-driven layout mode.
    - [ ] QA reactive formula updates on style, content, `customCss`, classes, and library component roots.

- [ ] Breakpoint status.
    - [x] Fixed `default`, `tablet`, and `mobile` breakpoints are compiled.
    - [x] Media query ordering is deterministic inside each target chunk.
    - [ ] QA responsive editor and published parity.
    - [ ] Confirm no product need remains for custom breakpoint data in the compiler contract.

- [ ] Pseudo-class status.
    - [x] Native `_wwHover`, `_wwFocus`, `_wwFocusVisible`, and `_wwActive` states compile to browser pseudo-classes.
    - [x] Pseudo-class selectors are the default compiler output for native states.
    - [x] Editor preview fallback uses `[data-ww-forced-states]`, not `[data-ww-states]`.
    - [ ] QA `:hover`, `:focus-within`, `:focus-visible`, and `:active` on real elements/components.
    - [ ] Audit any old non-`_ww` native-state aliases before removing compatibility.
    - [ ] Add possibility through ww-config for a component to declare a state as "native"

- [ ] Class status.
    - [x] Classes and subclasses resolve per target chunk.
    - [x] Existing local class order behavior is preserved.
    - [x] Subclass values override parent class values, and direct source values override class values for the same slot.
    - [x] Shared marker class CSS was rolled back.
    - [ ] Decide the long-term precedence model before trying to share class CSS again.
    - [ ] Design class-edit invalidation if local class order stays.
    - [ ] QA class/subclass/editor/published parity on existing projects.

## Current Implementation

- [x] Common style compiler exists in `src/_common/helpers/styleCompiler`.
    - [x] Runtime-free TypeScript contracts in `types.ts`.
    - [x] Selectors in `selectors.ts`.
    - [x] Safe serialization and escaping in `serialization.ts`.
    - [x] Background compilation in `background.ts`.
    - [x] Declarations and layout compilation in `declarations.ts`.
    - [x] Target discovery in `targets.ts`.
    - [x] Static/string stylesheet adapter in `stylesheet.ts`.
    - [x] Vue/runtime adapters stay outside the common compiler.
    - [ ] Copy/sync the common compiler into `weweb-lambda-back-publisher`.
    - [x] Publisher-side formula support is static CSS plus app/runtime stylesheet CSS variable overrides.
    - [ ] Publisher-side formula support also needs a serialized dynamic-variable manifest containing
          source uid, surface, domain, property, state, breakpoint, generated variable name, consumed CSS
          property, and original formula value for the app runtime writer.

- [x] Page-level editor runtime exists.
    - [x] `usePageStyleCompilerRuntime()` mounts the compiler from `wwPage`.
    - [x] Compile scope is built from page sections, page elements, popups, and library component roots.
    - [x] One CSSOM stylesheet is cached per front `Document` with `WeakMap<Document, CSSStyleSheet>`.
    - [x] Target chunks are reactive and dispose/reinsert their own rules.
    - [x] Runtime uses Vue `effectScope()` and `watchEffect`.
    - [ ] QA iframe reload and document replacement behavior.
    - [ ] QA `v-if`, force-render, popup, and page-navigation lifecycle behavior.

- [x] Old full inline style rendering is removed from the main element/section path.
    - [x] Element `:style` now keeps only animation and `extra-style`.
    - [x] Section container/element empty style bindings are removed.
    - [x] Formula/dynamic values are written through the runtime stylesheet.
    - [ ] Audit all element wrappers/placeholders that still use `extra-style` for editor/runtime affordances.

- [x] Stylesheet adapter uses CSSOM writes.
    - [x] Rules are inserted with `insertRule`.
    - [x] Declarations are applied with `CSSStyleDeclaration.setProperty`.
    - [x] Empty rules are deleted.
    - [x] Target disposal removes owned rules.
    - [x] Dynamic variables register cleanup callbacks with the target chunk.

- [x] CSS safety basics are implemented.
    - [x] CSS property names are normalized and validated.
    - [x] CSS values are validated before insertion.
    - [x] Generated class/selector identifiers are escaped.
    - [x] Unsafe custom CSS emits diagnostics instead of injecting raw strings.
    - [ ] Broaden diagnostics visibility for editor QA/debugging.

- [x] Compiler test coverage exists.
    - [x] Pure compiler output.
    - [x] Rule adapter lifecycle.
    - [x] Responsive breakpoints.
    - [x] Native/custom states.
    - [x] Classes and subclasses with local source order.
    - [x] Formula CSS variables.
    - [x] `customCss`.
    - [x] Backgrounds.
    - [x] `wwLayout` content properties.
    - [x] Library component roots.
    - [x] Reactive target chunk invalidation.
    - [x] Benchmarks exist for large static/reactive compiler scenarios.
    - [ ] Browser QA tests on real editor projects.
    - [ ] Published-output parity tests.

- [x] ignoredStyleProperties
- [x] displayAllowedValue (for default value at least)
- [ ] Component configuration contract lives in the reader/capability types and component `ww-config`
      hooks.
    - [x] Normalize component capabilities in the editor adapter.
    - [ ] Normalize component capabilities in the publisher adapter.
    - [x] Update core `wwText` internal rendering to consume the new text style contract.
    - [x] Update first-party coded components that inherit `ww-text` or own text surfaces.
        - [x] Core editor `wwText` reference implementation consumes `--ww-text-*`.
        - [x] Audit direct `ww-text` inheritance in `weweb-assets`.
        - [x] `ww-button` root resets moved out of the compiler cascade path:
              https://github.com/weweb-assets/ww-button/pull/61.
        - [x] `ww-input-basic` no longer writes old inline text style and consumes text-surface
              variables: https://github.com/weweb-assets/ww-input-basic/pull/117.
        - [x] `ww-text` package delegates to core `wwText`, so the editor/runtime core change covers
              its real text DOM surface.
        - [x] Dialog/accordion text-inheriting wrappers were audited; they do not own a direct text
              surface to patch.
    - [x] Remove `ww-flexbox` `wwProps.overrideDisplayValues` from style configuration.
    - [x] Audit remaining `ww-flexbox` runtime paths before deleting anything.
        - [x] Remove CSS-relevant `overrideDisplayValues` dependency.
        - [x] `isFixed` still has live callers, so it is retained.
        - [x] `noDropzone` still has live callers, so it is retained.
        - [x] No extra confirmed-unused `ww-flexbox` runtime path was found to delete.

## Parity And Remaining Migration Work

- [ ] Text style migration.
    - [x] `--ww-element-transition` is emitted as a capability-driven CSS variable.
    - [x] Core `wwText` no longer calls the old text-style helper for rendered text style.
    - [x] Direct `ww-text` inheriting coded components were audited.
    - [x] Update components that own an internal text surface, starting with `ww-text`, to consume
          compiler-emitted `--ww-text-*` variables.
    - [x] Cover input/button/link components and any first-party coded component that stores text
          style in content props.
    - [x] Remove the old public text-style helper after migrating first-party callers to compiler CSS.
    - [ ] Verify text ellipsis/nowrap/textAlign/decoration/transform parity.
          => Note d'Aurelie : Il faut faire attention, car ca va potentiellement au root ?

- [ ] Layout migration.
    - [x] Compiler emits CSS for `.ww-layout` surfaces.
    - [x] Flex/grid/table/block content properties are partially compiled.
    - [x] `wwLayout` class/subclass content values resolve per target.
    - [ ] Deprecated/public `wwLib.wwElement.useLayoutStyle()` still exists.
    - [ ] `wwSimpleLayout` still exists.
    - [ ] Repeat/list structural layout behavior stays runtime-owned and needs QA.
    - [ ] Custom slot roots that apply `itemStyle` themselves still need runtime support.

- [ ] Editor metadata refactor.
    - [x] Current code still keeps `style`, `rawStyle`, `rawContent`, and editor metadata available.
    - [ ] Replace ad hoc style/rawStyle reads with explicit metadata APIs where useful.
    - [ ] Verify margin/padding overlays.
    - [ ] Verify bound indicators and bound hover/selection coloring.
    - [ ] Verify position/animation info tags.
    - [ ] Verify conditional rendering and editor force-render behavior.
    - [ ] Verify parent display/drop behavior.
    - [ ] Verify keyframe animation editing.

- [ ] Library component/root override parity.
    - [x] Compile scope includes library component root elements.
    - [x] Dynamic variable names are scoped by source uid/domain/state/breakpoint.
    - [x] Class values resolve per target, preserving current resolver behavior.
    - [ ] QA root definition CSS plus instance override CSS on the same rendered node.
    - [ ] QA nested library components.
    - [ ] QA formulas on library component roots and instance overrides.

- [x] `customCss` support.
    - [x] Direct custom CSS entries are compiled.
    - [x] Class/subclass custom CSS entries are resolved.
    - [x] Dynamic custom CSS values become CSS variables.
    - [x] Unsafe property/value diagnostics are emitted.

- [x] Remove `isInStrechedSection` / stretched-section special case from this compiler path.

- [ ] Remove legacy runtime attributes/helpers when safe.
    - [ ] Remove remaining `ww-responsive` usage.
    - [ ] Remove `wwSimpleLayout`.
    - [ ] Audit `wwLinkPopup`, background video, editable text, and any non-main render surfaces still using old responsive helpers.

- [x] `ww-image` aspect ratio.
    - [x] Inherit/apply aspect ratio through CSS once image behavior is covered.

## Earlier Aurelie Checklist

- [x] Remove Set for migrated props.
- [ ] Verify one stylesheet vs multiple stylesheet.
    - [x] Current implementation uses one CSSOM stylesheet per front document.
    - [ ] Decide whether publisher/editor should split sheets by purpose or target kind.
- [ ] Shorten generated class names.
    - [x] Compiler-owned element class exists as `.ww-element-<uid>`.
    - [ ] Revisit shorter/minified class names for published sites.
- [x] Replace global stylesheet variables with document-keyed stylesheet cache.
- [x] Avoid one module-level stylesheet singleton shared across editor/front documents.
- [x] Generate stylesheet from page data instead of mounting one stylesheet per component.
    - [x] Page-level compile scope exists.
    - [x] Target chunks survive root list reruns.
    - [ ] QA hidden/unmounted/conditional targets.
- [x] Remove old style rule declaration / instance style rule declaration split in favor of rule adapters.
- [ ] Check margin/padding display in the editor.
- [ ] Check library component root overrides.
- [x] Add glossary.
- [x] Update stylesheet with setter/CSSOM API.
- [ ] Remove `ww-responsive`.
- [ ] Remove `wwSimpleLayout`.

- [ ] Refacto rawStyle / styel based calculation in editor :
      [x] `rawStyle` is used to detect `isBound`, which drives bind tags and bound hover/selection coloring.
      [x] resolved `style.margin` and `style.padding` drive spacing overlays.
      [x] `style.position` and animation props drive position/animation info tags.
      [x] `style.conditionalRendering` drives conditional rendering and editor forcerender behavior.
      [x] parent `style.display` affects layout display/drop behavior.
      [ ] keyframe animation editing reads animation data from `style`.
      [x] style is used to hide the menu => useOverlay et getStyle pour récupérer le hidden (like margin and padding)

    The CSS path should either keep these values available or expose equivalent metadata before removing the legacy
    properties.

- [x] Migrer `getTextStyleFromContent` vers des custom properties CSS héritables (même modèle que `--ww-element-transition`).
      La typo héritée de la config ww-text (props content `_ww-text_*` : font, color, textAlign, letterSpacing,
      textDecoration, textTransform, ellipsis, nowrap…) est aujourd'hui compilée en JS par
      `wwUtils.getTextStyleFromContent` et appliquée inline aux nœuds internes qui NE portent PAS `.ww-element-<uid>` :
    - ww-text → nœud texte (wwTextContent) ;
    - ww-input-basic (via `useInput`), ww-input-mask, ww-input-advanced-placeholder → `<input>`.
      Cible : émettre ces valeurs comme variables sur la règle de l'element (`--ww-text-color`, `--ww-text-font-size`…)
      et les consommer via `var(--ww-text-*)` sur les nœuds internes → atteint l'input/texte quelle que soit
      l'imbrication, compatible génération CSS page-level. `--ww-element-transition` en est la première brique.

- [x] Migrer `getLayoutStyleFromContent` / `wwLib.useLayoutStyle()` (héritage `ww-layout`) vers du CSS natif.
      Le layout hérité (props content `_ww-layout_*`/`_ww-grid_*`/`_ww-table_*` + `style.display`/`textAlign`) est
      compilé en JS par `getLayoutStyleFromContent` (wwLayoutStyle.js) et appliqué au root de l'element — via le
      composant `<wwLayout>` (ww-flexbox, ww-form-container, ww-label, ww-accordion-trigger, ww-tab-content,
      ww-table-cell…) ou via `wwLib.useLayoutStyle()` en direct (pf-list). ~23 composants héritent `ww-layout`.
      Différence vs typo : appliqué au root de l'element (classe `.ww-element-<uid>` l'atteint) → migrable en
      déclarations DIRECTES sur la règle (pas de variables), MAIS logique de branchement flex/grid/block/table à
      porter, + `__wwContainerType` (drop behavior) qui reste une métadonnée JS dérivée de `display`.

## Extra Miles

- [ ] Minify generated CSS and shorten generated class names, at least for published sites.
- [ ] Add human-facing docs beyond the technical README/glossary.
