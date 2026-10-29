import { describe, it, expect } from 'vitest';
import { validate } from '../../../src/agent/tools/schema';

describe('validate', () => {
  it('accepts a matching value', () => {
    const schema = {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        lines: { type: 'integer', minimum: 1, maximum: 2000 },
        force: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['path'],
      additionalProperties: false,
    };
    expect(
      validate(schema, { path: 'a.cpp', lines: 5, force: true, tags: ['x'] })
    ).toEqual([]);
  });

  it('checks each type', () => {
    expect(validate({ type: 'string' }, 3)).toEqual([
      'args: expected string, got integer',
    ]);
    expect(validate({ type: 'number' }, '3')).toEqual([
      'args: expected number, got string',
    ]);
    expect(validate({ type: 'number' }, 1.5)).toEqual([]);
    expect(validate({ type: 'integer' }, 1.5)).toEqual([
      'args: expected integer, got number',
    ]);
    expect(validate({ type: 'integer' }, 2)).toEqual([]);
    expect(validate({ type: 'boolean' }, 'true')).toEqual([
      'args: expected boolean, got string',
    ]);
    expect(validate({ type: 'array' }, {})).toEqual([
      'args: expected array, got object',
    ]);
    expect(validate({ type: 'object' }, [])).toEqual([
      'args: expected object, got array',
    ]);
    expect(validate({ type: 'object' }, null)).toEqual([
      'args: expected object, got null',
    ]);
    expect(validate({ type: 'object' }, undefined)).toEqual([
      'args: expected object, got nothing',
    ]);
  });

  it('names the nested path of a wrong type', () => {
    const schema = {
      type: 'object',
      properties: { path: { type: 'string' } },
    };
    expect(validate(schema, { path: 3 })).toEqual([
      'args.path: expected string, got integer',
    ]);
  });

  it('reports missing required properties', () => {
    const schema = {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    };
    expect(validate(schema, { path: 'a' })).toEqual([
      'args: missing required property "content"',
    ]);
    expect(validate(schema, {})).toEqual([
      'args: missing required property "path"',
      'args: missing required property "content"',
    ]);
  });

  it('refuses unknown properties with additionalProperties: false', () => {
    const schema = {
      type: 'object',
      properties: { path: { type: 'string' } },
      additionalProperties: false,
    };
    expect(validate(schema, { path: 'a', file: 'b' })).toEqual([
      'args: unknown property "file", allowed: path',
    ]);
  });

  it('allows unknown properties by default', () => {
    const schema = {
      type: 'object',
      properties: { path: { type: 'string' } },
    };
    expect(validate(schema, { path: 'a', extra: 1 })).toEqual([]);
  });

  it('checks enum', () => {
    const schema = {
      type: 'object',
      properties: {
        tag: { type: 'string', enum: ['MA', 'OK', 'WA', 'TL', 'TO'] },
      },
    };
    expect(validate(schema, { tag: 'XX' })).toEqual([
      'args.tag: must be one of MA, OK, WA, TL, TO',
    ]);
    expect(validate(schema, { tag: 'WA' })).toEqual([]);
  });

  it('checks array items with their index', () => {
    const schema = {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
      },
    };
    expect(
      validate(schema, { files: [{ name: 'a' }, { name: 2 }, {}] })
    ).toEqual([
      'args.files[1].name: expected string, got integer',
      'args.files[2]: missing required property "name"',
    ]);
  });

  it('checks minLength', () => {
    expect(validate({ type: 'string', minLength: 1 }, '')).toEqual([
      'args: must have at least 1 characters',
    ]);
    expect(validate({ type: 'string', minLength: 1 }, 'a')).toEqual([]);
  });

  it('checks minimum and maximum', () => {
    const schema = { type: 'integer', minimum: 1, maximum: 10 };
    expect(validate(schema, 0)).toEqual(['args: must be at least 1, got 0']);
    expect(validate(schema, 11)).toEqual(['args: must be at most 10, got 11']);
    expect(validate(schema, 1)).toEqual([]);
    expect(validate(schema, 10)).toEqual([]);
  });

  it('uses the given root path', () => {
    expect(validate({ type: 'string' }, 1, 'input')).toEqual([
      'input: expected string, got integer',
    ]);
  });

  it('collects every error in one pass', () => {
    const schema = {
      type: 'object',
      properties: {
        path: { type: 'string' },
        tag: { enum: ['MA', 'OK'] },
      },
      required: ['content'],
      additionalProperties: false,
    };
    expect(validate(schema, { path: 1, tag: 'X', more: true })).toEqual([
      'args: missing required property "content"',
      'args.path: expected string, got integer',
      'args.tag: must be one of MA, OK',
      'args: unknown property "more", allowed: path, tag',
    ]);
  });
});
