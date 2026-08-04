/**
 * Quotes one argument so that it can be safely included in a shell command.
 *
 * This prevents spaces and shell metacharacters in file paths and other
 * individual arguments from being interpreted by the shell.
 */
export function quoteShellArgument(value: string): string {
  if (process.platform === 'win32') {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}
