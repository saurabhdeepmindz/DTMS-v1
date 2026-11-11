import wwApp from './wwApp.js';
import wwAuth from './wwAuth.js';
import wwApiRequests from './wwApiRequests.js';
import wwCollection from './wwCollection.js';
import wwEditor from './wwEditor.js';
import wwElement from './wwElement.js';
import wwFormula from './wwFormula.js';
import wwLang from './wwLang.js';
import wwLog from './wwLog.js';
import wwObjectHelper from './wwObjectHelper.js';
import wwPageHelper from './wwPageHelper.js';
import wwPluginHelper from './wwPluginHelper.js';
import wwTableView from './wwTableView.js';
import wwUtils from './wwUtils.js';
import wwVariable from './wwVariable.js';
import wwWebsiteData from './wwWebsiteData.js';
import wwWorkflow from './wwWorkflow.js';

import globalVariables from './globalVariables.js';
import { createScrollStore } from '@/_common/store/scrollStore.js';
import { createKeyboardEventStore } from '@/_common/store/keyboardStore.js';
import { createLogStore } from '@/_common/store/logStore.js';
import { createPwaStore } from '@/_common/store/pwaStore.ts';

export default {
    wwApp,
    wwAuth,
    wwApiRequests,
    wwCollection,
    wwEditor,
    wwElement,
    wwElementHelper: wwObjectHelper,
    wwFormula,
    wwLang,
    wwLog,
    wwObjectHelper,
    wwPageHelper,
    wwPluginHelper,
    wwTableView,
    wwUtils,
    wwVariable,
    wwWebsiteData,
    wwWorkflow,
    globalVariables,
    scrollStore: createScrollStore(),
    keyboardEventStore: createKeyboardEventStore(),
    pwaStore: createPwaStore(),
    logStore: createLogStore(), // TODO: to be removed
};
