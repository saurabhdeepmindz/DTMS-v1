export function getPath(path, media) {
    if (!path) return '';
    let prefix;
    media = media || 'default';
    if (path.startsWith('content.')) {
        path = path.replace('content.', '');
        prefix = 'content';
    } else if (path.startsWith('_state.style')) {
        path = path.replace('_state.style.', '');
        prefix = '_state.style';
    } else {
        return path;
    }

    return `${prefix}.${media}.${path}`;
}

export function getPathLabel(path) {
    path = path || '';
    const [collection, ...others] = path.split('.');
    if (!collection) return path;
    let name;
    if (collection === '__wwPage') {
        name = 'Page';
    } else if (collection === '__wwParent') {
        name = 'Parent';
    } else {
        ({ name } = wwLib.store.data.collections[collection] || {});
    }
    return [name, ...others].join('.').replace('.data', '');
}

export function getTargetMedia({ screenSize, elementState, isResponsive, allowState }) {
    elementState = elementState === 'default' ? null : elementState;
    elementState = allowState ? elementState : null;
    const targetScreenSize = isResponsive ? screenSize : 'default';
    let targetMedia = elementState ? `${elementState}_${targetScreenSize}` : targetScreenSize;

    return targetMedia;
}

export function splitPath(fullPath) {
    if (fullPath.startsWith('content.')) {
        const parts = fullPath.replace('content.', '').split('.');
        const media = parts[0];
        const path = `content.${parts.slice(1).join('.')}`;
        return { path, media };
    } else if (fullPath.startsWith('_state.style.')) {
        const parts = fullPath.replace('_state.style.', '').split('.');
        const media = parts[0];
        const path = `_state.style.${parts.slice(1).join('.')}`;
        return { path, media };
    } else {
        return { path: fullPath, media: 'default' };
    }
}
