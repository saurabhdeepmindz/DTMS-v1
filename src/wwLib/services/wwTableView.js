export default {
    getData(tableViewId) {
        const backTableViewsStore = wwLib.store.backTableViews;
        return backTableViewsStore.data[tableViewId];
    },

    async fetchMore(tableViewId, options) {
        const backTableViewsStore = wwLib.store.backTableViews;
        return await backTableViewsStore.fetchMore(tableViewId, options);
    },

    async refresh(tableViewId) {
        const backTableViewsStore = wwLib.store.backTableViews;
        return await backTableViewsStore.fetchData(tableViewId, { noLog: true });
    },

    async setOffset(tableViewId, offset, options) {
        const backTableViewsStore = wwLib.store.backTableViews;
        return await backTableViewsStore.setOffset(tableViewId, offset, options);
    },

    getPaginationOptions(tableViewId, options) {
        const backTableViewsStore = wwLib.store.backTableViews;
        return backTableViewsStore.getPaginationOptions(tableViewId, options);
    },
};
