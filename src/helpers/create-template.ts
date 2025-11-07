import fs from 'fs';
import path from 'path';
import { fmt } from '../formatter';

export function logTemplateCreationSuccess(directory: string) {
  console.log();
  fmt.info(`  ${fmt.infoIcon()} ${fmt.bold('Next steps:')}`);
  console.log();
  fmt.log(`    ${fmt.primary('1.')} cd ${fmt.highlight(directory)}`);
  fmt.log(
    `    ${fmt.primary('2.')} Add your solutions, generators, and validator`
  );
  fmt.log(
    `    ${fmt.primary('3.')} Edit ${fmt.highlight('Config.json')} to configure your problem`
  );
  fmt.log(
    `    ${fmt.primary('4.')} Run ${fmt.highlight('polyman generate-tests all')} to generate tests`
  );
  fmt.log(
    `    ${fmt.primary('5.')} Run ${fmt.highlight('polyman validate-tests all')} to validate tests`
  );
  fmt.log(
    `    ${fmt.primary('6.')} Run ${fmt.highlight('polyman verify')} for full verification`
  );
  console.log();
}
export function copyTemplate(srcDir: string, destDir: string) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyTemplate(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
export function handleTemplateCreationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  fmt.error(`${fmt.cross()} ${message}`);
  process.exit(1);
}
