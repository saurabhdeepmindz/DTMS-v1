import { Hono } from 'hono';
import { ensureWWAuth } from '../../middlewares/weweb.middlewares.js';
import {
    listAll,
    move,
    moveList,
    copy,
    copyList,
    copyEnvironment,
    deleteList,
    deleteBatch,
    getSignedUrl,
    getSignedUploadUrl,
    getSignedUploadUrls,
    confirmSignedUploadUrls,
    confirmSignedUploadUrl,
    syncFile,
    countFolderFiles,
    moveFolder,
    deleteFolder,
} from './storage.controllers.ts';

const ENV_PATH = ':env{(current|editor|staging|production)}';
const ACCESS_PATH = ':access{(public|private)}';

let app = new Hono();
app.patch('/files/signed-url/upload/confirm', confirmSignedUploadUrl);

if (process.env.ENV === 'editor') {
    app.patch(`/${ENV_PATH}/files/signed-url/upload/confirm`, ensureWWAuth, confirmSignedUploadUrl);
    app.post('/environment/copy', ensureWWAuth, copyEnvironment);
    app = app.basePath(`/${ENV_PATH}/${ACCESS_PATH}`);
    app.use('*', ensureWWAuth);
    app.get('/files', listAll);
    app.post('/files/delete', deleteList);
    app.post('/files/delete/batch', deleteBatch);
    app.patch('/files/move', move);
    app.patch('/files/move/batch', moveList);
    app.post('/files/copy', copy);
    app.post('/files/copy/batch', copyList);
    app.post('/files/signed-url', getSignedUrl);
    app.post('/files/signed-url/upload', getSignedUploadUrl);
    app.post('/files/signed-url/upload/prepare-batch', getSignedUploadUrls);
    app.patch('/files/signed-url/upload/confirm-batch', confirmSignedUploadUrls);
    app.put('/files/sync', syncFile);
    app.get('/folders/count', countFolderFiles);
    app.patch('/folders/move', moveFolder);
    app.post('/folders/delete', deleteFolder);
}

export default app;
