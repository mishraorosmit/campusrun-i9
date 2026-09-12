import { Request, Response, NextFunction } from 'express';
import { SchemaValidator, ValidationSchema } from './validator';
import { ValidationError } from '../errors';

export type RequestLocation = 'body' | 'query' | 'params';

export function validateRequest(schema: ValidationSchema, location: RequestLocation = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const data = (req[location] || {}) as Record<string, unknown>;
    const issues = SchemaValidator.validate(data, schema);

    if (issues.length > 0) {
      next(new ValidationError('Request validation failed', issues));
      return;
    }

    next();
  };
}
