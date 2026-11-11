import { bench, describe } from 'vitest';
import { effectScope, nextTick, reactive, watchEffect } from 'vue';

import {
    createElementSelector,
    createStringStyleSheetAdapter,
    createStyleCompiler,
    STATIC_STYLE_RUNTIME,
    type StyleBreakpointPropertyReader,
    type StyleClassReader,
    type StyleKeyframesRule,
    type StyleLayerRule,
    type StyleLayerStatementRule,
    type StyleMediaRule,
    type StyleReactivityRuntime,
    type StyleReader,
    type StyleRule,
    type StyleRuleAdapter,
    type StyleRuleContainerAdapter,
    type StyleSectionReader,
    type StyleStyleRule,
    type StyleStyleRuleAdapter,
    type StyleStateReader,
} from './index';

type SourceData = {
    uid: string;
    states: string[];
    classIds: Record<string, string[]>;
    subClassIds: Record<string, Record<string, string[]>>;
    styles: Record<string, Record<string, Record<string, unknown>>>;
    content?: Record<string, Record<string, Record<string, unknown>>>;
};

type BenchData = {
    elements: Record<string, SourceData>;
    sections: Record<string, SourceData>;
    classes: Record<string, SourceData & { subClasses: Record<string, SourceData> }>;
    scope: {
        elementUids: string[];
        sectionUids: string[];
        libraryComponentIds: string[];
    };
};

type BenchCase = {
    label: string;
    elements: number;
    sections: number;
    classes: number;
};

type CompilerRun = {
    stop(): void;
};

type HotUpdateHarness = {
    data: BenchData;
    run: CompilerRun;
    targetElementUid: string;
    propertyIteration: number;
    classIteration: number;
};

type StructuralHarness = {
    data: BenchData;
    run: CompilerRun;
    nextUid: number;
};

type MemorySnapshot = {
    heapMb: number;
    rssMb: number;
};

type MemorySample = {
    before: MemorySnapshot;
    after: MemorySnapshot;
};

const STATIC_CASES: BenchCase[] = [
    { label: '250 elements / 25 sections', elements: 250, sections: 25, classes: 25 },
    { label: '1k elements / 50 sections', elements: 1_000, sections: 50, classes: 40 },
    { label: '5k elements / 200 sections', elements: 5_000, sections: 200, classes: 80 },
];

const REACTIVE_CASES: BenchCase[] = [
    { label: '250 elements / 25 sections', elements: 250, sections: 25, classes: 25 },
    { label: '1k elements / 50 sections', elements: 1_000, sections: 50, classes: 40 },
    { label: '5k elements / 200 sections', elements: 5_000, sections: 200, classes: 80 },
];

for (const benchCase of STATIC_CASES) {
    describe(`style compiler static ${benchCase.label}`, () => {
        const countingMemory = createMemoryRecorder(`static-counting ${benchCase.label}`);
        bench(
            'full static compile, no CSS string serialization',
            () => {
                countingMemory.beforeSample();
                const data = createBenchData(benchCase);
                const stylesheet = createCountingStyleSheetAdapter();
                const run = createStyleCompiler().compileStylesheet({
                    scope: data.scope,
                    reader: createReader(data),
                    stylesheet,
                    runtime: STATIC_STYLE_RUNTIME,
                });
                consume(stylesheet.result());
                countingMemory.afterSample();
                run.stop();
            },
            createMemoryBenchOptions(countingMemory, getStaticFullRenderBenchOptions(benchCase))
        );

        const serializationMemory = createMemoryRecorder(`static-string ${benchCase.label}`);
        bench(
            'full static compile + CSS string serialization',
            () => {
                serializationMemory.beforeSample();
                const data = createBenchData(benchCase);
                const stylesheet = createStringStyleSheetAdapter();
                const run = createStyleCompiler().compileStylesheet({
                    scope: data.scope,
                    reader: createReader(data),
                    stylesheet,
                    runtime: STATIC_STYLE_RUNTIME,
                });
                consume(stylesheet.result().length);
                serializationMemory.afterSample();
                run.stop();
            },
            createMemoryBenchOptions(serializationMemory, getStaticFullRenderBenchOptions(benchCase))
        );
    });
}

