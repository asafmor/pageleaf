export class PageleafError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'PageleafError';
    this.exitCode = exitCode;
  }
}

export class UsageError extends PageleafError {
  constructor(message) {
    super(message, 2);
    this.name = 'UsageError';
  }
}
