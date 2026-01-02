
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as actions from '../src/actions';
import * as steps from '../src/steps';
import * as utils from '../src/helpers/utils';
import * as formatter from '../src/formatter';
import fs from 'fs';
import path from 'path';

vi.mock('../src/steps');
vi.mock('../src/helpers/utils');
vi.mock('../src/formatter');
vi.mock('fs');


describe('actions.ts', () => {
    beforeEach(() => {
         vi.clearAllMocks();
         vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
         vi.spyOn(process, 'cwd').mockReturnValue('/mock/cwd');
    });

    describe('createTemplateAction', () => {
        it('should create template successfully', () => {
             actions.createTemplateAction('prob');
             expect(steps.stepCreateDirectoryStructure).toHaveBeenCalled();
             expect(steps.stepCopyTemplateFiles).toHaveBeenCalled();
             expect(formatter.fmt.successBox).toHaveBeenCalled();
        });

        it('should handle errors', () => {
             vi.mocked(steps.stepCreateDirectoryStructure).mockImplementation(() => { throw new Error('fail'); });
             actions.createTemplateAction('prob');
             expect(formatter.fmt.errorBox).toHaveBeenCalled();
             expect(process.exit).toHaveBeenCalledWith(1);
        });
    });

    describe('downloadTestlibAction', () => {
        it('should download testlib successfully', async () => {
             vi.mocked(steps.stepDownloadTestlib).mockResolvedValue('code');
             await actions.downloadTestlibAction();
             expect(steps.stepDownloadTestlib).toHaveBeenCalled();
             expect(steps.stepSaveTestlibToDirectory).toHaveBeenCalled();
             expect(formatter.fmt.successBox).toHaveBeenCalled();
        });
    });

    describe('generateTestsAction', () => {
         it('should generate all tests', async () => {
             vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
             await actions.generateTestsAction('all');
             expect(steps.stepGenerateAllTestsets).toHaveBeenCalled();
         });

         it('should generate specific testset', async () => {
             const config: any = { testsets: [{ name: 'ts1' }] };
             vi.mocked(utils.readConfigFile).mockReturnValue(config);
             await actions.generateTestsAction('ts1');
             expect(steps.stepCompileGeneratorsForTestset).toHaveBeenCalled();
         });
    });

    describe('validateTestsAction', () => {
         it('should validate all tests', async () => {
             vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
             await actions.validateTestsAction('all');
             expect(steps.stepValidateAllTestsets).toHaveBeenCalled();
         });
    });

    describe('runSolutionAction', () => {
         it('should run solutions on all tests', async () => {
             const config: any = { solutions: [{name: 'main', tag: 'MA'}] };
             vi.mocked(utils.readConfigFile).mockReturnValue(config);
             await actions.runSolutionAction('main', 'all');
             expect(steps.stepRunSolutionsOnAllTestsets).toHaveBeenCalled();
         });
    });
});