for (const benchCase of REACTIVE_CASES) {
    describe(`style compiler reactive ${benchCase.label}`, () => {
        const initialMemory = createMemoryRecorder(`reactive-initial ${benchCase.label}`);
        bench(
            'full reactive initial compile',
            async () => {
                initialMemory.beforeSample();
                const data = reactive(createBenchData(benchCase)) as BenchData;
                const stylesheet = createCountingStyleSheetAdapter();
                const run = createStyleCompiler().compileStylesheet({
                    scope: data.scope,
                    reader: createReader(data),
                    stylesheet,
                    runtime: createVueBenchmarkRuntime(),
                    mode: 'editor',
                });
                await nextTick();
                consume(stylesheet.result());
                initialMemory.afterSample();
                run.stop();
            },
            createMemoryBenchOptions(initialMemory, getFullRenderBenchOptions(benchCase))
        );

        describe('initialized compiler hot updates', () => {
            let propertyHarness: HotUpdateHarness | null = null;
            const propertyMemory = createMemoryRecorder(`reactive-property ${benchCase.label}`);
            bench(
                'reactive property change',
                async () => {
                    const current = getHotUpdateHarness(propertyHarness);
                    propertyMemory.beforeSample();
                    current.data.elements[current.targetElementUid].styles.base.default.width = `${
                        240 + current.propertyIteration++
                    }px`;
                    await nextTick();
                    propertyMemory.afterSample();
                },
                createHotUpdateBenchOptions({
                    benchCase,
                    memory: propertyMemory,
                    getHarness: () => propertyHarness,
                    setHarness: harness => {
                        propertyHarness = harness;
                    },
                    benchOptions: getHotUpdateBenchOptions('property', benchCase),
                })
            );

            let classHarness: HotUpdateHarness | null = null;
            const classMemory = createMemoryRecorder(`reactive-class ${benchCase.label}`);
            bench(
                'reactive class change',
                async () => {
                    const current = getHotUpdateHarness(classHarness);
                    classMemory.beforeSample();
                    current.data.elements[current.targetElementUid].classIds.base = [
                        current.classIteration++ % 2 ? 'class-1' : 'class-2',
                    ];
                    await nextTick();
                    classMemory.afterSample();
                },
                createHotUpdateBenchOptions({
                    benchCase,
                    memory: classMemory,
                    getHarness: () => classHarness,
                    setHarness: harness => {
                        classHarness = harness;
                    },
                    benchOptions: getHotUpdateBenchOptions('class', benchCase),
                })
            );

            let reorderHarness: HotUpdateHarness | null = null;
            const reorderMemory = createMemoryRecorder(`reactive-reorder ${benchCase.label}`);
            bench(
                'reactive element reorder',
                async () => {
                    const current = getHotUpdateHarness(reorderHarness);
                    reorderMemory.beforeSample();
                    current.data.scope.elementUids.reverse();
                    await nextTick();
                    reorderMemory.afterSample();
                },
                createHotUpdateBenchOptions({
                    benchCase,
                    memory: reorderMemory,
                    getHarness: () => reorderHarness,
                    setHarness: harness => {
                        reorderHarness = harness;
                    },
                    benchOptions: getHotUpdateBenchOptions('structural', benchCase),
                })
            );
        });

        describe('initialized compiler structural updates', () => {
            let addHarness: StructuralHarness | null = null;
            const addMemory = createMemoryRecorder(`reactive-add ${benchCase.label}`);
            bench(
                'reactive add one element',
                async () => {
                    const current = getStructuralHarness(addHarness);
                    const uid = `added-element-${current.nextUid++}`;
                    const classId = `class-${current.nextUid % benchCase.classes}`;
                    const subClassId = `sub-${current.nextUid % benchCase.classes}`;

                    addMemory.beforeSample();
                    current.data.elements[uid] = createElementData(uid, current.nextUid, classId, subClassId);
                    current.data.scope.elementUids.push(uid);
                    await nextTick();
                    addMemory.afterSample();
                },
                createStructuralBenchOptions({
                    benchCase,
                    memory: addMemory,
                    getHarness: () => addHarness,
                    setHarness: harness => {
                        addHarness = harness;
                    },
                })
            );

            let removeHarness: StructuralHarness | null = null;
            const removeMemory = createMemoryRecorder(`reactive-remove ${benchCase.label}`);
            bench(
                'reactive remove one element',
                async () => {
                    const current = getStructuralHarness(removeHarness);
                    const uid = current.data.scope.elementUids.pop();
                    if (!uid) return;

                    removeMemory.beforeSample();
                    delete current.data.elements[uid];
                    await nextTick();
                    removeMemory.afterSample();
                },
                createStructuralBenchOptions({
                    benchCase,
                    memory: removeMemory,
                    getHarness: () => removeHarness,
                    setHarness: harness => {
                        removeHarness = harness;
                    },
                })
            );
        });
    });
}

