class CodeEvalError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'CodeEvalError';
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      details: {
        ...this.details,
        originalError: this.details.originalError ? {
          name: this.details.originalError.name,
          message: this.details.originalError.message,
          stack: this.details.originalError.stack,
        } : undefined,
      },
      stack: this.stack,
    };
  }
}

export { CodeEvalError }; 