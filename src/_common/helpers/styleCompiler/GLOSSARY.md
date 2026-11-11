- stylesheet adapter: compiler output surface, such as a DOM style tag adapter or a CSS string serializer.
- generated group: one compiler-owned CSS cascade layer. Current groups are library, section, and
  element, ordered from lowest to highest generated priority, above the runtime/component baseline
  layer.
- scope disposal: cleanup callback registered by the compiler to remove rules or properties when a reactive scope stops or reruns.
- target chunk: all CSS rules owned by one compiled source target; it can include more than one rendered surface.
- surface: one compiled styling surface, such as an element, section container, section inner element, or layout node.
- layout style scope: compact token for an element or renderless library persisted `_si` exposed in
  `data-ww-ls`; it identifies which generated sources may style a `wwLayout` node.
- style domain: generic visual data stored under `_state.style`.
- content domain: component-specific data stored under `content`; only CSS-producing content keys are compiled.
- rule: selector plus CSS declarations, inserted or deleted as one stylesheet unit.
- rule target: declaration-level override that writes a declaration to a related selector, such as
  a layout child rule.
- rule insertion order: deterministic cascade position created by the order rules are inserted.
- declaration: one CSS property and its compiled value.
- property: source value read from either the style or content domain.
- dynamic variable: compiler-generated `--ww-style-*` or `--ww-content-*` custom property placeholder
  for a formula/dynamic source value. It can include a persisted or statically evaluated fallback,
  for example `var(--ww-style-width, 320px)`.
- style class: reusable WeWeb class whose values are resolved into each target chunk so local
  class order and subclass precedence match the current runtime resolver.
