 
export default {
    async init() {
        /* wwFront:start */
        const designInfo = wwLib.getFrontWindow().wwg_designInfo;
        await wwLib.store.websiteData.setFullDesign(designInfo);
        /* wwFront:end */
     },

    startInfrastructureWakePolling(projectId, commitId) {
        clearInterval(this.infrastructureWakePollingTimer);
        this.infrastructureWakePollingTimer = setInterval(async () => {
            try {
                await api.projects.load(projectId, commitId);
                clearInterval(this.infrastructureWakePollingTimer);
                window.location.reload();
            } catch (error) {
                if (error?.response?.status !== 425 || error?.response?.data?.code !== 'PROJECT_WAKING') {
                    clearInterval(this.infrastructureWakePollingTimer);
                    this.infrastructureWakePollingTimer = null;
                    return;
                }
                wwLib.store.manager.setEnvironmentInfrastructureWake(error.response.data);
            }
        }, 30000);
    },

    async fetchPage(pageId) {
 
 
        await fetchData(pageId);
    },

    getPageRoute(pageIdOrLinkId, allowHomePageId) {
        const pages = this.getPages();
        const info = this.getInfo();
        for (const page of pages) {
            if (page.linkId == pageIdOrLinkId || page.id == pageIdOrLinkId) {
                if (allowHomePageId && page.id == info.homePageId) {
                    return '';
                }
                return page.paths[wwLib.wwLang.lang];
            }
        }
        return '';
    },

 
    /**
     * @PUBLIC_API
     * @DEPRECATED
     */
    getWebsiteName() {
        wwLib.wwLog.warn('wwUtils.wwWebsiteData.getWebsiteName is deprecated');
        return wwLib.store.websiteData.designInfo.name;
    },

    /** @PUBLIC_API Reactive project definition. */
    get design() {
        return wwLib.store.websiteData.currentDesign || null;
    },
    /** @PUBLIC_API Reactive project metadata. */
    get info() {
        return this.design.info;
    },
    /** @PUBLIC_API Project pages, retaining the stored page references. */
    get pages() {
        return this.design.pages;
    },
    /** @PUBLIC_API Active page definition. */
    get currentPage() {
        return wwLib.store.websiteData.page;
    },
    /** @PUBLIC_API Active page ID. */
    get currentPageId() {
        return wwLib.store.websiteData.pageId;
    },
    /**
     * @PUBLIC_API
     */
    getDesign() {
        return wwLib.store.websiteData.currentDesign || null;
    },

    /**
     * @PUBLIC_API
     */
    getInfo() {
        const design = this.getDesign();
        return design.info;
    },

 
    /**
     * @PUBLIC_API
     */
    getPages() {
        const design = this.getDesign();
        return design.pages;
    },

    /**
     * @PUBLIC_API
     */
    getCurrentPage() {
        return wwLib.store.websiteData.page;
    },

    /**
     * @PUBLIC_API
     */
    getCurrentPageId() {
        return wwLib.store.websiteData.pageId;
    },
};

async function fetchData(pageId) {
    if (!pageId) return;

    let page;

    /* wwFront:start */
    if (import.meta.env.SSR) {
        const payload = await readPageDataFromDisk(pageId);
        const {
            page: pageData,
            sections,
            wwObjects,
            collections,
            variables,
            formulas,
            workflows,
            libraryComponents,
        } = payload;

        page = { page: pageData, sections, wwObjects };
        await wwLib.store.websiteData.setAllData({
            page,
            collections,
            variables,
            formulas,
            workflows,
            libraryComponents,
        });

        // eslint-disable-next-line vue/custom-event-name-casing
        wwLib.$emit('wwStore:dataLoaded');
        return;
    }

    try {
        const base = wwLib.useBaseTag() ? wwLib.getBaseTag() : '/';
        const lang = window.location.pathname.replace(base, '/').startsWith(`/${wwLib.wwLang.lang}/`)
            ? wwLib.wwLang.lang
            : '';

        let url = `${base}data/${pageId.split('_')[0]}.json?wwlang=${lang}&_wwcv=${window.wwg_cacheVersion}`;

        const {
            data: {
                cacheVersion,
                page: pageData,
                sections,
                wwObjects,
                collections,
                variables,
                formulas,
                workflows,
                libraryComponents,
            },
        } = await axios.get(url);

        //data.json contains a different cacheVersion
        //due to a deploy before the navigation
        if (cacheVersion != window.wwg_cacheVersion) {
            throw { reloadUrl: true };
        }

        if (pageData.cmsDataSetPath) {
            url = `${base}data/${pageId}.json?wwlang=${lang}&_wwcv=${window.wwg_cacheVersion}`;

            const {
                data: { page: pageIndexData },
            } = await axios.get(url);

            for (const key in pageIndexData) {
                pageData[key] = pageIndexData[key];
            }
        }

        if (collections) {
            const promises = [];
            for (const collection of Object.values(collections).filter(collection => collection.mode === 'static')) {
                if (!wwLib.store.data.collections[collection.id])
                    promises.push(
                        axios
                            .get(`/collections/${collection.id}.json?_wwcv=${window.wwg_cacheVersion}`)
                            .then(({ data }) => (collection.data = data))
                            .catch(err => wwLib.wwLog.error(err))
                    );
            }
            await Promise.all(promises);
        }
        page = { page: pageData, sections, wwObjects };

        await wwLib.store.websiteData.setAllData({
            page,
            collections,
            variables,
            formulas,
            workflows,
            libraryComponents,
        });
    } catch (err) {
        throw { redirectUrl: err.response.data.redirectUrl };
    }
    /* wwFront:end */

 
    // eslint-disable-next-line vue/custom-event-name-casing
    wwLib.$emit('wwStore:dataLoaded');
}

/* wwFront:start */
async function readPageDataFromDisk(pageId) {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const basePageId = pageId.split('_')[0];
    const payload = JSON.parse(await readFile(resolve(process.cwd(), 'public', 'data', `${basePageId}.json`), 'utf8'));

    if (payload.page.cmsDataSetPath) {
        const pageRowPayload = JSON.parse(
            await readFile(resolve(process.cwd(), 'public', 'data', `${pageId}.json`), 'utf8')
        );
        Object.assign(payload.page, pageRowPayload.page);
    }

    return payload;
}
/* wwFront:end */
