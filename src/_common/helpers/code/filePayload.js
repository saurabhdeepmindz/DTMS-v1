function getPrototypeName(value) {
    if (value === null || value === undefined) return undefined;
    return Object.getPrototypeOf(value)?.constructor?.name;
}

export function isFile(value) {
    return value instanceof File || getPrototypeName(value) === 'File';
}

export function isFileList(value) {
    return value instanceof FileList || getPrototypeName(value) === 'FileList';
}

export function normalizeFiles(value) {
    if (isFileList(value)) return Array.from(value).filter(isFile);
    if (Array.isArray(value)) return value.filter(isFile);
    return isFile(value) ? [value] : [];
}
