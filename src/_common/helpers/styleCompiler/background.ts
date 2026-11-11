import type { CssStyleRecord } from './types';
import { normalizeBackgroundImageValue } from './valueNormalization';
import { isStyleDynamicVariableReference } from './values';

const DEFAULT_BACKGROUND_ORDER = 'grad,img,col';
const BACKGROUND_LAYER_REQUIRED_SLOT_PROPERTIES = ['backgroundOrder', 'backgroundGradient', 'backgroundImage'];

type CompiledBackgroundDeclaration = {
    property: string;
    value: string;
    requiredSlotProperties: readonly string[];
};

/**
 * Converts WeWeb background data into CSS declarations.
 *
 * `background-image` still carries the ordered layer list, because gradient/image/color ordering is
 * the one part CSS cannot infer from independent longhands. Image-only options are emitted as
 * layer-aligned longhands so gradients and color-as-gradient layers keep their CSS defaults.
 */
export function getCompiledBackgroundDeclarations(style: CssStyleRecord, assetBaseUrl?: string) {
    const declarations: CompiledBackgroundDeclaration[] = [];
    const layers = getBackgroundImageLayers(style, assetBaseUrl);
    const backgroundLayerRequiredSlotProperties = getBackgroundLayerRequiredSlotProperties(style);
    const backgroundColor = getBackgroundColor(style);

    if (backgroundColor) {
        declarations.push({
            property: 'backgroundColor',
            value: backgroundColor,
            requiredSlotProperties: ['backgroundColor', 'backgroundOrder'],
        });
    } else {
        declarations.push({
            property: 'backgroundColor',
            value: 'transparent',
            requiredSlotProperties: ['backgroundColor', 'backgroundOrder'],
        });
    }

    if (!layers.length) {
        declarations.push({
            property: 'backgroundImage',
            value: 'none',
            requiredSlotProperties: backgroundLayerRequiredSlotProperties,
        });

        return declarations;
    }

    declarations.push({
        property: 'backgroundImage',
        value: layers.map(layer => layer.image).join(', '),
        requiredSlotProperties: backgroundLayerRequiredSlotProperties,
    });

    if (!layers.some(layer => layer.kind === 'image')) return declarations;

    declarations.push(
        {
            property: 'backgroundPositionX',
            value: layers.map(layer => layer.positionX).join(', '),
            requiredSlotProperties: [...backgroundLayerRequiredSlotProperties, 'backgroundPositionX'],
        },
        {
            property: 'backgroundPositionY',
            value: layers.map(layer => layer.positionY).join(', '),
            requiredSlotProperties: [...backgroundLayerRequiredSlotProperties, 'backgroundPositionY'],
        },
        {
            property: 'backgroundSize',
            value: layers.map(layer => layer.size).join(', '),
            requiredSlotProperties: [...backgroundLayerRequiredSlotProperties, 'backgroundSize'],
        },
        {
            property: 'backgroundRepeat',
            value: layers.map(layer => layer.repeat).join(', '),
            requiredSlotProperties: [...backgroundLayerRequiredSlotProperties, 'backgroundRepeat'],
        },
        {
            property: 'backgroundAttachment',
            value: layers.map(layer => layer.attachment).join(', '),
            requiredSlotProperties: [...backgroundLayerRequiredSlotProperties, 'backgroundAttachment'],
        }
    );

    return declarations;
}

/**
 * Serializes the legacy composite background value.
 *
 * Formula-bound background colors historically accepted any value valid in the `background`
 * shorthand, including gradients. Keep every effective layer in one declaration for that path so
 * runtime substitutions retain the same CSS grammar.
 */
export function getCompiledBackgroundShorthand(style: CssStyleRecord, assetBaseUrl?: string) {
    const backgroundImage = getBackgroundImage(style.backgroundImage, assetBaseUrl);
    const backgroundOrder = getBackgroundOrder(style);
    const isColorLast = backgroundOrder[2] === 'col';
    const layers: string[] = [];

    for (const layer of backgroundOrder) {
        if (layer === 'grad' && style.backgroundGradient) {
            layers.push(`${style.backgroundGradient}`);
            continue;
        }
        if (layer === 'col' && style.backgroundColor) {
            const color = `${style.backgroundColor}`;
            layers.push(isColorLast ? color : `linear-gradient(0deg, ${color}, ${color})`);
            continue;
        }
        if (layer !== 'img' || !backgroundImage) continue;

        layers.push(
            [
                backgroundImage,
                `${getBackgroundPosition(style.backgroundPositionX)} ${getBackgroundPosition(style.backgroundPositionY)}`,
                `/ ${style.backgroundSize || 'cover'}`,
                `${style.backgroundRepeat || 'no-repeat'}`,
                getBackgroundAttachment(style.backgroundAttachment),
            ].join(' ')
        );
    }

    return layers.join(', ') || 'none';
}

