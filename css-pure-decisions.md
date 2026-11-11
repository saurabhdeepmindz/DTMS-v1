# CSS pur — Découplage de l'objet `style`/`rawStyle` : décisions & suivi QA / produit

> Suivi vivant du sous-chantier "retirer les dépendances JS à l'objet `style`/`rawStyle` résolu" (branche `WW-3544`).
> Sert de référence pour la **QA** (quoi retester / non-régressions) et les **points produit** (choix faits, limites assumées).
> Statut : ⬜ à faire · 🔄 en cours · ✅ fait · 🔴 dropé / limité.

## Contexte

Le POC "CSS pur" rend les props de style statiques simples (`margin, padding, overflow, zIndex, opacity, boxShadow, transition, transform, aspectRatio, perspective, border*, outline*, borderRadius`) via des règles `.ww-<uid>` dans une stylesheet dédiée, et **retire ces props de l'objet `style`/`rawStyle` résolu en JS**. Objectif à terme : supprimer entièrement cet objet et `provide('componentStyle', style)` pour laisser le navigateur faire la cascade.

Avant cette suppression, les consommateurs éditeur qui lisaient ce `style`/`rawStyle` (pour de la métadonnée ou de la logique éditeur) doivent être migrés vers une autre source. **L'édition sidepanel qui lit la _donnée_ (`_state.style.*`) est légitime et hors périmètre.**

Méthode : itérations petites et unitaires, une par consommateur, en commençant par les cas cassés.

## Décisions transverses

| Décision | Détail | Impact QA / produit |
|---|---|---|
| Valeurs CSS lues via `getComputedStyle` | Pour une valeur réellement appliquée (overlays), lire le DOM plutôt que l'objet `style` JS. | Reflète la valeur px réellement rendue (règle CSS + inline + hérité + responsive), pas la donnée brute. |
| isBound = bindings de **données** uniquement (style **exclu**) | Le tag "bound" signale ce qui est lié à de la **donnée** (repeat, titre, texte…), pas le style — c'est son sens métier. isBound ne lit donc plus que `rawContent`, plus du tout `rawStyle`. **Validé produit.** | Le tag "bound" ne s'affiche plus pour un style bindé (margin/border…) — voulu. Reste inchangé pour les bindings de contenu. |
| `conditionalRendering` reste résolu en JS | Ce n'est pas une prop CSS (contrôle `v-if`) → computed dédié, jamais via `getComputedStyle`. | Comportement fonctionnel inchangé. |
| `_measureDraggedSize` : aucun changement | Consommateur inexistant dans le code (régression seulement anticipée par un doc). | Rien à retester côté drag pour ce point. |
| **Variables CSS héritables** pour les valeurs consommées par des nœuds internes | Quand une valeur doit atteindre un nœud interne qui ne porte PAS la classe `.ww-<uid>` (texte de ww-button, `<input>` des composants héritant ww-text…), l'exposer en **custom property héritable** sur la règle de l'element, consommée via `var(...)` par le nœud interne — plutôt qu'un provide/inject JS. **Motif** : compatible avec la future génération CSS **page-level** (l'autre chantier), là où un provide/inject par element ne l'est pas. Chaque element **réémet** la variable (valeur ou `none`) pour ne pas hériter d'un ancêtre. C'est le modèle des unités 2 (transition) et futures (`getTextStyleFromContent`, `getLayoutStyleFromContent`). | Aucun impact fonctionnel attendu ; comportement per-element préservé. |
| **Convention de nommage** `--ww-element-*` | Les custom properties générées sont préfixées `--ww-element-` (ex. `--ww-element-transition`). **Motif** : `--ww-transition` est déjà consommé par des composants éditeur (ComponentEditor, CopilotCodeView) → préfixe dédié pour éviter toute collision/ambiguïté. | — |

## Suivi par unité

