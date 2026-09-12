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
      validate: (val) => SchemaValidator.isNonEmptyString(val),
      message: 'playerId is required and must be a non-empty string',
    },
    {
      field: 'lat',
      validate: (val) => SchemaValidator.isLatitude(val),
      message: 'lat is required and must be a valid latitude between -90 and 90',
    },
    {
      field: 'lng',
      validate: (val) => SchemaValidator.isLongitude(val),
      message: 'lng is required and must be a valid longitude between -180 and 180',
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
