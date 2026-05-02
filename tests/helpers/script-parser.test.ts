import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as scriptParser from '../../src/helpers/script-parser';
import type { GeneratorScriptCommand } from '../../src/types';
import fs from 'fs';

vi.mock('fs');

describe('script-parser.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateGeneratorCommands', () => {
    it('should pass for valid commands', () => {
      const commands: GeneratorScriptCommand[] = [
        { type: 'generator', generator: 'gen' },
      ];
      const available = ['gen'];
      expect(() =>
        scriptParser.validateGeneratorCommands(commands, available)
      ).not.toThrow();
    });

    it('should throw if generator missing name', () => {
      const commands: GeneratorScriptCommand[] = [{ type: 'generator' }];
      expect(() =>
        scriptParser.validateGeneratorCommands(commands, [])
      ).toThrow('Generator command missing generator name');
    });

    it('should throw if generator not available', () => {
      const commands: GeneratorScriptCommand[] = [
        { type: 'generator', generator: 'gen' },
      ];
      expect(() =>
        scriptParser.validateGeneratorCommands(commands, [])
      ).toThrow('Generator "gen" not found');
    });

    it('should pass for valid manual command', () => {
      const commands: GeneratorScriptCommand[] = [
        { type: 'manual', manualFile: 'man.txt' },
      ];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      expect(() =>
        scriptParser.validateGeneratorCommands(commands, [])
      ).not.toThrow();
    });

    it('should throw if manual file missing path', () => {
      const commands: GeneratorScriptCommand[] = [{ type: 'manual' }];
      expect(() =>
        scriptParser.validateGeneratorCommands(commands, [])
      ).toThrow('Manual command missing file path');
    });

    it('should throw if manual file not found', () => {
      const commands: GeneratorScriptCommand[] = [
        { type: 'manual', manualFile: 'man.txt' },
      ];
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(() =>
        scriptParser.validateGeneratorCommands(commands, [])
      ).toThrow('Manual test file not found');
    });
  });
});
