import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as testset from '../../src/helpers/testset';
import * as generator from '../../src/helpers/generator';
import * as utils from '../../src/helpers/utils';
import { LocalTestset } from '../../src/types';

vi.mock('../../src/helpers/generator');
vi.mock('../../src/helpers/utils');
vi.mock('fs');
vi.mock('../../src/formatter');
vi.mock('../../src/helpers/script-parser', () => ({
  validateGeneratorCommands: vi.fn(),
}));

describe('testset.ts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('ensureTestsetsExist', () => {
        it('should not throw if testsets exist', () => {
            expect(() => testset.ensureTestsetsExist([{ name: 'ts1' } as any])).not.toThrow();
        });

        it('should throw if testsets is undefined', () => {
             expect(() => testset.ensureTestsetsExist(undefined)).toThrow('No testsets defined');
        });

        it('should throw if testsets is empty', () => {
             expect(() => testset.ensureTestsetsExist([])).toThrow('No testsets defined');
        });
    });

    describe('findTestset', () => {
        const testsets: any[] = [{ name: 'main', generatorScript: { commands: [] } }];

        it('should find testset by name', () => {
            expect(testset.findTestset(testsets, 'main')).toEqual(testsets[0]);
        });

        it('should throw if testset not found', () => {
            expect(() => testset.findTestset(testsets, 'missing')).toThrow(/Testset "missing" not found/);
        });
    });

    describe('getGeneratorCommands', () => {
        it('should return commands if present', () => {
             const ts: LocalTestset = {
                 name: 'ts1',
                 generatorScript: { commands: [{ type: 'manual', command: 'gen' }] }
             } as any;
             expect(testset.getGeneratorCommands(ts)).toEqual(ts.generatorScript!.commands);
        });

        it('should throw if generatorScript is undefined', () => {
             const ts: LocalTestset = { name: 'ts1' };
             expect(() => testset.getGeneratorCommands(ts)).toThrow(/has no generator script defined/);
        });

        it('should throw if commands array is empty (and no other options)', () => {
             const ts: LocalTestset = { name: 'ts1', generatorScript: { commands: [] } } as any;
              expect(() => testset.getGeneratorCommands(ts)).toThrow(/has no commands/);
        });
    });

    describe('generateTestsForTestset', () => {
        it('should generate tests successfully with default dir', async () => {
            const mockTestset = {
                name: 'main',
                generatorScript: { commands: [{ type: 'generator', command: 'gen', args: [] }] },
            } as any;
            vi.mocked(utils.ensureDirectoryExists).mockImplementation(() => {});
            vi.mocked(generator.executeGeneratorScript).mockResolvedValue(undefined);

            await expect(testset.generateTestsForTestset(mockTestset, [])).resolves.not.toThrow();
            
            expect(utils.ensureDirectoryExists).toHaveBeenCalledWith(expect.stringContaining('testsets/main')); // Default
            expect(generator.executeGeneratorScript).toHaveBeenCalled();
        });

        it('should use custom output directory', async () => {
             const mockTestset = { name: 'main', generatorScript: { commands: [{ type: 'manual', command: '' }] } } as any;
             await testset.generateTestsForTestset(mockTestset, [], '/custom/path');
             expect(utils.ensureDirectoryExists).toHaveBeenCalledWith('/custom/path');
        });
    });
    
    describe('generateSingleTest', () => {
         const mockTestset: LocalTestset = {
                name: 'main',
                generatorScript: { commands: [
                    { type: 'manual', command: 'c1' },
                    { type: 'manual', command: 'c2' }
                ] },
            } as any;

         it('should generate specific test index', async () => {
              await testset.generateSingleTest(mockTestset, 2, []);
              expect(generator.executeGeneratorScript).toHaveBeenCalledWith(
                  [{ type: 'manual', command: 'c2' }], 
                  [], 
                  expect.anything()
              );
         });

         it('should throw if index is too low', async () => {
              await expect(testset.generateSingleTest(mockTestset, 0, [])).rejects.toThrow(/Test index 0 is out of range/);
         });

         it('should throw if index is too high', async () => {
               await expect(testset.generateSingleTest(mockTestset, 3, [])).rejects.toThrow(/Test index 3 is out of range/);
         });
    });

    describe('generateTestsForGroup', () => {
          const mockTestset: LocalTestset = {
                name: 'main',
                generatorScript: { commands: [
                    { type: 'manual', command: 'c1', group: 'g1' },
                    { type: 'manual', command: 'c2', group: 'g2' },
                    { type: 'manual', command: 'c3', group: 'g1' }
                ] },
            } as any;
          
          it('should generate tests for specific group', async () => {
              await testset.generateTestsForGroup(mockTestset, 'g1', []);
              expect(generator.executeGeneratorScript).toHaveBeenCalledWith(
                  [
                      { type: 'manual', command: 'c1', group: 'g1' },
                      { type: 'manual', command: 'c3', group: 'g1' }
                  ],
                  [],
                  expect.anything()
              );
          });

          it('should generate all tests if group is "all"', async () => {
               await testset.generateTestsForGroup(mockTestset, 'all', []);
               expect(generator.executeGeneratorScript).toHaveBeenCalledWith(
                   mockTestset.generatorScript!.commands,
                   [],
                   expect.anything()
               );
          });

          it('should throw if group not found', async () => {
               await expect(testset.generateTestsForGroup(mockTestset, 'missing', [])).rejects.toThrow(/No tests found in group/);
          });
    });

    describe('generateAllTestsets', () => {
         it('should iterate all testsets', async () => {
             const ts1 = { name: 'ts1', generatorScript: { commands: [{ type: 'manual' }] } } as any;
             const ts2 = { name: 'ts2', generatorScript: { commands: [{ type: 'manual' }] } } as any;
             
             await testset.generateAllTestsets([ts1, ts2], []);
             expect(generator.executeGeneratorScript).toHaveBeenCalledTimes(2);
         });

         it('should handle errors in individual testsets', async () => {
             const ts1 = { name: 'ts1', generatorScript: null } as any; // Will throw inside getGeneratorCommands
             vi.mocked(utils.throwError).mockImplementation((err, msg) => { throw new Error(msg); });

             await expect(testset.generateAllTestsets([ts1], [])).rejects.toThrow(/Failed to generate testset "ts1"/);
         });
    });

    describe('listTestsets', () => {
        it('should list testsets with info', () => {
             const ts: LocalTestset = { 
                 name: 'ts1', 
                 generatorScript: { commands: [{}, {}] as any}, 
                 groups: [{ name: 'g1' }]
             } as any;
             
             const result = testset.listTestsets([ts]);
             expect(result[0]).toContain('ts1: 2 tests');
             expect(result[0]).toContain('groups: g1');
        });
        
        it('should handle missing scripts/groups', () => {
             const ts: LocalTestset = { name: 'ts1' } as any;
             const result = testset.listTestsets([ts]);
             expect(result[0]).toContain('ts1: 0 tests');
             expect(result[0]).toContain('groups: none');
        });
    });
});