describe('style compiler reactive GoodNow structural updates', () => {
    let popupHarness: StructuralHarness | null = null;
    const popupMemory = createMemoryRecorder('reactive-popup GoodNow 14.5k / 3.7k active');
    bench(
        'popup-like open and close with 14.5k project elements',
        async () => {
            const current = getStructuralHarness(popupHarness);
            const uid = `popup-element-${current.nextUid++}`;

            popupMemory.beforeSample();
            current.data.elements[uid] = createMinimalElementData(uid);
            current.data.scope.elementUids.push(uid);
            await nextTick();
            current.data.scope.elementUids.pop();
            delete current.data.elements[uid];
            await nextTick();
            popupMemory.afterSample();
        },
        createGoodNowStructuralBenchOptions({
            memory: popupMemory,
            getHarness: () => popupHarness,
            setHarness: harness => {
                popupHarness = harness;
            },
        })
    );

    let pasteHarness: StructuralHarness | null = null;
    const pasteMemory = createMemoryRecorder('reactive-paste GoodNow 14.5k / 3.7k active');
    bench(
        'paste three elements with 14.5k project elements',
        async () => {
            const current = getStructuralHarness(pasteHarness);

            pasteMemory.beforeSample();
            for (let index = 0; index < 3; index += 1) {
                const uid = `pasted-element-${current.nextUid++}`;
                current.data.elements[uid] = createMinimalElementData(uid);
                current.data.scope.elementUids.push(uid);
            }
            await nextTick();
            pasteMemory.afterSample();
        },
        createGoodNowStructuralBenchOptions({
            memory: pasteMemory,
            getHarness: () => pasteHarness,
            setHarness: harness => {
                pasteHarness = harness;
            },
        })
    );
});

function getFullRenderBenchOptions(benchCase: BenchCase) {
    if (benchCase.elements >= 1_000) {
        return { iterations: 2, time: 100, warmupIterations: 0, warmupTime: 0 };
    }

    return { iterations: 3, time: 100, warmupIterations: 0, warmupTime: 0 };
}

function getStaticFullRenderBenchOptions(benchCase: BenchCase) {
    if (benchCase.elements >= 5_000) {
        return { iterations: 4, time: 100, warmupIterations: 0, warmupTime: 0 };
    }

    if (benchCase.elements >= 1_000) {
        return { iterations: 4, time: 100, warmupIterations: 0, warmupTime: 0 };
    }

    return { iterations: 5, time: 100, warmupIterations: 0, warmupTime: 0 };
}

function getHotUpdateBenchOptions(type: 'property' | 'class' | 'structural', benchCase: BenchCase) {
    if (type === 'structural') {
        return { iterations: benchCase.elements >= 1_000 ? 2 : 3, time: 1, warmupIterations: 0, warmupTime: 0 };
    }

    return {
        iterations: benchCase.elements >= 1_000 ? 10 : 20,
        time: benchCase.elements >= 1_000 ? 50 : 100,
        warmupIterations: 1,
        warmupTime: 0,
    };
}

function createMemoryBenchOptions(memory: MemoryRecorder, benchOptions: Record<string, number>) {
    return {
        ...benchOptions,
        setup(_task: unknown, mode: 'warmup' | 'run') {
            runGc();
            memory.recordSetup(mode);
        },
        teardown(_task: unknown, mode: 'warmup' | 'run') {
            runGc();
            memory.print(mode);
        },
    };
}