| Unité | Feature | Choix / source de remplacement | Régression / limite connue | Statut | À retester (QA) |
|---|---|---|---|---|---|
| 1 | Overlays spacing (margin/padding) éditeur | `getComputedStyle` centralisé dans `useComponentOverlay` (réactif via `watch(elementRect)`) ; suppression de `splitSpacings.js` + `useComponentWidth.js` | overlay reflète la valeur px appliquée (améliore %/hérité) | ✅ | overlay margin/padding (élément + section), édition live, marges négatives, valeurs %/responsive |
| 2 | wwEditableText — transition du texte | variable CSS héritable `--ww-element-transition` posée sur la règle `.ww-<uid>`, consommée par `wwTextContent` ; suppression de la recopie JS + de l'inject `componentStyle` | — | ✅ | transition du texte animée sur changement de state : ww-text, ww-number, **et texte des boutons (ww-button)** ; front + éditeur |
| 3 | isBound — bind tags + bordure bound | isBound calculé sur `rawContent` uniquement (style exclu) dans wwElementComponent, wwSectionComponent **et wwLibraryComponent** ; `rawStyle` retiré de ces isBound + destructurations mortes nettoyées (element/section) | le tag "bound" ne s'affiche plus pour un style bindé (voulu, décision métier) | ✅ | tag "bound" + bordure bound sur élément/section/library-component dont le **contenu** est bindé (repeat/texte/titre) ; NE doit PLUS apparaître pour un style seul bindé |
| 4 | Info tags position / animation + section maxWidth | **animation** → `componentAnimationDuration` (résolution donnée, cohérent navigator) ; **position** + **maxWidth** → `getComputedStyle(el)` via `useComponentOverlay` (overlay-only, absents du navigator ; 1 seul getComputedStyle/tick) | maxWidth : px réellement appliqué (% résolu en px ; `widthPreview` via `parseFloat`) | ✅ | badge position absolute/fixed, badge animation ; widthPreview section |
| 5 | Rendu conditionnel + force-render | `isRendering` **factorisé dans `useComponent`** (conditionalRendering résolu + force-render éditeur ; sur le front `isRendering` = `componentConditionalRendering`, pas de computed en plus) ; partagé element/section | — | ✅ | élément/section masqué par condition (front + publié), force-render éditeur |
| 6 | Layout : `getLayoutStyleFromContent` / `style.display` (hide menu) / `__wwContainerType` | compilateur = rendu ; `wwLayoutContext` porte `layoutType`+`direction` (depuis donnée) ; menu-hide via `componentDisplay` ; prop `direction` de wwLayout **supprimée** (0 usage) ; wwSimpleLayout → surface `.ww-layout` ; helpers `@deprecated` | prop `direction` de `<wwLayout>` supprimée (inutilisée) ; `useLayoutStyle`/`getLayoutStyleFromContent` dépréciés (externes: pf-list, wwSimpleLayout migré) | ✅ (typecheck OK) | layout flex/grid/block/table (éditeur+publié) ; orientation drop helpers (row/column) ; panneau enfant: Align Self/Sizing (flex) & Column/Row span (grid) ; menu masqué si display:none ; wwSimpleLayout |
| — | Suppression `provide('componentStyle')` | après unités 4/5 + retrait des `inject` restants | `componentStyle` encore injecté par `useLayoutStyle` déprécié (externe) + unités 4/5 ; `componentDisplay` (ciblé) introduit pour découpler le layout/menu-hide | ⬜ | non-régression globale rendu éditeur/front |

## Détail des unités livrées

### Unité 1 — Overlays spacing (✅)

**Problème** : les overlays de marge/padding de l'éditeur lisaient `style.margin`/`style.padding`, devenus `undefined` après migration de ces props vers la règle CSS → overlays vides.