type BackgroundImageLayer = {
    kind: 'gradient' | 'image' | 'color';
    image: string;
    positionX: string;
    positionY: string;
    size: string;
    repeat: string;
    attachment: string;
};

function getBackgroundImageLayers(style: CssStyleRecord, assetBaseUrl?: string): BackgroundImageLayer[] {
    const backgroundImage = getBackgroundImage(style.backgroundImage, assetBaseUrl);
    const backgroundOrder = getBackgroundOrder(style);
    const isColorLast = backgroundOrder[2] === 'col';
    const layers: BackgroundImageLayer[] = [];

    for (const bgOrder of backgroundOrder) {
        switch (bgOrder) {
            case 'grad':
                if (style.backgroundGradient) {
                    layers.push(createDefaultBackgroundLayer('gradient', `${style.backgroundGradient}`));
                }
                break;
            case 'col':
                if (style.backgroundColor && !isColorLast) {
                    layers.push(
                        createDefaultBackgroundLayer(
                            'color',
                            `linear-gradient(0deg, ${style.backgroundColor}, ${style.backgroundColor})`
                        )
                    );
                }
                break;
            case 'img':
                if (backgroundImage) {
                    layers.push({
                        kind: 'image',
                        image: backgroundImage,
                        positionX: getBackgroundPosition(style.backgroundPositionX),
                        positionY: getBackgroundPosition(style.backgroundPositionY),
                        size: `${style.backgroundSize || 'cover'}`,
                        repeat: `${style.backgroundRepeat || 'no-repeat'}`,
                        attachment: getBackgroundAttachment(style.backgroundAttachment),
                    });
                }
                break;
            default:
                break;
        }
    }

    return layers;
}

function createDefaultBackgroundLayer(
    kind: Exclude<BackgroundImageLayer['kind'], 'image'>,
    image: string
): BackgroundImageLayer {
    return {
        kind,
        image,
        positionX: '0%',
        positionY: '0%',
        size: 'auto',
        repeat: 'repeat',
        attachment: 'scroll',
    };
}

function getBackgroundColor(style: CssStyleRecord) {
    const backgroundOrder = getBackgroundOrder(style);
    if (backgroundOrder[2] !== 'col') return null;
    if (!style.backgroundColor) return null;

    return `${style.backgroundColor}`;
}

function getBackgroundLayerRequiredSlotProperties(style: CssStyleRecord) {
    const requiredSlotProperties = [...BACKGROUND_LAYER_REQUIRED_SLOT_PROPERTIES];
    const backgroundOrder = getBackgroundOrder(style);
    if (backgroundOrder[2] !== 'col') requiredSlotProperties.push('backgroundColor');

    return requiredSlotProperties;
}

function getBackgroundOrder(style: CssStyleRecord) {
    return `${style.backgroundOrder || DEFAULT_BACKGROUND_ORDER}`.split(',');
}

/**
 * Normalizes a background image value to CSS `url(...)` syntax.
 */
function getBackgroundImage(backgroundImage: unknown, assetBaseUrl?: string) {
    if (isStyleDynamicVariableReference(backgroundImage)) return `${backgroundImage}`;
    if (typeof backgroundImage !== 'string' || !backgroundImage) return undefined;
    const isDynamicVariable =
        backgroundImage.startsWith('var(--ww-style-') || backgroundImage.startsWith('var(--ww-content-');
    if (isDynamicVariable) {
        return backgroundImage;
    }
    return `${normalizeBackgroundImageValue(backgroundImage, assetBaseUrl)}`;
}

/**
 * Normalizes WeWeb neutral background-position values to CSS keywords.
 */
function getBackgroundPosition(value: unknown) {
    // WeWeb uses `auto` as a neutral position value; CSS background-position needs a real keyword.
    return `${value === 'auto' ? 'center' : value || 'center'}`;
}

function getBackgroundAttachment(value: unknown) {
    return `${value === 'unset' ? 'scroll' : value || 'scroll'}`;
}