function createHotUpdateBenchOptions({
    benchCase,
    memory,
    getHarness,
    setHarness,
    benchOptions,
}: {
    benchCase: BenchCase;
    memory: MemoryRecorder;
    getHarness(): HotUpdateHarness | null;
    setHarness(harness: HotUpdateHarness | null): void;
    benchOptions: Record<string, number>;
}) {
    return {
        ...benchOptions,
        async setup(_task: unknown, mode: 'warmup' | 'run') {
            runGc();
            setHarness(createHotUpdateHarness(benchCase));
            await nextTick();
            memory.recordSetup(mode);
        },
        async teardown(_task: unknown, mode: 'warmup' | 'run') {
            getHarness()?.run.stop();
            setHarness(null);
            await nextTick();
            runGc();
            memory.print(mode);
        },
    };
}

function createStructuralBenchOptions({
    benchCase,
    memory,
    getHarness,
    setHarness,
}: {
    benchCase: BenchCase;
    memory: MemoryRecorder;
    getHarness(): StructuralHarness | null;
    setHarness(harness: StructuralHarness | null): void;
}) {
    return {
        iterations: benchCase.elements >= 1_000 ? 2 : 3,
        time: 1,
        warmupIterations: 0,
        warmupTime: 0,
        async setup(_task: unknown, mode: 'warmup' | 'run') {
            runGc();
            setHarness(createStructuralHarness(benchCase));
            await nextTick();
            memory.recordSetup(mode);
        },
        async teardown(_task: unknown, mode: 'warmup' | 'run') {
            getHarness()?.run.stop();
            setHarness(null);
            await nextTick();
            runGc();
            memory.print(mode);
        },
    };
}

function createGoodNowStructuralBenchOptions({
    memory,
    getHarness,
    setHarness,
}: {
    memory: MemoryRecorder;
    getHarness(): StructuralHarness | null;
    setHarness(harness: StructuralHarness | null): void;
}) {
    return {
        iterations: 5,
        time: 10,
        warmupIterations: 1,
        warmupTime: 0,
        async setup(_task: unknown, mode: 'warmup' | 'run') {
            runGc();
            setHarness(createGoodNowStructuralHarness());
            await nextTick();
            memory.recordSetup(mode);
        },
        async teardown(_task: unknown, mode: 'warmup' | 'run') {
            getHarness()?.run.stop();
            setHarness(null);
            await nextTick();
            runGc();
            memory.print(mode);
        },
    };
}

function createHotUpdateHarness(benchCase: BenchCase): HotUpdateHarness {
    const data = reactive(createBenchData(benchCase)) as BenchData;
    const stylesheet = createCountingStyleSheetAdapter();
    const run = createStyleCompiler().compileStylesheet({
        scope: data.scope,
        reader: createReader(data),
        stylesheet,
        runtime: createVueBenchmarkRuntime(),
        mode: 'editor',
    });

    return {
        data,
        run,
        targetElementUid: data.scope.elementUids[Math.floor(data.scope.elementUids.length / 2)],
        propertyIteration: 0,
        classIteration: 0,
    };
}

function createStructuralHarness(benchCase: BenchCase): StructuralHarness {
    const data = reactive(createBenchData(benchCase)) as BenchData;
    const stylesheet = createCountingStyleSheetAdapter();
    const run = createStyleCompiler().compileStylesheet({
        scope: data.scope,
        reader: createReader(data),
        stylesheet,
        runtime: createVueBenchmarkRuntime(),
        mode: 'editor',
    });

    return { data, run, nextUid: benchCase.elements };
}

function createGoodNowStructuralHarness(): StructuralHarness {
    const projectElementCount = 14_500;
    const activeElementCount = 3_718;
    const data: BenchData = reactive({
        elements: {},
        sections: {},
        classes: {},
        scope: {
            elementUids: [],
            sectionUids: [],
            libraryComponentIds: [],
        },
    }) as BenchData;

    for (let index = 0; index < projectElementCount; index += 1) {
        const uid = `element-${index}`;
        data.elements[uid] = createMinimalElementData(uid);
        if (index < activeElementCount) data.scope.elementUids.push(uid);
    }

    const stylesheet = createCountingStyleSheetAdapter();
    const run = createStyleCompiler().compileStylesheet({
        scope: data.scope,
        reader: createReader(data),
        stylesheet,
        runtime: createVueBenchmarkRuntime(),
        mode: 'editor',
    });

    return { data, run, nextUid: projectElementCount };
}

function getHotUpdateHarness(harness: HotUpdateHarness | null) {
    if (!harness) throw new Error('Missing hot update benchmark harness.');
    return harness;
}