**Choix** : lire les valeurs réellement appliquées via `getComputedStyle(el)` (toujours en px), centralisé dans `useComponentOverlay` (qui possède déjà l'élément DOM + la géométrie `elementRect` rafraîchie en rAF). Réactivité assurée par `watch(elementRect, …, { flush: 'post' })` : toute édition de spacing change la géométrie → relecture. Calcul uniquement pour l'élément survolé/sélectionné (un seul à la fois) → coût reflow négligeable.

**Fichiers** :
- `src/_front/use/editor/useComponentOverlay.js` — expose `marginsValues`/`paddingsValues` (tableaux `[top, right, bottom, left]` en px).
- `src/_front/components/wwElementComponent.vue`, `src/_front/components/wwSectionComponent.vue` — consomment le composable ; suppression des computeds locaux, de `parentWidth`/`rootWidth` et des imports morts ; templates simplifiés (plus de `{length, unit}`, juste des nombres + `px`).
- Supprimés : `src/_front/helpers/editor/splitSpacings.js`, `src/_front/use/editor/useComponentWidth.js` (orphelins).

**QA / non-régression** :
- Sélectionner/survoler un **élément** avec margin + padding → bandes correctes.
- Idem sur une **section**.
- Éditer un padding/margin dans le sidepanel → l'overlay se met à jour en direct.
- **Marges négatives** → bande dédiée affichée correctement.
- Valeur en **%** ou **responsive** → l'overlay reflète la valeur px réellement appliquée (amélioration vs avant).

### Unité 2 — wwEditableText transition (✅)

**Problème** : la transition du texte était recopiée en JS depuis `componentStyle.transition` (pour animer les changements de style de texte entre states — la transition ne s'hérite pas du wrapper). `transition` étant migrée sur la règle `.ww-<uid>` et retirée de `componentStyle`, la recopie valait `undefined` → plus d'animation.

**Audit préalable (org weweb-assets)** : seuls 3 composants rendent `wwText` — `ww-text` et `ww-number` (wwText **root** → la classe `.ww-element-<uid>` atteint le nœud texte), et `ww-button` (wwText **imbriqué** dans le `<button>` → la classe est sur le bouton, PAS sur le span texte). Le cas ww-button interdit la simple suppression de la recopie.

**Choix** : variable CSS **héritable** `--ww-element-transition`. La règle `.ww-<uid>` l'expose (à côté de `transition`) ; `wwTextContent` fait `transition: var(--ww-element-transition)`. Les custom properties héritent → atteignent le span imbriqué de ww-button comme le nœud root de ww-text/ww-number. 100% CSS, aucun couplage JS, compatible avec la future génération CSS **page-level**. `transition: inherit` et provide/inject écartés (respectivement fragile au nesting / incompatible page-level).

**Portée future** : ce pattern (variables héritables sur la règle element) est la première brique du remplacement de `getTextStyleFromContent` (typo héritée appliquée aux `<input>`) — cf. `todo-css.md`.

**Fichiers** :
- `src/_common/helpers/component/componentProperty.js` — `getDefaultStyleRuleDeclarations` émet `--ww-element-transition` sur **chaque** element (valeur, ou `none` par défaut). Le `none` réinitialise la variable à la frontière de chaque element → un texte sans transition propre n'hérite jamais de la transition d'un ancêtre lointain (les custom properties héritent), ce qui reproduit exactement l'ancien comportement per-element.
- `src/_front/components/textEditor/wwTextContent.vue` — `.ww-text-content { transition: var(--ww-element-transition); }` (scopé).
- `src/_front/components/textEditor/wwEditableText.vue` — suppression de la recopie `transition` et de l'inject `componentStyle`.

**QA / non-régression** :
- **ww-text / ww-number** : transition + state (hover changeant la couleur) → texte animé (éditeur + publié).
- **ww-button** : transition sur le bouton + state → le texte du bouton (span) s'anime aussi.
- Sans transition configurée → aucune animation, aucune erreur (`var(--ww-element-transition)` absent = no-op).

### Unité 3 — isBound (✅)

**Problème** : `isBound` (tag "bound" + coloration de bordure hover/select) lisait `rawStyle` en plus de `rawContent`. Les props de style migrées ayant quitté `rawStyle`, la détection sur le style était devenue partielle.

**Décision (métier, validée produit)** : le tag "bound" doit signaler ce qui est lié à de la **donnée** (repeat, titre, texte…), **pas** le style. On **exclut donc le style** : `isBound` ne lit plus que `rawContent`. Bénéfice bonus : plus aucune dépendance à `rawStyle` (permettra sa suppression). Les alternatives (re-résolution fidèle avec classes, ou scan de `_state.style`) sont sans objet puisque le style ne doit pas compter.

**Fichiers** :
- `src/_front/components/wwElementComponent.vue`, `wwSectionComponent.vue`, `wwLibraryComponent.vue` — `isBound` calculé sur `rawContent` seul (sémantique de contenu de chaque composant préservée). `rawStyle` retiré des `isBound` ; destructuration `rawStyle` supprimée dans element/section (encore utilisée dans library via `componentData`).
- `wwLayout.vue` : `isBound` par-propriété (layout) non concerné — inchangé.

**QA / non-régression** :
- Élément / section / library-component dont le **contenu** est bindé (repeat, texte, titre) → tag "bound" + bordure bound au hover/select : inchangé.
- Élément dont **seul un style** est bindé (ex. margin/couleur) → le tag "bound" **ne s'affiche plus** (comportement voulu).

### Unité 6 — Layout (✅)

**Constat** : le compilateur de style rend déjà tout le layout (display/flex/grid/table) via la surface `.ww-layout`. `getLayoutStyleFromContent` était donc redondant pour le rendu ; il ne servait plus qu'à extraire des métadonnées (type de conteneur, direction) et le hide-menu lisait `style.display`.

**Décisions** :
- **Source = donnée**, pas `getComputedStyle` (qui donnerait le display de l'enfant, pas du parent ; incohérent avec le pattern éditeur du navigator qui résout via `getComponentRawProperty`). Info du **parent** transmise par provide/inject (`wwLayoutContext`).
- **`componentDisplay` = display RÉSOLU (= type de layout)** exposé par `useComponent` : résolution du display **indépendante de l'objet `style`** (`getComponentRawProperty` sur `_state.style.display`, comme le navigator) **+ `getDisplayValue`** (le calcul est remonté dans `useComponent` qui a la `configuration` + le context). `provide('componentDisplay')` **conservé** — on a juste changé la valeur exposée (résolue). Consommé par wwLayout (`wwLayoutContext.layoutType` + gate flex de la direction) et le menu-hide (`!== 'none'`).
- **prop `direction` de `<wwLayout>` conservée** (rendu inline flex centré, cas hors-données non couvert par le compilateur ; front + éditeur) ; `wwLayoutContext.direction = props.direction || <content>`.
- **`provide('componentConfiguration')` retiré** : plus aucun consommateur (wwLayout ne l'injecte plus, `getDisplayValue` étant remonté ; `useLayoutStyle` neutralisé). Vérifié **0 usage** côté éditeur ET assets (199/205 repos, 696 fichiers).
- **`useLayoutStyle` neutralisé** : corps commenté, retourne `computed(() => ({}))`, `console.error` conservé (repérage d'appels externes). `getLayoutStyleFromContent` `@deprecated`, plus d'appelant interne.
- **`getFlexDirection` factorisé** : cœur reverse pur dans `styleCompiler/layout.ts` (exporté via `styleCompiler/index`), utilisé par wwLayout ET par le `getFlexDirection` interne du compilateur (qui garde sa garde dynamic-var).
- **API publique** : `wwSimpleLayout` migré vers la surface `.ww-layout` (drop `useLayoutStyle` inline) ; pf-list ignoré (déprécié).

**Fichiers** :
- `src/_common/use/useComponent.js` — `componentDisplay` = valeur résolue (`getDisplayValue`) ; `provide('componentDisplay')` + return conservés ; `provide('componentConfiguration')` **retiré**.
- `src/_front/components/wwLayout.vue` — prop `direction` conservée + `layoutDomStyle` inline ; suppression `getLayoutStyleFromContent`, `layoutType` (remonté), inject `componentConfiguration`/`componentWwProps`, `componentContext`, `provide('__wwContainerType')` ; `wwLayoutContext.layoutType = componentDisplay`, `direction = props.direction || getFlexDirection(content)`.
- `src/_common/helpers/styleCompiler/layout.ts` (nouveau) + `index.ts` (export) + `declarations.ts` (délégation) — helper `getFlexDirection` partagé.
- `src/_front/components/wwElementComponent.vue`, `wwLibraryComponent.vue` — retrait `__wwContainerType` ; `containerInformation.layoutType` ← `wwLayoutContext.layoutType` ; menu-hide via `componentDisplay` (résolu).
- `src/_front/components/elements/wwSimpleLayout.vue` — rend `class="ww-layout"` (compilateur), drop `useLayoutStyle`.
- `src/wwLib/services/wwElement.js` — `useLayoutStyle` corps commenté + `console.error` ; `src/_front/helpers/wwLayoutStyle.js` — `@deprecated`.

**Éditeur-only (perf front)** : `componentDisplay` + `layoutType`/`direction` (+ consommateurs : drop helpers, menu-hide, `containerInformation`→panneau) sont **exclusivement éditeur** → producteurs gatés `wwEditor:start/end` (strippés du build publié). `layoutDomStyle` (prop `direction`) reste ungated (rendu réel front + éditeur).

**Non impactés** (vérifié) : le Navigator (icône hidden/animation) et `EditionTabStyle` résolvent le display eux-mêmes depuis la donnée (`getComponentRawProperty` / `_state.style.display`), indépendants du style runtime.

**QA / non-régression** :
- Layout flex/grid/block/table identique (éditeur + publié).
- Drop helpers orientés selon la direction du flex parent (drag enfant dans flex row vs column).
- Panneau d'un élément enfant : Align Self / Sizing (parent flex), Column/Row span (parent grid) s'affichent correctement.
- Menu d'édition masqué si l'élément est `display:none`.
- Composants externes utilisant `<wwSimpleLayout>` : layout appliqué via le compilateur (surface `.ww-layout`).

### Lot 1 — C (info tags) + D (conditionalRendering) + section maxWidth (✅)

**Objectif** : retirer 3 des 4 derniers consommateurs de l'objet `style` résolu (le 4e = `animationStyle`, lot 2). Chaque lecture `style.X` remplacée par une source ciblée, **selon la cohérence avec le Navigator**.

**Décision (cohérence navigator)** : `conditionalRendering` et `animationDuration` sont AUSSI affichés dans le Navigator (résolus via `getComponentRawProperty`) → **même méthode** (résolution donnée). `position` et `maxWidth` n'y sont PAS → **getComputedStyle** (overlay-only, élément sélectionné).

**Fichiers** :
- `src/_common/use/useComponent.js` — helper `resolveStyleProperty(suffix)` (ungated, keyframes gaté inline ; refactor de `componentDisplay`) ; `componentConditionalRendering` (résolu) + **`isRendering` factorisé** (front = conditionalRendering seul ; éditeur + force-render) ; `componentAnimationDuration` (résolu, éditeur-gaté). `isRendering` (ungated) + `componentAnimationDuration` (gaté) retournés.
- `src/_front/use/editor/useComponentOverlay.js` — refs `position` + `maxWidth` (`getComputedStyle(el)`), mises à jour dans le `watch(elementRect,{flush:'post'})` ; **un seul `getComputedStyle`/tick** (partagé avec `getSpacingsValues`).
- `src/_front/components/wwElementComponent.vue`, `wwSectionComponent.vue` — `isRendering` ← useComponentData (plus de computed local) ; info tags ← `position` + `componentAnimationDuration` ; section `widthPreview` ← `maxWidth` (via `parseFloat`, plus de `getLengthUnit`).

**Après lot 1** : l'objet `style` résolu n'est plus lu que par `useComponentKeyframes` (`animationStyle`) → lot 2, puis suppression de la boucle + `provide('componentStyle')` (après scan assets).

**QA / non-régression** :
- Rendu conditionnel : élément/section masqué par condition (front + publié) ; force-render éditeur.
- Badges menu : position (absolute/fixed) + animation ; cohérents avec les icônes du Navigator.
- Section widthPreview : guide de largeur correct (maxWidth via getComputedStyle = px réellement appliqué).

### Lot 2 — Animation au compilateur + suppression totale de `style`/`rawStyle` (✅ implémenté)

**Objectif** : dernier consommateur du `style` résolu (`animationStyle`). Rendu animation déplacé au **compilateur** (CSS), puis **suppression complète des objets `style` ET `rawStyle` résolus** de `useComponent`.

**Décisions** : (1) animation rendue par le compilateur (pas d'inline JS) ; `@keyframes` émis par le compilateur (nouveau kind at-rule, plus de `useInjectStyle`) ; (2) overrides library via layers CSS → retrait de tout le style calculé, pour tous les types. **Vérifié** : l'édition (`useComponentEdition`) est un pipeline indépendant (reconstruit ses `data`/`rawData` depuis Vuex) → ne consomme pas `style`/`rawStyle` de `useComponent` ; seul consommateur restant de `rawStyle` = l'override library (bundle `componentData` de wwLibraryComponent → enfants) → remplacé par les layers.

**Fichiers** :
- Compilateur (`styleCompiler/`, co-détenu) : `declarations.ts` (5 longhands dans `ELEMENT_OTHER_PROPERTIES` ; `createAnimationNameDeclaration` = `animation-name: ww-keyframes-<uid>` si keyframes ; `createAnimationEnumDeclaration` keyword-safe pour direction/playState ; `createKeyframesRule` passthrough+renommage). Nouveau kind `@keyframes` : `types.ts`, `serialization.ts`, `stylesheet.ts` (string/publisher), `styleCompilerDomStyleSheet.ts` (DOM/éditeur CSSOM), émission `compiler.ts` (base/default, surface élément, hors runtime). Tests dans `styleCompiler.test.ts`.
- Runtime : `useComponentKeyframes.js` réduit à l'override preview éditeur (`animationEditorOverride`) ; `useComponent.js` (boucle `!editorOnly` supprimée, `style`/`rawStyle` + `provide('componentStyle')` retirés) ; `wwElementComponent.vue` (`elementStyle` = compilateur + override éditeur, publié sans inline animation) ; `wwSectionComponent.vue` / `wwLibraryComponent.vue` (retrait `style`/`rawStyle` destructure + bundle).

**QA / non-régression** :
- Publié : animation via CSS compilateur (longhands + `@keyframes ww-keyframes-<uid>`), aucun inline ni `<style>` injecté.
- Éditeur : non-sélectionné figé (`animation: none`) ; sélectionné bindé à `keyframe-edition-animation` (play/pause via `editorKeyframesStore`) ; preview live keyframe editor OK.
- states/breakpoints/bound animation ; instance library anime via layer CSS.

**Fix régression — `conditionalRendering` d'une instance de library component (✅)** : en retirant `style`/`rawStyle` du bundle `componentData`, l'override JS instance→root de `conditionalRendering` (prop de STYLE mais non-CSS = un `v-if`, non gérée par les layers) ne se propageait plus → instance jamais masquée. Fix : l'instance **se masque elle-même** via son propre `isRendering` (`wwLibraryComponent` : `v-if="!isLoop && isRendering"` sur le front, `ComponentLoader v-else-if="isRendering"` en éditeur), symétrique avec `wwElement`/`wwSection`. Le `state`/`rawState` reste mergé (bundle) ; on ne réintroduit **pas** `style`/`rawStyle`. Le setup de wwLibraryComponent (sélection, menu, `useRegisterLocalInformation`) tourne toujours (v-if interne) → instance sélectionnable/navigable même masquée ; le chrome (overlay/menu, sur le child root) réapparaît via `forceRendering` à la sélection. Edge accepté : si le root de définition a lui-même une `conditionalRendering`, elle s'applique en **ET** avec celle de l'instance (avant : l'instance écrasait).

**Nettoyage fait (audit `sidepanelContent._state.style`)** : STYLE_CONFIGURATION n'a **aucune** prop `editorOnly` (le seul `editorOnly` = `forceRendering`, dans STATE_CONFIGURATION) et n'est pas extensible par les composants ; aucun lecteur de `sidepanelContent._state.style` côté éditeur (tous lisent `.content`) ; **0 usage `sidepanelContent._state` dans l'org weweb-assets** (les assets ne lisent que des content props via `wwEditorState.sidepanelContent`). → la boucle morte `if (STYLE_CONFIGURATION[prop].editorOnly)` a été retirée de `useComponent.js` (+ init `_state.style` retiré) et de `useComponentEdition.js` (branche morte, `else` conservé). Le miroir sidepanel de style était toujours vide.

**Points à étudier (suite)** :
- ⚠️ **`extra-style` borné au push-last runtime** — la suppression complète a été annulée pour préserver la sémantique legacy des listes répétées, des éléments masqués et des slots custom sans générer une matrice CSS par source/état/breakpoint. `wwLayout` réutilise deux objets constants (`margin-left`/`margin-top`) et les propage au seul item logique ciblé via `extra-style`/`itemStyle`. Le refactor `ww-columns` vers sa stylesheet reste inchangé.
- ✅ **Badge « overwritten by instance » (`isOverwrittenByLibrary`) recalculé depuis la data brute** — il lisait `localInformation.libraryComponentData` (bundle du rendu canvas, vidé de `style`/`rawStyle` au Lot 2 → cassé pour le style). Réécrit dans `useComponentEdition.js` (`useComponentEditionProperty`) 100% depuis le store : déclencheur = `editorUXStore.editingComponent` défini (on a « double-cliqué » dans l'instance) **et** l'uid édité == root du library component (`libraries/getComponents[baseUid].rootElementId`) ; test brut = l'instance (`getWwObjects[editingComponent.uid]`) définit la prop via `getComponentRawProperty` (sans `getValue`/bundle — simple indication visuelle « la valeur sera écrasée par l'instance »). Plus aucune lecture du bundle canvas dans ce computed. Périmètre : cas root uniquement (childrenData/nested = corner case hors périmètre).
  ✅ **`libraryComponentData` retiré du localContext** : le seul autre consommateur (le **Navigator**, `useNavigatorHeaderIcons.js`) ne s'en servait que pour appliquer l'override d'instance sur les icônes du nœud **root en édition** (no-op depuis Lot 2). Trace : le nœud instance n'a jamais eu `libraryComponentData` (`wwLibraryComponent` ne l'enregistre pas) et une instance ne stocke que ses overrides → un nœud instance ne reflète pas le binding du root (feature jamais implémentée, pas une régression). Décidé : ne pas ajouter cette feature ; ne refléter que la data interne du nœud (le badge « overwritten » signale l'override). → arg `libraryComponentData` retiré des 3 appels navigator + de la registration `useRegisterLocalInformation` ([wwElementComponent.vue:587](src/_front/components/wwElementComponent.vue#L587)). Plus aucun lecteur de `localInformation.libraryComponentData`. Chemin **rendu** conservé (`props.libraryComponentData`, `libraryComponentDataRef`, `parentInteractionsRef`).
- ✅ **Scan org weweb-assets `inject('componentStyle')`** (fait) : un seul vrai consommateur = `ww-input-multiselect` (`styles.cursor`) → sans `provide`, crash sur `undefined.cursor` (éditeur + publié). `ww-image` = prop legacy jamais alimentée (aspect-ratio géré par le compilateur, déjà fixé sur `WW-3544-style-compiler-css-vars`) ; `ww-input-select` `inherit-component-style` = attribut, pas l'inject. Fix `ww-input-multiselect` via le hook `css()` de ww-config (var `--component-cursor` émise par le compilateur, consommée en `var(--component-cursor, pointer)`) — même pattern que ww-image, PR [weweb-assets/ww-input-multiselect#85](https://github.com/weweb-assets/ww-input-multiselect/pull/85). Une fois ces assets mergés/publiés, le retrait de `provide('componentStyle')` (Lot 2) est sûr.
- ✅ **`@keyframes` responsive/states/instances** (fait, suite review) : le nom est désormais **slot-scopé** — `ww-keyframes-<surface.key sanitisé>-<state>-<breakpoint>` (getKeyframesName). `createAnimationNameDeclaration` **délègue à `createKeyframesRule`** → `animation-name` émis **exactement** quand un bloc l'est (même nom, même condition string-only). Comme `read()` est own-slot, chaque slot qui possède ses keyframes émet son bloc (dans le container `@media` pour les breakpoints) ; les autres héritent par cascade. Corrige : (a) collision entre instances de library override du même enfant (surface.key inclut le scopeKey d'instance) ; (b) keyframes hover/tablet/mobile ≠ base ; (c) keyframes dynamiques/formule → plus de `animation-name` orphelin (aucun bloc, aucun nom). **Pas de duplication** pour les objets répétés (compilateur par-uid, `componentId` runtime invisible) ni pour les instances library qui n'overrident pas les keyframes (bloc de définition partagé).
- **Passe manuelle éditeur/publié** de l'animation (pas encore faite).
