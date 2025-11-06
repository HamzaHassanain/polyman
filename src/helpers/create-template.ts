import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

export function logTemplateCreationSuccess(directory: string) {
  console.log();
  logger.info(logger.bold('Next steps:'));
  console.log();
  logger.log(`  ${logger.primary('1.')} cd ${logger.highlight(directory)}`);
  logger.log(
    `  ${logger.primary('2.')} Add your solutions, generators, and validator`
  );
  logger.log(
    `  ${logger.primary('3.')} Edit ${logger.highlight('Config.json')} to configure your problem`
  );
  logger.log(
    `  ${logger.primary('4.')} Run ${logger.highlight('polyman generate-tests all')} to generate tests`
  );
  logger.log(
    `  ${logger.primary('5.')} Run ${logger.highlight('polyman validate-tests all')} to validate tests`
  );
  logger.log(
    `  ${logger.primary('6.')} Run ${logger.highlight('polyman verify')} for full verification`
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
  logger.error(message);
  process.exit(1);
}
