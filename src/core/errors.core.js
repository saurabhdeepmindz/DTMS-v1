export class SecurityCheckError extends Error {
    constructor(data, status = 403) {
        super(data.error || 'Security check failed');
        this.name = 'SecurityCheckError';
        this.data = data;
        this.status = status;
    }
}
