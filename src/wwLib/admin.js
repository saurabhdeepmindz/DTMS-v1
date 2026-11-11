export default {
    cleanGhostElements(apply) {
        const elementIds = Object.keys(wwLib.store.websiteData.$state.wwObjects).filter(
            id => wwLib.store.websiteData.$state.wwObjects[id].parentSectionId
        );
        const sectionIds = Object.keys(wwLib.store.websiteData.$state.sections);

        console.log(`Analyzing ${elementIds.length} elements and ${sectionIds.length} sections for ghost elements...`);

        const strangeIds = elementIds.filter(id => wwLib.store.websiteData.$state.wwObjects[id].parentLibraryComponentId);
        if (strangeIds.length > 0) {
            console.log(`Found ${strangeIds.length} elements with a parentLibraryComponentId:`);
            console.log(strangeIds);
        }

        const hasBeenFound = {};

        function getDirectChildren(data) {
            if (!data) return [];
            if (Array.isArray(data)) {
                return data.map(item => getDirectChildren(item)).flat();
            }
            if (typeof data === 'object') {
                if (data.isWwObject) {
                    return [data.uid];
                }
                return Object.values(data)
                    .map(value => getDirectChildren(value))
                    .flat();
            }
            return [];
        }

        function exploreFrom(data, depth = 1) {
            let children = getDirectChildren(data);
            const initialCount = children.length;
            children = [...new Set(children)].filter(id => !hasBeenFound[id]);
            if (children.length < initialCount) {
                console.log(`Filtered out ${initialCount - children.length} already found children at depth ${depth}`);
            }
            children.forEach(id => {
                hasBeenFound[id] = depth;
                exploreFrom(wwLib.store.websiteData.$state.wwObjects[id], depth + 1);
            });
        }

        sectionIds.forEach(sectionId => {
            const section = wwLib.store.websiteData.$state.sections[sectionId];
            console.log(`#### Exploring section ${sectionId} (${section.sectionTitle})...`);
            exploreFrom(section);
        });

        const ghostElementsIds = elementIds.filter(id => !hasBeenFound[id]);

        console.log(`Found ${ghostElementsIds.length} ghost elements`);

        const parents = {};
        ghostElementsIds.forEach(id => {
            const element = wwLib.store.websiteData.$state.wwObjects[id];
            const children = getDirectChildren(element);
            children.forEach(childId => {
                if (!parents[childId]) {
                    parents[childId] = id;
                } else {
                    console.log(`Element ${childId} has multiple parents: ${parents[childId]} and ${id}`);
                }
            });
        });

        const rootGhosts = ghostElementsIds.filter(id => !parents[id]);
        const rootGhostSections = [
            ...new Set(rootGhosts.map(id => wwLib.store.websiteData.$state.wwObjects[id].parentSectionId)),
        ];

        console.log(`Found ${rootGhosts.length} root ghost elements:`);
        if (rootGhosts.length > 0) {
            console.log(`These root ghost elements belong to ${rootGhostSections.length} sections`);
            console.log('############ Elements IDs');
            console.log(rootGhosts);
            console.log('############');
            console.log('############ Sections IDs');
            console.log(rootGhostSections);
            console.log('############');

            const withinLinkedSections = rootGhosts.filter(id => {
                const element = wwLib.store.websiteData.$state.wwObjects[id];
                const sectionId = element.parentSectionId;
                return wwLib.store.websiteData.$state.sections[sectionId]?.linkedSectionId;
            });

            const sections = JSON.stringify(wwLib.store.websiteData.$state.sections);
            const idsAfterSectionChecking = ghostElementsIds.filter(id => !sections.includes(id));
            console.log(`${idsAfterSectionChecking.length} elements after section checking:`);

            const idsAfterObjectChecking = idsAfterSectionChecking.filter(id => {
                const elements = { ...wwLib.store.websiteData.$state.wwObjects };
                delete elements[id];
                if (parents[id]) {
                    delete elements[parents[id]];
                }
                return !JSON.stringify(elements).includes(id);
            });

            console.log(`${idsAfterObjectChecking.length} real ghost elements:`);
        }

        if (apply) {
            rootGhosts.forEach(id => {
                console.log(`Cleaning ghost element ${id}...`);
                wwLib.store.websiteData.cleanElementParent({ wwObjectId: id });
            });
        }
    },
};
