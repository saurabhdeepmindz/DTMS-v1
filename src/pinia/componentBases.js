import { defineStore } from 'pinia';
import { getInheritedConfiguration } from '@/_common/helpers/configuration/configuration';
 
/* wwFront:start */
// eslint-disable-next-line no-undef
import section99586bd32b154d6ba0256a50d07ca845 from '@weweb-internal/ext-section-99586bd3-2b15-4d6b-a025-6a50d07ca845/config';
import wwobject9ecb2cfccef74be8b7363e17a3b7e9ff from '@weweb-internal/ext-element-9ecb2cfc-cef7-4be8-b736-3e17a3b7e9ff/config';
import wwobjectdeb10a015eef4aa190171b51c2ad6fd0 from '@weweb-internal/ext-element-deb10a01-5eef-4aa1-9017-1b51c2ad6fd0/config';
import wwobjectd7904e9dfc9a4d809e32728e097879ad from '@weweb-internal/ext-element-d7904e9d-fc9a-4d80-9e32-728e097879ad/config';
import wwobject00df911550ec41149a76c96c76721e6f from '@weweb-internal/ext-element-00df9115-50ec-4114-9a76-c96c76721e6f/config';
import wwobject1b1e21739b7842cca8eea6167caea340 from '@weweb-internal/ext-element-1b1e2173-9b78-42cc-a8ee-a6167caea340/config';
import wwobject59dca300db7842e4a7a60cbf22d3cc82 from '@weweb-internal/ext-element-59dca300-db78-42e4-a7a6-0cbf22d3cc82/config';
import wwobjectb783dc65d5284f748c14e27c934c39b1 from '@weweb-internal/ext-element-b783dc65-d528-4f74-8c14-e27c934c39b1/config';
/* wwFront:end */

export const useComponentBasesStore = defineStore('componentBases', () => {
    let configurations;
    /* wwFront:start */
    // eslint-disable-next-line no-undef
    configurations = {'section-99586bd3-2b15-4d6b-a025-6a50d07ca845': getInheritedConfiguration({ ...section99586bd32b154d6ba0256a50d07ca845, name: 'section-99586bd3-2b15-4d6b-a025-6a50d07ca845' }),
'wwobject-9ecb2cfc-cef7-4be8-b736-3e17a3b7e9ff': getInheritedConfiguration({ ...wwobject9ecb2cfccef74be8b7363e17a3b7e9ff, name: 'wwobject-9ecb2cfc-cef7-4be8-b736-3e17a3b7e9ff' }),
'wwobject-deb10a01-5eef-4aa1-9017-1b51c2ad6fd0': getInheritedConfiguration({ ...wwobjectdeb10a015eef4aa190171b51c2ad6fd0, name: 'wwobject-deb10a01-5eef-4aa1-9017-1b51c2ad6fd0' }),
'wwobject-d7904e9d-fc9a-4d80-9e32-728e097879ad': getInheritedConfiguration({ ...wwobjectd7904e9dfc9a4d809e32728e097879ad, name: 'wwobject-d7904e9d-fc9a-4d80-9e32-728e097879ad' }),
'wwobject-00df9115-50ec-4114-9a76-c96c76721e6f': getInheritedConfiguration({ ...wwobject00df911550ec41149a76c96c76721e6f, name: 'wwobject-00df9115-50ec-4114-9a76-c96c76721e6f' }),
'wwobject-1b1e2173-9b78-42cc-a8ee-a6167caea340': getInheritedConfiguration({ ...wwobject1b1e21739b7842cca8eea6167caea340, name: 'wwobject-1b1e2173-9b78-42cc-a8ee-a6167caea340' }),
'wwobject-59dca300-db78-42e4-a7a6-0cbf22d3cc82': getInheritedConfiguration({ ...wwobject59dca300db7842e4a7a60cbf22d3cc82, name: 'wwobject-59dca300-db78-42e4-a7a6-0cbf22d3cc82' }),
'wwobject-b783dc65-d528-4f74-8c14-e27c934c39b1': getInheritedConfiguration({ ...wwobjectb783dc65d5284f748c14e27c934c39b1, name: 'wwobject-b783dc65-d528-4f74-8c14-e27c934c39b1' })};
    /* wwFront:end */
 
    return {
        configurations,
     };
});
