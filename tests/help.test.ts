import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { printComprehensiveHelp } from '../src/help';

describe('help.ts', () => {
  let output: string[];

  beforeEach(() => {
    output = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(
        args.map(a => (typeof a === 'string' ? a : String(a))).join(' ')
      );
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const collected = () => output.join('\n');

  it('should print program name, description, and version header', () => {
    const program = new Command();
    program.name('polyman').description('CLI tool').version('9.9.9');

    printComprehensiveHelp(program);

    const out = collected();
    expect(out).toContain('polyman');
    expect(out).toContain('CLI tool');
    expect(out).toContain('v9.9.9');
  });

  it('should not print Commands section when there are no subcommands', () => {
    const program = new Command();
    program.name('empty').description('nothing').version('1.0.0');

    printComprehensiveHelp(program);

    const out = collected();
    expect(out).not.toContain('Commands:');
  });

  it('should print top-level command names and descriptions', () => {
    const program = new Command();
    program.name('polyman').description('root').version('1.0.0');
    program.command('build').description('Build the project');
    program.command('serve').description('Serve files');

    printComprehensiveHelp(program);

    const out = collected();
    expect(out).toContain('build');
    expect(out).toContain('Build the project');
    expect(out).toContain('serve');
    expect(out).toContain('Serve files');
  });

  it('should print required and optional arguments in signature', () => {
    const program = new Command();
    program.name('polyman').description('root').version('1.0.0');
    program.command('cmd <required> [optional]').description('takes args');

    printComprehensiveHelp(program);

    const out = collected();
    expect(out).toContain('<required>');
    expect(out).toContain('[optional]');
  });

  it('should print options for a command', () => {
    const program = new Command();
    program.name('polyman').description('root').version('1.0.0');
    program
      .command('do')
      .description('do thing')
      .option('-a, --all', 'do all')
      .option('-t, --target <name>', 'specific target');

    printComprehensiveHelp(program);

    const out = collected();
    expect(out).toContain('Options:');
    expect(out).toContain('-a, --all');
    expect(out).toContain('do all');
    expect(out).toContain('-t, --target <name>');
    expect(out).toContain('specific target');
  });

  it('should print alias when command has alias', () => {
    const program = new Command();
    program.name('polyman').description('root').version('1.0.0');
    program.command('install').alias('i').description('install something');

    printComprehensiveHelp(program);

    const out = collected();
    expect(out).toContain('install|i');
  });

  it('should recursively print subcommands', () => {
    const program = new Command();
    program.name('polyman').description('root').version('1.0.0');
    const remote = program.command('remote').description('remote ops');
    remote.command('list').description('list remote');
    remote.command('pull <id>').description('pull from remote');

    printComprehensiveHelp(program);

    const out = collected();
    expect(out).toContain('remote');
    expect(out).toContain('remote ops');
    expect(out).toContain('list');
    expect(out).toContain('list remote');
    expect(out).toContain('pull');
    expect(out).toContain('<id>');
    expect(out).toContain('pull from remote');
  });

  it('should print divider between top-level commands', () => {
    const program = new Command();
    program.name('polyman').description('root').version('1.0.0');
    program.command('one').description('first');
    program.command('two').description('second');

    printComprehensiveHelp(program);

    const out = collected();
    expect(out).toContain('---');
  });

  it('should print Commands header when subcommands exist on root', () => {
    const program = new Command();
    program.name('polyman').description('root').version('1.0.0');
    const parent = program.command('parent').description('parent cmd');
    parent.command('child').description('child cmd');

    printComprehensiveHelp(program);

    const out = collected();
    expect(out).toContain('Commands:');
  });

  it('should return undefined', () => {
    const program = new Command();
    program.name('p').description('d').version('1.0.0');
    const result = printComprehensiveHelp(program);
    expect(result).toBeUndefined();
  });
});
