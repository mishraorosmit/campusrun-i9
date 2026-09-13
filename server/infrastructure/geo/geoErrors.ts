/**
 * Typed Geospatial Domain & Infrastructure Errors
 */

export class InvalidCoordinatesError extends Error {
  public readonly code = 'INVALID_COORDINATES';
  public readonly statusCode = 400;

  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'InvalidCoordinatesError';
    Object.setPrototypeOf(this, InvalidCoordinatesError.prototype);
  }
}

export class InvalidSvgCoordinatesError extends Error {
  public readonly code = 'INVALID_SVG_COORDINATES';
  public readonly statusCode = 400;

  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'InvalidSvgCoordinatesError';
    Object.setPrototypeOf(this, InvalidSvgCoordinatesError.prototype);
  }
}

export class OutOfBoundsError extends Error {
  public readonly code = 'OUT_OF_BOUNDS';
  public readonly statusCode = 422;

  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'OutOfBoundsError';
    Object.setPrototypeOf(this, OutOfBoundsError.prototype);
  }
}
