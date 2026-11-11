# Brief — Explorer : remplacer `direction` (drop helpers) pour s'en passer en JS

**Contexte** : Éditeur WeWeb, chantier « CSS pur » (branche `WW-3544`). Le compilateur de style
(`src/_common/helpers/styleCompiler/`) rend désormais tout le CSS de layout (display/flex/grid) via la
surface `.ww-layout`. On cherche à éliminer les valeurs de layout calculées en JS. Point précis à
explorer : **l'orientation des drop helpers (indicateurs de drop en drag&drop) dépend d'une valeur
`direction` calculée en JS — peut-on la remplacer par du CSS pur (ou au moins sans calcul JS) ?**

## État actuel (déjà en place)

- `direction` est fournie via `wwLayoutContext.direction`, calculée dans `wwLayout.vue` (`layoutDirection`)
  depuis la **donnée content** `_ww-layout_flexDirection` (+ `_ww-layout_reverse`), avec un « gate flex »
  via `layoutType` (lui-même via `componentDisplay`).
- Consommée dans `wwElementComponent.vue` (~133-157) :
  `<div class="ww-drop-helper start/end" :class="[wwLayoutContext.direction || 'row', ...]">`.
  Classes CSS `.row`/`.column` (CSS ~1015-1075) → barre verticale 2px (`.row`) ou horizontale 2px (`.column`).

## Faits clés (déjà audités)

1. **Les drop helpers sont téléportés** (`<teleport to="#component-overlays">`, `position:absolute`,
   positionnés par coordonnées JS via `elementRect`) → **hors du conteneur flex**. Donc pas d'`align-self`
   ni container-query possible : le CSS ne peut pas déduire la `flex-direction` du parent à travers le teleport.
2. **`direction` ne sert QU'au visuel** — jamais utilisée dans la logique de drop. Le ciblage se fait par
   **distance euclidienne 2D + attribut DOM `index`** dans `src/_common/editor/store/editorDragStore.js`
   (hit-test / `getClosestFrontDropTarget`). Donc on peut changer/supprimer `direction` sans risque fonctionnel.

## Pistes à explorer

- **(a) CSS pur** : rendre les drop helpers comme **enfants flex du conteneur** (au lieu du teleport) → impossible pour des raisons de performance (à challenger éventuellement, mais déjà pas mal d'étude de fait)
- **(b) `getComputedStyle(container).flexDirection`** au moment du drag (CSS-natif, pas de résolution JS ni
  de `componentDisplay`) — éditeur/drag-only.

## Fichiers

- `src/_front/components/wwElementComponent.vue` (template + CSS drop helpers)
- `src/_front/components/wwLayout.vue` (`layoutDirection`, `wwLayoutContext`, placeholder)
- `src/_common/editor/store/editorDragStore.js` (logique de drop — confirme que `direction` n'y sert pas)

## But

Supprimer le calcul JS de `direction` (idéalement solution CSS pure via piste (a)). `direction` est
**éditeur-only** (drop helpers dans blocs `wwEditor`, strippés du build publié).

## Conclusion (audit terminé) — optim abandonnée

La prémisse « `direction` ne sert QU'aux drop helpers » est **fausse**. Elle était vraie uniquement pour
la *logique de drop* (`editorDragStore.js` : hit-test 2D + attribut `index` — `direction` jamais lue,
confirmé). Mais `wwLayoutContext.direction` a un **2e consommateur, hors drag** :

- Enregistré dans `containerInformation` via `useRegisterLocalInformation`
  (`wwElementComponent.vue` ~592, `wwLibraryComponent.vue` ~332).
- Lu par le **panneau d'édition** de l'enfant sélectionné (`EditionSectionDisplay.vue`) :
  `alignChoices` (top/center/bottom vs left/center/right), warning « Width/Height might not be applied »,
  icônes grow/shrink de `wwEditorInputFlex.vue`.

Ce consommateur exige une valeur **réactive quand un enfant est sélectionné** (pas au drag). Donc :

- piste (b) « getComputedStyle **au drag** » (gate `isDraggingElement`) → valeur `undefined`/périmée
  pour le panneau ;
- un `computed` getComputedStyle **sans** dépendance réactive → mis en cache à la 1re lecture, jamais
  invalidé après édition → panneau périmé.

Le calcul content-based actuel (`wwLayout.vue` `layoutDirection`, via `getFlexDirection` + gate
`componentDisplay`) est donc **légitimement nécessaire** : c'est la seule source réactive qui alimente
correctement le panneau. Le retirer pour le seul bénéfice des drop helpers serait +de code, pas -, sans
gain net. **→ Optim abandonnée, aucun changement de code.**
