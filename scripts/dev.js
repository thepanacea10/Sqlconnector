import { spawn } from 'node:child_process';

function npmProcessArgs(args) {
  if (process.platform !== 'win32') {
    return { command: 'npm', args };
  }

  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', ['npm.cmd', ...args].join(' ')]
  };
}

function run(name, args) {
  const processArgs = npmProcessArgs(args);
  const child = spawn(processArgs.command, processArgs.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });

  return child;
}

const processes = [
  run('api', ['run', 'backend']),
  run('web', ['run', 'frontend'])
];

const stopAll = (code = 0) => {
  for (const child of processes) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
  process.exit(code);
};

for (const child of processes) {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      stopAll(code);
    }
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
