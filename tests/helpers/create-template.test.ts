import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Dirent } from 'fs';
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
      const infoSpy = vi.spyOn(fmt, 'info');
      const logSpy = vi.spyOn(fmt, 'log');
      createTemplate.logTemplateCreationSuccess('my-problem');
      expect(infoSpy).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledTimes(8);
    });
  });

  describe('copyTemplate', () => {
    it('should copy files and directories recursively', () => {
      const srcDir = 'template';
      const destDir = 'problem';

      const mockEntries: Dirent[] = [
        { name: 'file.txt', isDirectory: () => false } as Dirent,
        { name: 'subdir', isDirectory: () => true } as Dirent,
      ];

      // Mock readdirSync to return entries for srcDir, and empty for subdir to stop recursion
      const readdirMock = vi.mocked(fs.readdirSync) as unknown as ReturnType<
        typeof vi.fn<(dir: string) => Dirent[]>
      >;
      readdirMock.mockImplementation((dir: string): Dirent[] => {
        if (dir === srcDir) return mockEntries;
        return [];
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
        .mockImplementation((_code?: string | number | null) => {
          return undefined as never;
        });
      const errorSpy = vi.spyOn(fmt, 'error');
      createTemplate.handleTemplateCreationError(new Error('fail'));
      expect(errorSpy).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });
  });
});
