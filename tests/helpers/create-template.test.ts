import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as createTemplate from '../../src/helpers/create-template';
import fs from 'fs';
import path from 'path';
import { fmt } from '../../src/formatter';

vi.mock('fs');
vi.mock('../../src/formatter');

describe('create-template.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('logTemplateCreationSuccess', () => {
    it('should log success messages', () => {
      createTemplate.logTemplateCreationSuccess('my-problem');
      expect(fmt.info).toHaveBeenCalled();
      expect(fmt.log).toHaveBeenCalledTimes(8);
    });
  });

  describe('copyTemplate', () => {
    it('should copy files and directories recursively', () => {
      const srcDir = 'template';
      const destDir = 'problem';

      const mockEntries = [
        { name: 'file.txt', isDirectory: () => false },
        { name: 'subdir', isDirectory: () => true },
      ];

      // Mock readdirSync to return entries for srcDir, and empty for subdir to stop recursion
      vi.mocked(fs.readdirSync).mockImplementation(dir => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        if (dir === srcDir) return mockEntries as any;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return [] as any;
      });

      createTemplate.copyTemplate(srcDir, destDir);

      // verify file copy
      expect(fs.copyFileSync).toHaveBeenCalledWith(
        path.join(srcDir, 'file.txt'),
        path.join(destDir, 'file.txt')
      );

      // verify dir creation
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join(destDir, 'subdir'), {
        recursive: true,
      });

      // verify recursion (readdirSync called for subdir)
      expect(fs.readdirSync).toHaveBeenCalledWith(path.join(srcDir, 'subdir'), {
        withFileTypes: true,
      });
    });
  });

  describe('handleTemplateCreationError', () => {
    it('should log error and exit', () => {
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as any);
      createTemplate.handleTemplateCreationError(new Error('fail'));
      expect(fmt.error).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });
  });
});
