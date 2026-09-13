export interface ValidationRule<T = unknown> {
  field: string;
  validate: (val: T, data?: Record<string, unknown>) => boolean;
  message: string;
}

export interface ValidationSchema {
  rules: ValidationRule<any>[];
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export class SchemaValidator {
  public static validate(data: Record<string, unknown>, schema: ValidationSchema): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const rule of schema.rules) {
      const val = data ? data[rule.field] : undefined;
      const isValid = rule.validate(val, data);
      if (!isValid) {
        issues.push({
          field: rule.field,
          message: rule.message,
        });
      }
    }

    return issues;
  }

  // Type-coercion validation helpers for query/params
  public static isNonEmptyString(val: unknown): boolean {
    return typeof val === 'string' && val.trim().length > 0;
  }

  public static isNumber(val: unknown): boolean {
    if (typeof val === 'number') return !isNaN(val);
    if (typeof val === 'string' && val.trim() !== '') {
      return !isNaN(Number(val));
    }
    return false;
  }

  public static isPositiveInteger(val: unknown): boolean {
    if (!SchemaValidator.isNumber(val)) return false;
    const num = Number(val);
    return Number.isInteger(num) && num > 0;
  }

  public static isLatitude(val: unknown): boolean {
    if (!SchemaValidator.isNumber(val)) return false;
    const num = Number(val);
    return num >= -90 && num <= 90;
  }

  public static isLongitude(val: unknown): boolean {
    if (!SchemaValidator.isNumber(val)) return false;
    const num = Number(val);
    return num >= -180 && num <= 180;
  }

  public static isBoolean(val: unknown): boolean {
    if (typeof val === 'boolean') return true;
    if (typeof val === 'string') {
      return val.toLowerCase() === 'true' || val.toLowerCase() === 'false';
    }
    return false;
  }

  public static isValidUrl(val: unknown): boolean {
    if (typeof val !== 'string' || val.trim().length === 0) return false;
    try {
      const parsed = new URL(val);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  public static isObject(val: unknown): boolean {
    return typeof val === 'object' && val !== null && !Array.isArray(val);
  }
}
