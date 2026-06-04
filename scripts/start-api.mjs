import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = path.join(root, 'server', 'server.mjs');
const port = Number(process.env.API_PORT || process.env.PORT || 4288);

await stopExistingProjectServer(port);

const child = spawn(process.execPath, [serverEntry], {
  cwd: root,
  env: {
    ...process.env,
    API_PORT: String(port)
  },
  stdio: 'inherit'
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

async function stopExistingProjectServer(targetPort) {
  const pids = await listeningPids(targetPort);
  const stopPids = new Set(pids);
  for (const pid of pids) {
    if (pid === process.pid) continue;
    const command = await processCommand(pid);
    if (!isProjectServer(command)) {
      console.error(`Port ${targetPort} is occupied by another process: ${pid} ${command}`);
      console.error('Stop it manually or set API_PORT to another port.');
      process.exit(1);
    }
    const parentPid = await processParentPid(pid);
    const parentCommand = parentPid ? await processCommand(parentPid) : '';
    if (parentPid && isProjectServer(parentCommand)) stopPids.add(parentPid);
  }
  for (const pid of [...stopPids].sort((a, b) => a - b)) {
    if (pid === process.pid) continue;
    await stopProcess(pid);
  }
  await waitForPortFree(targetPort, 3000);
}

async function listeningPids(targetPort) {
  try {
    const { stdout } = await execFileAsync('lsof', ['-ti', `TCP:${targetPort}`, '-sTCP:LISTEN']);
    return stdout.split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

async function processCommand(pid) {
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command=']);
    return stdout.trim();
  } catch {
    return '';
  }
}

function isProjectServer(command) {
  return command.includes('server/server.mjs') || command.includes('scripts/start-api.mjs') || command.includes(serverEntry);
}

async function processParentPid(pid) {
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'ppid=']);
    return Number(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

async function stopProcess(pid) {
  if (!(await isAlive(pid))) return;
  const command = await processCommand(pid);
  console.log(`Stopping old API process on port ${port}: ${pid} ${command}`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
    return;
  }
  await waitForExit(pid, 2500);
  if (await isAlive(pid)) {
    console.log(`Old API process did not exit, sending SIGKILL: ${pid}`);
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
      return;
    }
    await waitForExit(pid, 1000);
  }
}

async function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await isAlive(pid))) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function waitForPortFree(targetPort, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const pids = await listeningPids(targetPort);
    if (!pids.length || pids.every(pid => pid === process.pid)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
