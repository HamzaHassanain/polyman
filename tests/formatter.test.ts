
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fmt, Formatter } from '../src/formatter';
import chalk from 'chalk';

describe('Formatter', () => {
  let consoleSpy: any;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be a singleton instance', () => {
    expect(fmt).toBeInstanceOf(Formatter);
  });

  describe('logging methods', () => {
    it('should log success message in green', () => {
      fmt.success('Success message');
      expect(consoleSpy).toHaveBeenCalledWith(chalk.green('Success message'));
    });

    it('should log error message in red', () => {
      fmt.error('Error message');
      expect(consoleSpy).toHaveBeenCalledWith(chalk.red('Error message'));
    });

    it('should log warning message in yellow', () => {
      fmt.warning('Warning message');
      expect(consoleSpy).toHaveBeenCalledWith(chalk.yellow('Warning message'));
    });

    it('should log info message in white', () => {
      fmt.info('Info message');
      expect(consoleSpy).toHaveBeenCalledWith(chalk.white('Info message'));
    });

    it('should log gray message', () => {
      fmt.log('Log message');
      expect(consoleSpy).toHaveBeenCalledWith(chalk.gray('Log message'));
    });
  });

  describe('icon methods', () => {
    it('should return green checkmark', () => {
      expect(fmt.checkmark()).toBe(chalk.green('✓'));
    });

    it('should return red cross', () => {
      expect(fmt.cross()).toBe(chalk.red('✖'));
    });

    it('should return yellow warning icon', () => {
      expect(fmt.warningIcon()).toBe(chalk.yellow('⚠'));
    });

    it('should return blue info icon', () => {
      expect(fmt.infoIcon()).toBe(chalk.blue('ℹ'));
    });
  });

  describe('style methods', () => {
      it('should return highlighted text', () => {
          expect(fmt.highlight('text')).toBe(chalk.bold.blue('text'));
      });
      
      it('should return dimmed text', () => {
          expect(fmt.dim('text')).toBe(chalk.dim('text'));
      });

      it('should return bold text', () => {
          expect(fmt.bold('text')).toBe(chalk.bold('text'));
      });

       it('should return accent text', () => {
          expect(fmt.accent('text')).toBe(chalk.hex('#FF6B6B')('text'));
      });

       it('should return primary text', () => {
          expect(fmt.primary('text')).toBe(chalk.hex('#1E88E5')('text'));
      });
  });

  describe('complex output methods', () => {
    it('should print section header', () => {
        fmt.section('Title');
        expect(consoleSpy).toHaveBeenCalledTimes(5); // empty, line, title, line, empty
    });

    it('should print step', () => {
        fmt.step(1, 'Step Title');
        expect(consoleSpy).toHaveBeenCalledTimes(2); // empty, step line
    });

    it('should print step complete', () => {
        fmt.stepComplete('Done');
        expect(consoleSpy).toHaveBeenCalledWith(chalk.green(`└─ ✓ Done`));
    });
    
    it('should print step complete default', () => {
        fmt.stepComplete();
        expect(consoleSpy).toHaveBeenCalledWith(chalk.green(`└─ ✓ Complete`));
    });

    it('should print success box', () => {
        fmt.successBox('Yay');
        expect(consoleSpy).toHaveBeenCalledTimes(5);
    });

    it('should print error box', () => {
        fmt.errorBox('Nay');
        expect(consoleSpy).toHaveBeenCalledTimes(5);
    });
  });
});
