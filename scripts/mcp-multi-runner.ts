#!/usr/bin/env node
// Runs with Node's built-in type stripping (`node scripts/mcp-multi-runner.ts`) or `bun`.
// Keep it erasable-syntax only: no enums, namespaces or constructor parameter properties.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_CONFIG = '.mcp.json';
const DEFAULT_TIMEOUT_MS = 30000;

interface Options {
  config: string;
  servers: string[] | null;
  timeout: number;
  quiet: boolean;
  help?: boolean;
}

interface ServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpConfig {
  mcpServers?: Record<string, ServerConfig>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface PendingRequest {
  resolve: (message: JsonRpcResponse) => void;
  reject: (err: Error) => void;
}

interface PlanStep {
  server: string;
  tool: string;
  args?: Record<string, unknown>;
}

function readJson(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArgs(argv: string[]): { opts: Options; rest: string[] } {
  const opts: Options = {
    config: DEFAULT_CONFIG,
    servers: null,
    timeout: DEFAULT_TIMEOUT_MS,
    quiet: false,
  };
  const rest: string[] = [];
  const splitList = (value: string | undefined): string[] =>
    (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const inlineValue = arg.slice(arg.indexOf('=') + 1);
    if (arg === '--config') {
      opts.config = argv[i + 1] ?? DEFAULT_CONFIG;
      i += 1;
    } else if (arg.startsWith('--config=')) {
      opts.config = inlineValue;
    } else if (arg === '--servers') {
      opts.servers = splitList(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--servers=')) {
      opts.servers = splitList(inlineValue);
    } else if (arg === '--timeout') {
      opts.timeout = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--timeout=')) {
      opts.timeout = Number(inlineValue);
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

function usage(): string {
  return [
    'Usage:',
    '  node scripts/mcp-multi-runner.ts list-servers [--config path]',
    '  node scripts/mcp-multi-runner.ts list-tools <server> [--config path]',
    '  node scripts/mcp-multi-runner.ts call-tool <server> <tool> [--args JSON]',
    '  node scripts/mcp-multi-runner.ts run-plan <path-to-json>',
    '',
    'Options:',
    '  --config <path>    Path to .mcp.json (default: .mcp.json)',
    '  --servers <a,b>    Limit server startup to a subset',
    '  --timeout <ms>     Request timeout (default: 30000)',
    '  --quiet            Suppress non-JSON stdout lines',
  ].join('\n');
}

class MCPServerProcess {
  readonly name: string;
  readonly config: ServerConfig;
  readonly options: Options;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(name: string, config: ServerConfig, options: Options) {
    this.name = name;
    this.config = config;
    this.options = options;
  }

  async start(): Promise<void> {
    const env = { ...process.env, ...this.config.env };
    const proc = spawn(this.config.command, this.config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    this.proc = proc;

    proc.stdout.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        try {
          this.handleMessage(JSON.parse(trimmed));
        } catch {
          if (!this.options.quiet) {
            process.stderr.write(`[${this.name}] stdout: ${trimmed}\n`);
          }
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      process.stderr.write(`[${this.name}] ${data.toString()}`);
    });

    await this.initialize();
  }

  private async initialize(): Promise<void> {
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

  private handleMessage(message: unknown): void {
    if (!isRecord(message) || typeof message.id !== 'number') {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    const response = message as unknown as JsonRpcResponse;
    if (response.error) {
      pending.reject(new Error(response.error.message || 'MCP error'));
    } else {
      pending.resolve(response);
    }
  }

  private write(payload: object): void {
    if (!this.proc) {
      throw new Error(`Server "${this.name}" is not running`);
    }
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  sendNotification(method: string, params: object): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  sendRequest(method: string, params: object): Promise<JsonRpcResponse> {
    const id = this.nextId;
    this.nextId += 1;
    this.write({ jsonrpc: '2.0', id, method, params });

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

  async listTools(): Promise<unknown> {
    const response = await this.sendRequest('tools/list', {});
    return response.result;
  }

  async callTool(name: string, args: Record<string, unknown> | undefined): Promise<unknown> {
    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args ?? {},
    });
    return response.result;
  }

  stop(): void {
    this.proc?.kill();
  }
}

function resolveConfigPath(configPath: string): string {
  if (path.isAbsolute(configPath)) {
    return configPath;
  }
  return path.resolve(process.cwd(), configPath);
}

function selectServers(config: McpConfig, requested: string[] | null): string[] {
  const names = Object.keys(config.mcpServers ?? {});
  if (!requested || requested.length === 0) {
    return names;
  }
  return names.filter((name) => requested.includes(name));
}

function extractArgsFlag(tokens: string[]): { rest: string[]; jsonArg: string | null } {
  const rest: string[] = [];
  let jsonArg: string | null = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? '';
    if (token === '--args') {
      jsonArg = tokens[i + 1] ?? '';
      i += 1;
    } else if (token.startsWith('--args=')) {
      jsonArg = token.slice('--args='.length);
    } else {
      rest.push(token);
    }
  }
  return { rest, jsonArg };
}

async function startServers(
  config: McpConfig,
  serverNames: string[],
  options: Options,
): Promise<Map<string, MCPServerProcess>> {
  const processes = new Map<string, MCPServerProcess>();
  for (const name of serverNames) {
    const serverConfig = config.mcpServers?.[name];
    if (!serverConfig) {
      throw new Error(`Server "${name}" not found in config`);
    }
    const proc = new MCPServerProcess(name, serverConfig, options);
    await proc.start();
    processes.set(name, proc);
  }
  return processes;
}

function stopServers(processes: Map<string, MCPServerProcess>): void {
  for (const proc of processes.values()) {
    proc.stop();
  }
}

async function withServer<T>(
  config: McpConfig,
  serverName: string,
  options: Options,
  fn: (proc: MCPServerProcess) => Promise<T>,
): Promise<T> {
  const processes = await startServers(config, [serverName], options);
  try {
    const proc = processes.get(serverName);
    if (!proc) {
      throw new Error(`Server "${serverName}" not started`);
    }
    return await fn(proc);
  } finally {
    stopServers(processes);
  }
}

function parsePlan(raw: unknown): PlanStep[] {
  const steps = Array.isArray(raw) ? raw : isRecord(raw) ? raw.steps : undefined;
  if (!Array.isArray(steps)) {
    throw new Error('Plan file must be an array or { "steps": [...] }');
  }
  return steps.map((step: unknown, index) => {
    if (!isRecord(step) || typeof step.server !== 'string' || typeof step.tool !== 'string') {
      throw new Error(`Plan step ${index} must have string "server" and "tool" fields`);
    }
    const args = isRecord(step.args) ? step.args : undefined;
    return { server: step.server, tool: step.tool, ...(args ? { args } : {}) };
  });
}

async function runPlan(planPath: string, config: McpConfig, options: Options) {
  const steps = parsePlan(readJson(planPath));
  const serversNeeded = Array.from(new Set(steps.map((step) => step.server)));
  const processes = await startServers(config, serversNeeded, options);
  const results: { index: number; server: string; tool: string; result: unknown }[] = [];

  try {
    for (const [index, step] of steps.entries()) {
      const proc = processes.get(step.server);
      if (!proc) {
        throw new Error(`Server "${step.server}" not started`);
      }
      const result = await proc.callTool(step.tool, step.args);
      results.push({ index, server: step.server, tool: step.tool, result });
    }
  } finally {
    stopServers(processes);
  }

  return { results };
}

async function main(): Promise<void> {
  const { opts, rest } = parseArgs(process.argv.slice(2));
  if (opts.help || rest.length === 0) {
    console.log(usage());
    process.exit(opts.help ? 0 : 1);
  }

  const config = readJson(resolveConfigPath(opts.config)) as McpConfig;

  const [command, ...args] = rest;
  if (command === 'list-servers') {
    const serverNames = selectServers(config, opts.servers);
    console.log(JSON.stringify({ servers: serverNames }, null, 2));
    return;
  }

  if (command === 'list-tools') {
    const serverName = args[0];
    if (!serverName) {
      throw new Error('list-tools requires a server name');
    }
    const tools = await withServer(config, serverName, opts, (proc) => proc.listTools());
    console.log(JSON.stringify({ server: serverName, tools }, null, 2));
    return;
  }

  if (command === 'call-tool') {
    const { rest: callRest, jsonArg } = extractArgsFlag(args);
    const [serverName, toolName, ...inlineArgs] = callRest;
    const rawArgs = jsonArg || inlineArgs.join(' ');
    const toolArgs: unknown = rawArgs ? JSON.parse(rawArgs) : {};
    if (!serverName || !toolName) {
      throw new Error('call-tool requires <server> <tool> [--args JSON]');
    }
    if (!isRecord(toolArgs)) {
      throw new Error('call-tool --args must be a JSON object');
    }
    const result = await withServer(config, serverName, opts, (proc) => proc.callTool(toolName, toolArgs));
    console.log(JSON.stringify({ server: serverName, tool: toolName, result }, null, 2));
    return;
  }

  if (command === 'run-plan') {
    const planPath = args[0];
    if (!planPath) {
      throw new Error('run-plan requires a JSON plan path');
    }
    const output = await runPlan(path.resolve(process.cwd(), planPath), config, opts);
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
