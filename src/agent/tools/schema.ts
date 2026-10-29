/**
 * A small JSON Schema check for tool arguments. It supports only what our
 * tools use: `type`, `properties`, `required`, `additionalProperties: false`,
 * `enum`, `items`, `minLength`, `minimum` and `maximum`.
 *
 * The errors are read by the model, so each one names the exact place and
 * what is wrong, like `args.path: expected string, got number`.
 */

/** A JSON Schema object, as in `Tool.parameters`. */
export type JSONSchema = Record<string, unknown>;

/** Checks `value` against `schema`. Returns the errors, empty when ok. */
export function validate(
  schema: JSONSchema,
  value: unknown,
  path = 'args'
): string[] {
  const errors: string[] = [];

  const type = schema['type'];
  if (typeof type === 'string' && !matchesType(type, value)) {
    errors.push(`${path}: expected ${type}, got ${typeName(value)}`);
    return errors;
  }

  const allowed = schema['enum'];
  if (Array.isArray(allowed) && !allowed.some(v => v === value)) {
    errors.push(`${path}: must be one of ${allowed.map(String).join(', ')}`);
  }

  if (typeof value === 'string') {
    const minLength = schema['minLength'];
    if (typeof minLength === 'number' && value.length < minLength) {
      errors.push(`${path}: must have at least ${minLength} characters`);
    }
  }

  if (typeof value === 'number') {
    const minimum = schema['minimum'];
    if (typeof minimum === 'number' && value < minimum) {
      errors.push(`${path}: must be at least ${minimum}, got ${value}`);
    }
    const maximum = schema['maximum'];
    if (typeof maximum === 'number' && value > maximum) {
      errors.push(`${path}: must be at most ${maximum}, got ${value}`);
    }
  }

  if (Array.isArray(value)) {
    const items = schema['items'];
    if (isSchema(items)) {
      value.forEach((item, i) => {
        errors.push(...validate(items, item, `${path}[${i}]`));
      });
    }
  }

  if (isPlainObject(value)) {
    errors.push(...validateObject(schema, value, path));
  }

  return errors;
}

function validateObject(
  schema: JSONSchema,
  value: Record<string, unknown>,
  path: string
): string[] {
  const errors: string[] = [];
  const properties = isSchema(schema['properties']) ? schema['properties'] : {};

  const required = schema['required'];
  if (Array.isArray(required)) {
    for (const key of required) {
      if (typeof key === 'string' && value[key] === undefined) {
        errors.push(`${path}: missing required property "${key}"`);
      }
    }
  }

  for (const [key, child] of Object.entries(value)) {
    // Own keys only: `properties["__proto__"]` is Object.prototype.
    const childSchema = Object.prototype.hasOwnProperty.call(properties, key)
      ? properties[key]
      : undefined;
    if (isSchema(childSchema)) {
      if (child !== undefined) {
        errors.push(...validate(childSchema, child, `${path}.${key}`));
      }
    } else if (schema['additionalProperties'] === false) {
      const names = Object.keys(properties);
      const hint = names.length > 0 ? `, allowed: ${names.join(', ')}` : '';
      errors.push(`${path}: unknown property "${key}"${hint}`);
    }
  }

  return errors;
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}

/** The JSON name of a value's type, for error messages. */
function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'nothing';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return 'integer';
    return Number.isFinite(value) ? 'number' : String(value);
  }
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSchema(value: unknown): value is JSONSchema {
  return isPlainObject(value);
}
