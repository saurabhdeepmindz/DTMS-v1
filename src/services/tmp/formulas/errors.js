class FormulaError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'FormulaError';
    this.originalError = options.originalError;
    this.formulaCode = options.formulaCode;
    this.formulaType = options.formulaType;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      formulaCode: this.formulaCode,
      formulaType: this.formulaType,
      originalError: this.originalError ? {
        name: this.originalError.name,
        message: this.originalError.message,
        stack: this.originalError.stack,
      } : undefined,
      stack: this.stack,
    };
  }
}

export { FormulaError }; 