import path from 'path';
import { executor } from '../executor';
import fs from 'fs';
import { logger } from '../logger';
import ConfigFile from '../types';

export const DEFAULT_TIMEOUT = 10000;
export const DEFAULT_MEMORY_LIMIT = 1024;

export async function compileCPP(sourcePath: string): Promise<string> {
  const absolutePath = path.resolve(process.cwd(), sourcePath);

  if (path.extname(absolutePath) !== '.cpp') {
    throw new Error(`Expected .cpp file, got: ${absolutePath}`);
  }

  const outputPath = absolutePath.replace('.cpp', '');
  const compileCommand = `g++ -o ${outputPath} ${absolutePath} -O2 -std=c++23`;

  await executor.execute(compileCommand, {
    timeout: DEFAULT_TIMEOUT,
    silent: true,
  });

  return outputPath;
}

export async function compileJava(sourcePath: string): Promise<string> {
  const absolutePath = path.resolve(sourcePath);
  const directory = path.dirname(absolutePath);
  const fileName = path.basename(absolutePath);
  const className = fileName.replace('.java', '');

  await executor.execute(`javac ${absolutePath}`, {
    timeout: DEFAULT_TIMEOUT,
    silent: true,
  });

  return `java -cp ${directory} ${className}`;
}

export function filterTestsByRange(
  testFiles: string[],
  testBegin?: number,
  testEnd?: number
): string[] {
  if (testBegin === undefined || testEnd === undefined) {
    return testFiles;
  }

  return testFiles.filter(file => {
    if (!file.startsWith('test')) return false;

    const numberPart = file.slice(4, file.lastIndexOf('.'));
    const testNumber = parseInt(numberPart, 10);

    return (
      !isNaN(testNumber) && testNumber >= testBegin && testNumber <= testEnd
    );
  });
}
export function readConfigFile(): ConfigFile {
  try {
    const configFilePath = path.resolve(process.cwd(), 'Config.json');
    const configData = fs.readFileSync(configFilePath, 'utf-8');
    return JSON.parse(configData) as ConfigFile;
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error('Failed to read or parse Config.json file.');
  }
}
export function isNumeric(value: string): boolean {
  return !isNaN(parseInt(value, 10));
}
export function logError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`${message}`);
}
export function logErrorAndExit(error: unknown) {
  logError(error);
  process.exit(1);
}
export function logErrorAndThrow(error: unknown, message = '') {
  logError(error);
  throwError(error, message);
}
export function throwError(error: unknown, message = ''): never {
  throw error instanceof Error
    ? error
    : new Error(`${message}: ${String(error)}`);
}

export function ensureDirectoryExists(dirName: string) {
  const dirPath = path.resolve(process.cwd(), dirName);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
export function removeDirectoryRecursively(dirName: string) {
  const dirPath = path.resolve(process.cwd(), dirName);
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}
