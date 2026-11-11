export function fileToResponse(file: { base64: string; mediaType: string; uint8Array?: Uint8Array }) {
    return {
        dataUri: `data:${file.mediaType};base64,${file.base64}`,
        mediaType: file.mediaType,
    };
}
