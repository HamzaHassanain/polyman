import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as steps from '../src/steps';
import * as createTemplate from '../src/helpers/create-template';
import * as testlibDownload from '../src/helpers/testlib-download';
import * as validator from '../src/helpers/validator';
import * as generator from '../src/helpers/generator';
import * as formatter from '../src/formatter';
import fs from 'fs';

vi.mock('../src/helpers/create-template');
vi.mock('../src/helpers/testlib-download');
vi.mock('../src/helpers/utils');
vi.mock('../src/helpers/validator');
vi.mock('../src/helpers/checker');
vi.mock('../src/helpers/generator');
vi.mock('../src/formatter');
vi.mock('fs');

describe('steps.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('stepCreateDirectoryStructure', () => {
    it('should create directories', () => {
      vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
      steps.stepCreateDirectoryStructure(1, 'prob');
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(formatter.fmt.step).toHaveBeenCalledWith(1, expect.any(String));
    });
  });

  describe('stepCopyTemplateFiles', () => {
    it('should copy templates', () => {
      steps.stepCopyTemplateFiles(2, 'prob');
      expect(createTemplate.copyTemplate).toHaveBeenCalled();
      expect(formatter.fmt.stepComplete).toHaveBeenCalled();
    });
  });

  describe('stepDownloadTestlib', () => {
    it('should download and return testlib', async () => {
      vi.mocked(testlibDownload.downloadFile).mockResolvedValue('testlib code');
      const result = await steps.stepDownloadTestlib(3);
      expect(result).toBe('testlib code');
      expect(testlibDownload.downloadFile).toHaveBeenCalled();
    });

    it('should fail if download fails', async () => {
      vi.mocked(testlibDownload.downloadFile).mockRejectedValue(
        new Error('fail')
      );
      await expect(steps.stepDownloadTestlib(3)).rejects.toThrow('fail');
    });
  });

  describe('stepCompileValidator', () => {
    it('should compile validator', async () => {
      const config: any = { validator: 'val' };
      await steps.stepCompileValidator(4, config);
      expect(validator.compileValidator).toHaveBeenCalled();
    });
  });

  describe('stepCompileGeneratorsForTestsets', () => {
    it('should compile generators', async () => {
      await steps.stepCompileGeneratorsForTestsets(5, {} as any);
      expect(generator.compileGeneratorsForTestsets).toHaveBeenCalled();
    });
  });
});
