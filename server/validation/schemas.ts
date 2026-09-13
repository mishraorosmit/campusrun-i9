import { ValidationSchema, SchemaValidator } from './validator';

export const ClaimSubmissionSchema: ValidationSchema = {
  rules: [
    {
      field: 'spawnId',
      validate: (val) => SchemaValidator.isNonEmptyString(val),
      message: 'spawnId is required and must be a non-empty string',
    },
    {
      field: 'playerId',
      validate: (val) => val === undefined || SchemaValidator.isNonEmptyString(val),
      message: 'playerId must be a non-empty string if provided',
    },
    {
      field: 'lat',
      validate: (val) => val === undefined || SchemaValidator.isLatitude(val),
      message: 'lat must be a valid latitude between -90 and 90',
    },
    {
      field: 'lng',
      validate: (val) => val === undefined || SchemaValidator.isLongitude(val),
      message: 'lng must be a valid longitude between -180 and 180',
    },
  ],
};

export const SpawnFilterSchema: ValidationSchema = {
  rules: [
    {
      field: 'north',
      validate: (val) => val === undefined || SchemaValidator.isLatitude(val),
      message: 'north coordinate must be between -90 and 90',
    },
    {
      field: 'south',
      validate: (val) => val === undefined || SchemaValidator.isLatitude(val),
      message: 'south coordinate must be between -90 and 90',
    },
    {
      field: 'east',
      validate: (val) => val === undefined || SchemaValidator.isLongitude(val),
      message: 'east coordinate must be between -180 and 180',
    },
    {
      field: 'west',
      validate: (val) => val === undefined || SchemaValidator.isLongitude(val),
      message: 'west coordinate must be between -180 and 180',
    },
  ],
};

export const AdminToggleSpawnSchema: ValidationSchema = {
  rules: [
    {
      field: 'enabled',
      validate: (val) => SchemaValidator.isBoolean(val),
      message: 'enabled must be a boolean (true or false)',
    },
  ],
};

export const PushSubscriptionSchema: ValidationSchema = {
  rules: [
    {
      field: 'endpoint',
      validate: (val) => SchemaValidator.isValidUrl(val),
      message: 'endpoint is required and must be a valid HTTP or HTTPS URL',
    },
    {
      field: 'keys',
      validate: (val, data) => {
        const p256dh =
          val && typeof val === 'object' && 'p256dh' in (val as object)
            ? (val as any).p256dh
            : data?.p256dh;
        return SchemaValidator.isNonEmptyString(p256dh);
      },
      message: 'keys.p256dh (or p256dh) is required and must be a non-empty string',
    },
    {
      field: 'auth',
      validate: (val, data) => {
        const auth =
          data?.keys && typeof data.keys === 'object' && 'auth' in (data.keys as object)
            ? (data.keys as any).auth
            : val !== undefined
            ? val
            : data?.auth;
        return SchemaValidator.isNonEmptyString(auth);
      },
      message: 'keys.auth (or auth) is required and must be a non-empty string',
    },
  ],
};

