import { ComputerService } from './apps/host/dist/server/server/computer-service.js';
import { computerTools } from './apps/host/dist/server/server/computer-tools.js';
import { WorkspaceStore } from './apps/host/dist/server/server/workspace.js';

const config = {
  computerMode: 'local',
  computerLocalRoot: process.cwd() + '/data/aegis-computers',
  browserUrl: 'http://127.0.0.1:4311',
  browserSecret: 'test',
};

const workspace = new WorkspaceStore('data/test-tools.sqlite', {});
const service = new ComputerService(workspace, config, () => false);
const dot = workspace.dots()[0];

console.log('dots:', workspace.dots().map(d => ({ id: d.id, name: d.name })));

const perms = { enabled: true, browser: true, files: true, shell: true };
const tools = computerTools(service, dot.id, () => {}, new AbortController().signal, perms);

console.log('tool count:', tools.length);
console.log('tool names:', tools.map(t => t.name));

workspace.close?.();
process.exit(0);
