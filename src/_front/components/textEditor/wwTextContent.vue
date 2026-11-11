<script>
import { h, resolveComponent } from 'vue';
import TextLink from './TextLink.vue';
import { renderMode } from '@/_front/rendering/renderMode';
import {
    assertRichTextStaticRenderingSafe,
    createNormalizedRichTextContent,
    isNativeRichTextRootTag,
} from '@/_front/rendering/richTextStaticRendering';

function createNode(node, options) {
    const nodeName = node.nodeName.toLowerCase();
    if (nodeName === '#comment') {
        return;
    }
    if (nodeName === '#text') {
        return node.textContent;
    }
    if (nodeName === 'script') {
        return null;
    }
    const children = Array.from(node.childNodes)
        .map(child => createNode(child, options))
        .filter(n => !!n);
    let attrs = {};
    if (node.attributes) {
        for (let a of node.attributes) {
            if (!a.nodeName.includes('data-ww-link')) {
                attrs[a.nodeName] = a.nodeValue;
            }
        }
    }
    if (node.hasAttribute('data-ww-link-id')) {
        return h(
            TextLink,
            {
                link: options.links[node.getAttribute('data-ww-link-id')],
                ...attrs,
            },
            { default: () => children }
        );
    }
    return h(nodeName, attrs, children);
}

export default {
    props: {
        text: { type: String, required: true },
        links: { type: Object, default: () => ({}) },
        tag: { type: String, default: 'div' },
    },
    computed: {
        isEditing() {
             // eslint-disable-next-line no-unreachable
            return false;
        },
    },
    render() {
        const contentText = createNormalizedRichTextContent(this.text, document);
        assertRichTextStaticRenderingSafe({
            mode: renderMode,
            rootTag: this.tag,
            content: contentText,
        });

        const children = Array.from(contentText.childNodes)
            .map(child =>
                createNode(child, {
                    links: this.links,
                    isEditing: this.isEditing,
                })
            )
            .filter(n => !!n);

        const component = isNativeRichTextRootTag(this.tag) ? this.tag : resolveComponent(this.tag);

        return h(
            component,
            {
                class: {
                    'ww-text-content': true,
                    editing: this.isEditing,
                },
                type: this.tag === 'button' ? 'button' : null,
            },
            children
        );
    },
};
</script>

<style lang="scss" scoped>
@layer ww-style-core {
    .ww-text-content {
        // Transition inherited from the text CSS contract (--ww-element-transition set on .ww-<uid>).
        // Lets the text animate on state changes even when the text node isn't the uid-classed node
        // (e.g. the span inside ww-button). No var set => invalid => transition falls back to none.
        transition: var(--ww-element-transition, none);
        background-color: var(--ww-text-background-color, transparent);
        overflow: var(--ww-text-overflow, initial);
        text-overflow: var(--ww-text-text-overflow, initial);
        white-space: var(--ww-text-white-space, initial);
    }
    a {
        display: inline;
    }
}
 </style>
