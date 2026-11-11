<template>
    <wwTextContent
        v-if="displayContent"
        v-bind="$attrs"
        :text="sanitizedText"
        :style="style"
        ww-responsive="ww-text-content"
        :tag="tag"
        :class="textClass"
        :links="links"
    ></wwTextContent>
 </template>

<script>
import { escape } from 'html-escaper';
import wwTextContent from './wwTextContent.vue';
 
export default {
    components: {
        wwTextContent,
     },
    inheritAttrs: false,
    props: {
        modelValue: [Object, String],
        textStyle: Object,
        textClass: String,
        disabled: Boolean,
        tag: { type: String, default: 'div' },
        updateLinks: { type: Function },
        links: { type: Object },
        sanitize: { type: Boolean, default: false },
    },
    emits: ['add-link', 'remove-link', 'textbar-visibility-changed', 'update:modelValue'],
    computed: {
        text() {
            return `${wwLib.wwLang.getText(this.modelValue)}`;
        },
        sanitizedText() {
            return this.sanitize ? escape(this.text) : this.text;
        },
        style() {
            return this.textStyle || {};
        },
        displayContent() {
             // eslint-disable-next-line no-unreachable
            return true;
        },
    },
    methods: {
     },
};
</script>

<style lang="scss" scoped>
@layer ww-style-core {
    .ww-editable-text {
        display: block;
        min-width: 5px;
        overflow-wrap: break-word;
        -webkit-line-break: after-white-space;
        outline: none;
    }
    h1,
    h2,
    h3,
    h4 {
        font-size: inherit;
        font-weight: inherit;
        margin: 0;
    }
    p {
        margin: 0;
    }
}
</style>

<style lang="scss">
@layer ww-style-core {
    .ww-editable-text {
        ol,
        ul {
            margin: 0;
        }

        a {
            text-decoration: none;
            color: inherit;
        }
        p {
            margin: 0;
            white-space: pre-wrap;
        }
    }
}

 </style>
