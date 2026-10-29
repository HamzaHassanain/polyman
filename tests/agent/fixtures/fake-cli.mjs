// A fake polyman CLI for the runner tests. Each argument is one step, done in
// order:
//   out:<text>     print a line to stdout
//   err:<text>     print a line to stderr
//   raw:<text>     print text to stdout, no newline
//   big:<n>        print n "x" characters to stdout, in 100-char lines
//   bigerr:<n>     the same on stderr
//   ansi           print a colored line to stderr
//   env            print POLYMAN_AGENT, NO_COLOR, FORCE_COLOR as JSON
//   sleep:<ms>     wait
//   child:<file>   start a child that sleeps 60 s, write its pid to <file>
//   ignore-term    ignore SIGTERM (the runner must use SIGKILL)
//   exit:<code>    exit with this code
// Other arguments (like --json) are ignored.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

for (const arg of process.argv.slice(2)) {
  const at = arg.indexOf(':');
  const step = at === -1 ? arg : arg.slice(0, at);
  const value = at === -1 ? '' : arg.slice(at + 1);
  if (step === 'out') {
    process.stdout.write(`${value}\n`);
  } else if (step === 'err') {
    process.stderr.write(`${value}\n`);
  } else if (step === 'raw') {
    process.stdout.write(value);
  } else if (step === 'big' || step === 'bigerr') {
    const stream = step === 'big' ? process.stdout : process.stderr;
    let left = Number(value);
    while (left > 0) {
      const size = Math.min(left, 100);
      stream.write(`${'x'.repeat(size - 1)}\n`);
      left -= size;
    }
  } else if (step === 'ansi') {
    process.stderr.write('\u001b[31mred line\u001b[0m\n');
  } else if (step === 'env') {
    process.stdout.write(
      `${JSON.stringify({
        POLYMAN_AGENT: process.env.POLYMAN_AGENT,
        NO_COLOR: process.env.NO_COLOR,
        FORCE_COLOR: process.env.FORCE_COLOR,
        cwd: process.cwd(),
      })}\n`
    );
  } else if (step === 'sleep') {
    await sleep(Number(value));
  } else if (step === 'child') {
    const child = spawn(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 60000)'],
      { stdio: 'ignore' }
    );
    writeFileSync(value, String(child.pid));
  } else if (step === 'ignore-term') {
    process.on('SIGTERM', () => {});
  } else if (step === 'exit') {
    // Let stdout drain before the exit.
    await new Promise(resolve => process.stdout.write('', resolve));
    process.exit(Number(value));
  }
}
