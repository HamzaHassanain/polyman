#! /usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('polyman')
  .description(
    'CLI tool for Codeforces problem setters to manage problems via terminal'
  )
  .version('1.0.0');

program
  .command('init <problem-name> <directory>')
  .description('Create a new problem in the specified directory')
  .action((problemName, directory) => {
    console.log(`Creating problem: ${problemName} in directory: ${directory}`);
    // Logic to create a new problem goes here
    // print the current working directory
    console.log(__dirname);
    console.log(`Current working directory: ${process.cwd()}`);
    console.log(`Creating problem: ${problemName} in directory: ${directory}`);
  });

program
  .command('test <problem-name>')
  .description('Test an existing problem')
  .action(problemName => {
    console.log(`Testing problem: ${problemName}`);
    // Logic to test the problem goes here
  });

program
  .command('update <problem-name>')
  .description('Update an existing problem')
  .action(problemName => {
    console.log(`Updating problem: ${problemName}`);
    // Logic to update the problem goes here
  });

program.parse(process.argv);
