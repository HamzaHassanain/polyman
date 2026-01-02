
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as scriptParser from '../../src/helpers/script-parser';
import fs from 'fs';
import path from 'path';

vi.mock('fs');

describe('script-parser.ts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

  describe('validateGeneratorCommands', () => {
      it('should pass for valid commands', () => {
          const commands: any[] = [{ type: 'generator', generator: 'gen' }];
          const available = ['gen'];
          expect(() => scriptParser.validateGeneratorCommands(commands, available)).not.toThrow();
      });

      it('should throw if generator missing name', () => {
           const commands: any[] = [{ type: 'generator' }];
           expect(() => scriptParser.validateGeneratorCommands(commands, [])).toThrow('Generator command missing generator name');
      });

      it('should throw if generator not available', () => {
           const commands: any[] = [{ type: 'generator', generator: 'gen' }];
           expect(() => scriptParser.validateGeneratorCommands(commands, [])).toThrow('Generator "gen" not found');
      });

      it('should pass for valid manual command', () => {
          const commands: any[] = [{ type: 'manual', manualFile: 'man.txt' }];
          vi.mocked(fs.existsSync).mockReturnValue(true);
          expect(() => scriptParser.validateGeneratorCommands(commands, [])).not.toThrow();
      });

       it('should throw if manual file missing path', () => {
           const commands: any[] = [{ type: 'manual' }];
           expect(() => scriptParser.validateGeneratorCommands(commands, [])).toThrow('Manual command missing file path');
      });

      it('should throw if manual file not found', () => {
          const commands: any[] = [{ type: 'manual', manualFile: 'man.txt' }];
          vi.mocked(fs.existsSync).mockReturnValue(false);
          expect(() => scriptParser.validateGeneratorCommands(commands, [])).toThrow('Manual test file not found');
      });
  });
});
