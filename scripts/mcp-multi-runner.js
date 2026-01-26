#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_CONFIG = '.mcp.json';
const DEFAULT_TIMEOUT_MS = 30000;

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function parseArgs(argv) {
  const opts = {
    config: DEFAULT_CONFIG,
    servers: null,
    timeout: DEFAULT_TIMEOUT_MS,
    quiet: false,
  };
  const rest = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') {
      opts.config = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--config=')) {
      opts.config = arg.split('=')[1];
    } else if (arg === '--servers') {
      opts.servers = (argv[i + 1] || '').split(',').map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (arg.startsWith('--servers=')) {
      opts.servers = arg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--timeout') {
      opts.timeout = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--timeout=')) {
      opts.timeout = Number(arg.split('=')[1]);
    } else if (arg === '--quiet') {
      opts.quiet = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      rest.push(arg);
    }
  }

  return { opts, rest };
}

function usage() {
  return [
    'Usage:',
    '  node scripts/mcp-multi-runner.js list-servers [--config path]',
    '  node scripts/mcp-multi-runner.js list-tools <server> [--config path]',
    '  node scripts/mcp-multi-runner.js call-tool <server> <tool> [--args JSON]',
    '  node scripts/mcp-multi-runner.js run-plan <path-to-json>',
    '',
    'Options:',
    '  --config <path>    Path to .mcp.json (default: .mcp.json)',
    '  --servers <a,b>    Limit server startup to a subset',
    '  --timeout <ms>     Request timeout (default: 30000)',
    '  --quiet            Suppress non-JSON stdout lines',
  ].join('\n');
}

class MCPServerProcess {
  constructor(name, config, options) {
    this.name = name;
    this.config = config;
    this.options = options;
    this.proc = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
  }

  async start() {
    const env = { ...process.env, ...(this.config.env || {}) };
    this.proc = spawn(this.config.command, this.config.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    this.proc.stdout.on('data', (data) => {
      this.buffer += data.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        try {
          const message = JSON.parse(trimmed);
          this._handleMessage(message);
        } catch (err) {
          if (!this.options.quiet) {
            process.stderr.write(`[${this.name}] stdout: ${trimmed}\n`);
          }
        }
      }
    });

    this.proc.stderr.on('data', (data) => {
      process.stderr.write(`[${this.name}] ${data.toString()}`);
    });

    await this._initialize();
  }

  async _initialize() {
    await this.sendRequest('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'mcp-multi-runner',
        version: '1.0.0',
      },
    });
    this.sendNotification('initialized', {});
  }

  _handleMessage(message) {
    if (message && Object.prototype.hasOwnProperty.call(message, 'id')) {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message || 'MCP error'));
        } else {
          pending.resolve(message);
        }
      }
    }
  }

  sendNotification(method, params) {
    const payload = { jsonrpc: '2.0', method, params };
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  sendRequest(method, params) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = { jsonrpc: '2.0', id, method, params };
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for response to ${method}`));
      }, this.options.timeout);
      this.pending.set(id, {
        resolve: (message) => {
          clearTimeout(timeout);
          resolve(message);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });
    });
  }

  async listTools() {
    const response = await this.sendRequest('tools/list', {});
    return response.result;
  }

  async callTool(name, args) {
    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args || {},
    });
    return response.result;
  }

  async stop() {
    if (!this.proc) {
      return;
    }
    this.proc.kill();
  }
}

function resolveConfigPath(configPath) {
  if (path.isAbsolute(configPath)) {
    return configPath;
  }
  return path.resolve(process.cwd(), configPath);
}

function selectServers(config, requested) {
  const servers = config.mcpServers || {};
  const names = Object.keys(servers);
  if (!requested || requested.length === 0) {
    return names;
  }
  return names.filter((name) => requested.includes(name));
}

function extractArgsFlag(tokens) {
  const rest = [];
  let jsonArg = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--args') {
      jsonArg = tokens[i + 1] || '';
      i += 1;
    } else if (token.startsWith('--args=')) {
      jsonArg = token.slice('--args='.length);
    } else {
      rest.push(token);
    }
  }
  return { rest, jsonArg };
}

async function startServers(config, serverNames, options) {
  const processes = new Map();
  for (const name of serverNames) {
    const serverConfig = config.mcpServers[name];
    if (!serverConfig) {
      throw new Error(`Server "${name}" not found in config`);
    }
    const proc = new MCPServerProcess(name, serverConfig, options);
    await proc.start();
    processes.set(name, proc);
  }
  return processes;
}

async function stopServers(processes) {
  for (const proc of processes.values()) {
    await proc.stop();
  }
}

async function runPlan(planPath, config, options) {
  const plan = readJson(planPath);
  const steps = Array.isArray(plan) ? plan : plan.steps;
  if (!Array.isArray(steps)) {
    throw new Error('Plan file must be an array or { "steps": [...] }');
  }

  const serversNeeded = Array.from(new Set(steps.map((step) => step.server)));
  const processes = await startServers(config, serversNeeded, options);
  const results = [];

  try {
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      const proc = processes.get(step.server);
      if (!proc) {
        throw new Error(`Server "${step.server}" not started`);
      }
      const result = await proc.callTool(step.tool, step.args || {});
      results.push({
        index: i,
        server: step.server,
        tool: step.tool,
        result,
      });
    }
  } finally {
    await stopServers(processes);
  }

  return { results };
}

async function main() {
  const { opts, rest } = parseArgs(process.argv.slice(2));
  if (opts.help || rest.length === 0) {
    console.log(usage());
    process.exit(opts.help ? 0 : 1);
  }

  const configPath = resolveConfigPath(opts.config);
  const config = readJson(configPath);

  const command = rest[0];
  if (command === 'list-servers') {
    const serverNames = selectServers(config, opts.servers);
    console.log(JSON.stringify({ servers: serverNames }, null, 2));
    return;
  }

  if (command === 'list-tools') {
    const serverName = rest[1];
    if (!serverName) {
      throw new Error('list-tools requires a server name');
    }
    const processes = await startServers(config, [serverName], opts);
    try {
      const tools = await processes.get(serverName).listTools();
      console.log(JSON.stringify({ server: serverName, tools }, null, 2));
    } finally {
      await stopServers(processes);
    }
    return;
  }

  if (command === 'call-tool') {
    const { rest: callRest, jsonArg } = extractArgsFlag(rest.slice(1));
    const serverName = callRest[0];
    const toolName = callRest[1];
    const rawArgs = jsonArg || callRest.slice(2).join(' ');
    const toolArgs = rawArgs ? JSON.parse(rawArgs) : {};
    if (!serverName || !toolName) {
      throw new Error('call-tool requires <server> <tool> [--args JSON]');
    }
    const processes = await startServers(config, [serverName], opts);
    try {
      const result = await processes.get(serverName).callTool(toolName, toolArgs);
      console.log(JSON.stringify({ server: serverName, tool: toolName, result }, null, 2));
    } finally {
      await stopServers(processes);
    }
    return;
  }

  if (command === 'run-plan') {
    const planPath = rest[1];
    if (!planPath) {
      throw new Error('run-plan requires a JSON plan path');
    }
    const resolvedPlan = path.resolve(process.cwd(), planPath);
    const output = await runPlan(resolvedPlan, config, opts);
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