function getStructuralHarness(harness: StructuralHarness | null) {
    if (!harness) throw new Error('Missing structural benchmark harness.');
    return harness;
}

type MemoryRecorder = ReturnType<typeof createMemoryRecorder>;

function createMemoryRecorder(label: string) {
    const samples: MemorySample[] = [];
    let setup: MemorySnapshot | null = null;
    let currentBefore: MemorySnapshot | null = null;
    let isRecording = false;

    return {
        recordSetup(mode: 'warmup' | 'run') {
            isRecording = mode === 'run';
            setup = isRecording ? readMemory() : null;
            samples.length = 0;
            currentBefore = null;
        },
        beforeSample() {
            if (!isRecording) return;
            currentBefore = readMemory();
        },
        afterSample() {
            if (!isRecording) return;
            if (!currentBefore) return;
            samples.push({ before: currentBefore, after: readMemory() });
            currentBefore = null;
        },
        print(mode: 'warmup' | 'run') {
            if (!isRecording || mode !== 'run') return;
            if (!samples.length) return;

            const afterCleanup = readMemory();
            const afterHeap = samples.map(sample => sample.after.heapMb);
            const afterRss = samples.map(sample => sample.after.rssMb);
            const deltaHeap = samples.map(sample => sample.after.heapMb - sample.before.heapMb);
            const deltaRss = samples.map(sample => sample.after.rssMb - sample.before.rssMb);

            console.log(
                `STYLE_COMPILER_BENCH_MEMORY ${JSON.stringify({
                    label,
                    samples: samples.length,
                    setupHeapMb: setup?.heapMb ?? null,
                    setupRssMb: setup?.rssMb ?? null,
                    meanAfterHeapMb: mean(afterHeap),
                    peakAfterHeapMb: max(afterHeap),
                    meanAfterRssMb: mean(afterRss),
                    peakAfterRssMb: max(afterRss),
                    meanDeltaHeapMb: mean(deltaHeap),
                    peakDeltaHeapMb: max(deltaHeap),
                    meanDeltaRssMb: mean(deltaRss),
                    peakDeltaRssMb: max(deltaRss),
                    afterCleanupHeapMb: afterCleanup.heapMb,
                    afterCleanupRssMb: afterCleanup.rssMb,
                })}`
            );
            isRecording = false;
        },
    };
}

function readMemory(): MemorySnapshot {
    const memory = process.memoryUsage();

    return {
        heapMb: toMegabytes(memory.heapUsed),
        rssMb: toMegabytes(memory.rss),
    };
}

function toMegabytes(bytes: number) {
    return Number((bytes / 1024 / 1024).toFixed(2));
}

