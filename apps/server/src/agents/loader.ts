import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import type { AgentDef, PermissionProfile } from '@cockpit/core';

/** Loads and validates `agents/*.yaml`, and interpolates prompt templates. */

const PROFILES: PermissionProfile[] = ['observer', 'builder', 'notion-writer'];

function requireString(def: Record<string, unknown>, key: string, file: string): string {
  const value = def[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${file}: "${key}" is required and must be a non-empty string.`);
  }
  return value;
}

function stringArray(def: Record<string, unknown>, key: string, file: string): string[] {
  const value = def[key] ?? [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`${file}: "${key}" must be a list of strings.`);
  }
  return value as string[];
}

export function parseAgentDef(raw: string, file: string): AgentDef {
  const def = parse(raw) as Record<string, unknown> | null;
  if (!def || typeof def !== 'object') throw new Error(`${file}: not a YAML mapping.`);

  const permissionProfile = requireString(def, 'permissionProfile', file) as PermissionProfile;
  if (!PROFILES.includes(permissionProfile)) {
    throw new Error(`${file}: unknown permissionProfile "${permissionProfile}".`);
  }

  const maxTurns = def.maxTurns ?? 25;
  if (typeof maxTurns !== 'number' || !Number.isFinite(maxTurns) || maxTurns < 1) {
    throw new Error(`${file}: "maxTurns" must be a positive number.`);
  }

  return {
    name: requireString(def, 'name', file),
    model: requireString(def, 'model', file),
    cwd: requireString(def, 'cwd', file),
    permissionProfile,
    allowedTools: stringArray(def, 'allowedTools', file),
    mcp: stringArray(def, 'mcp', file),
    maxTurns,
    prompt: requireString(def, 'prompt', file),
  };
}

export async function loadAgents(repoRoot: string): Promise<Map<string, AgentDef>> {
  const dir = resolve(repoRoot, 'agents');
  const agents = new Map<string, AgentDef>();

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return agents;
  }

  for (const file of files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))) {
    const raw = await readFile(join(dir, file), 'utf8');
    const def = parseAgentDef(raw, file);
    agents.set(def.name, def);
  }

  return agents;
}

/** Replaces `{{key}}` and `${key}` placeholders. Unknown keys are left intact. */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => vars[key] ?? match)
    .replace(/\$\{\s*([\w.]+)\s*\}/g, (match, key: string) => vars[key] ?? match);
}

export async function loadPrompt(
  repoRoot: string,
  def: AgentDef,
  vars: Record<string, string>,
): Promise<string> {
  const raw = await readFile(resolve(repoRoot, def.prompt), 'utf8');
  return interpolate(raw, vars);
}