function mean(values: number[]) {
    if (!values.length) return null;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function max(values: number[]) {
    if (!values.length) return null;
    return Number(Math.max(...values).toFixed(2));
}

function runGc() {
    (globalThis as typeof globalThis & { gc?: () => void }).gc?.();
}

function createVueBenchmarkRuntime(): StyleReactivityRuntime {
    return {
        createScope() {
            return effectScope();
        },
        effect: watchEffect,
    };
}

function createBenchData({
    elements,
    sections,
    classes,
}: {
    elements: number;
    sections: number;
    classes: number;
}): BenchData {
    const data: BenchData = {
        elements: {},
        sections: {},
        classes: {},
        scope: {
            elementUids: [],
            sectionUids: [],
            libraryComponentIds: [],
        },
    };

    for (let index = 0; index < classes; index++) {
        const classId = `class-${index}`;
        const subClassId = `sub-${index}`;
        data.classes[classId] = {
            uid: classId,
            states: ['_wwHover'],
            classIds: { base: [] },
            subClassIds: { base: {} },
            styles: createStyleRecord(index, { classMultiplier: 1 }),
            subClasses: {
                [subClassId]: {
                    uid: subClassId,
                    states: [],
                    classIds: { base: [] },
                    subClassIds: { base: {} },
                    styles: createStyleRecord(index, { classMultiplier: 2 }),
                },
            },
        };
    }

    for (let index = 0; index < elements; index++) {
        const uid = `element-${index}`;
        const classId = `class-${index % classes}`;
        const subClassId = `sub-${index % classes}`;
        data.scope.elementUids.push(uid);
        data.elements[uid] = createElementData(uid, index, classId, subClassId);
    }

    for (let index = 0; index < sections; index++) {
        const uid = `section-${index}`;
        const classId = `class-${index % classes}`;
        const subClassId = `sub-${index % classes}`;
        data.scope.sectionUids.push(uid);
        data.sections[uid] = {
            uid,
            states: ['_wwHover'],
            classIds: { base: [classId] },
            subClassIds: { base: { [classId]: [subClassId] } },
            styles: createStyleRecord(index + elements),
        };
    }

    return data;
}

function createElementData(uid: string, index: number, classId: string, subClassId: string): SourceData {
    return {
        uid,
        states: ['_wwHover'],
        classIds: { base: [classId], _wwHover: [classId] },
        subClassIds: { base: { [classId]: [subClassId] }, _wwHover: { [classId]: [subClassId] } },
        styles: createStyleRecord(index),
    };
}

function createMinimalElementData(uid: string): SourceData {
    return {
        uid,
        states: [],
        classIds: { base: [] },
        subClassIds: { base: {} },
        styles: {},
    };
}

function createStyleRecord(seed: number, { classMultiplier = 0 } = {}) {
    const base = seed + classMultiplier * 10_000;

    return {
        base: {
            default: {
                display: base % 7 === 0 ? 'flex' : 'block',
                width: `${100 + (base % 300)}px`,
                height: `${40 + (base % 120)}px`,
                minWidth: `${base % 32}px`,
                maxWidth: `${400 + (base % 500)}px`,
                minHeight: `${base % 24}px`,
                maxHeight: `${200 + (base % 400)}px`,
                margin: `${base % 24}px`,
                padding: `${base % 20}px`,
                overflow: base % 3 === 0 ? 'hidden' : 'visible',
                zIndex: `${base % 10}`,
                opacity: `${0.5 + (base % 50) / 100}`,
                border: '1px solid #000',
                borderRadius: `${base % 16}px`,
                boxShadow: '0 1px 2px rgba(0,0,0,.2)',
                transition: 'all .2s ease',
                transform: base % 5 === 0 ? 'translateX(1px)' : '',
                backgroundColor: `rgb(${base % 255}, ${(base * 3) % 255}, ${(base * 7) % 255})`,
                backgroundOrder: 'col',
                cursor: 'pointer',
                customCss: {
                    '--bench-seed': `${base}`,
                },
            },
            tablet: {
                width: `${80 + (base % 200)}px`,
                padding: `${base % 16}px`,
            },
            mobile: {
                width: `${60 + (base % 160)}px`,
                margin: `${base % 12}px`,
            },
        },
        _wwHover: {
            default: {
                opacity: `${0.7 + (base % 20) / 100}`,
                transform: 'translateY(-1px)',
            },
            tablet: {
                width: `${90 + (base % 180)}px`,
            },
        },
    };
}

function createReader(data: BenchData): StyleReader {
    return {
        element(uid) {
            const source = data.elements[uid];
            return source ? createElementReader(source) : null;
        },
        section(uid) {
            const source = data.sections[uid];
            return source ? createSectionReader(source) : null;
        },
        libraryComponent() {
            return null;
        },
        styleClass(id) {
            const source = data.classes[id];
            return source ? createClassReader(source) : null;
        },
    };
}

function createElementReader(data: SourceData) {
    return {
        ...createSourceReader(data, 'element'),
        kind: () => 'element' as const,
        isDirectSectionChild: () => false,
    };
}

function createSectionReader(data: SourceData): StyleSectionReader {
    return {
        ...createSourceReader(data, 'section'),
        kind: () => 'section',
    };
}

function createSourceReader(data: SourceData, kind: 'element' | 'section') {
    return {
        uid: () => data.uid,
        baseId: () => undefined,
        states: () => data.states.map(id => ({ id })),
        parentRef: () => null,
        selector: () => (kind === 'element' ? createElementSelector(data.uid) : undefined),
        style: () => createPropertyTreeReader(data, 'styles'),
        content: () => createPropertyTreeReader(data, 'content'),
    };
}

function createClassReader(data: SourceData & { subClasses: Record<string, SourceData> }): StyleClassReader {
    return {
        style: () => createPropertyTreeReader(data, 'styles'),
        content: () => createPropertyTreeReader(data, 'content'),
        subClass(id) {
            const subClass = data.subClasses[id];
            return subClass ? createClassReader({ ...subClass, subClasses: {} }) : null;
        },
    };
}

function createPropertyTreeReader(data: SourceData, domain: 'styles' | 'content') {
    return {
        state: (name: string) => createStateReader(data, domain, name),
    };
}

function createStateReader(data: SourceData, domain: 'styles' | 'content', state: string): StyleStateReader {
    return {
        classIds: () => data.classIds[state] || [],
        subClassIds: classId => data.subClassIds[state]?.[classId] || [],
        breakpoint: breakpoint => createBreakpointReader(data[domain]?.[state]?.[breakpoint] || {}),
    };
}

function createBreakpointReader(style: Record<string, unknown>): StyleBreakpointPropertyReader {
    return {
        property: name => style[name],
        customCss: () => style.customCss,
        customCssProperty(name) {
            const customCss = style.customCss;
            if (!customCss || typeof customCss !== 'object' || Array.isArray(customCss)) return undefined;
            return (customCss as Record<string, unknown>)[name];
        },
        customCssEntries() {
            const customCss = style.customCss;
            if (!customCss || typeof customCss !== 'object' || Array.isArray(customCss)) return [];
            return Object.entries(customCss as Record<string, unknown>);
        },
    };
}

function createCountingStyleSheetAdapter() {
    const entries = new Map<string, Map<string, string>>();
    const atomicClassReferences = new Map<string, number>();
    const root = createCountingRuleContainerAdapter(entries);

    return {
        insertRule: root.insertRule,
        dispose: root.dispose,
        atomicClass(assignment) {
            const key = `${assignment.sourceUid}\u001f${assignment.surfaceKind}\u001f${assignment.className}`;
            atomicClassReferences.set(key, (atomicClassReferences.get(key) || 0) + 1);
            let active = true;

            return () => {
                if (!active) return;
                active = false;
                const nextReferences = (atomicClassReferences.get(key) || 1) - 1;
                if (nextReferences > 0) atomicClassReferences.set(key, nextReferences);
                else atomicClassReferences.delete(key);
            };
        },
        result() {
            return entries.size + atomicClassReferences.size;
        },
    };
}

function createCountingRuleContainerAdapter(
    entries: Map<string, Map<string, string>>,
    keyPrefix = 'root'
): StyleRuleContainerAdapter {
    function insertRule(rule: StyleLayerStatementRule): StyleRuleAdapter;
    function insertRule(rule: StyleLayerRule): StyleRuleContainerAdapter;
    function insertRule(rule: StyleMediaRule): StyleRuleContainerAdapter;
    function insertRule(rule: StyleStyleRule): StyleStyleRuleAdapter;
    function insertRule(rule: StyleKeyframesRule): StyleRuleAdapter;
    function insertRule(rule: StyleRule) {
        if (rule.kind === 'layer-statement' || rule.kind === 'keyframes') return { dispose() {} };
        if (rule.kind === 'layer' || rule.kind === 'media') {
            return createCountingRuleContainerAdapter(entries, `${keyPrefix}/${rule.kind}:${rule.key}`);
        }

        return createCountingStyleRuleAdapter(entries, `${keyPrefix}/style:${rule.key}`);
    }

    return {
        insertRule,
        dispose() {},
    };
}

function createCountingStyleRuleAdapter(entries: Map<string, Map<string, string>>, key: string): StyleStyleRuleAdapter {
    let disposed = false;

    return {
        style: {
            setProperty(property, value) {
                if (disposed) return false;

                let entry = entries.get(key);
                if (!entry) {
                    entry = new Map();
                    entries.set(key, entry);
                }

                const nextValue = `${value}`;
                if (entry.get(property) === nextValue) return true;
                entry.set(property, nextValue);
                return true;
            },
            removeProperty(property) {
                const entry = entries.get(key);
                if (!entry) return;
                entry.delete(property);
                if (!entry.size) entries.delete(key);
            },
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            entries.delete(key);
        },
    };
}

let consumedValue: unknown;

function consume(value: unknown) {
    consumedValue = value;
    if (consumedValue === '__unreachable_benchmark_value__') {
        throw new Error('Unreachable benchmark value.');
    }
}
