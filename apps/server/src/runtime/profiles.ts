import { relative, resolve } from 'node:path';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionProfile } from '@cockpit/core';

/**
 * Permission profiles, enforced in code rather than by prompt (§7).
 *
 * Two layers, deliberately redundant:
 *  1. `allowedTools` / `disallowedTools` — the SDK's own gate.
 *  2. `canUseTool` — a callback the SDK must clear before *every* tool call.
 *
 * Layer 2 is the one that matters. A model cannot talk its way past a function
 * that returns `{ behavior: 'deny' }`, and it catches cases layer 1's glob
 * patterns miss (a `Bash` command that shells out to `rm`, a `Read` of `/etc`).
 */

export interface ProfileSpec {
  allowedTools: string[];
  disallowedTools: string[];
  permissionMode: PermissionMode;
  /** Human-readable summary, shown in the UI before a run is launched. */
  summary: string;
}

/** Tools that cannot mutate anything on disk. */
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite'];

/** Bash invocations an observer may make. Anchored: a prefix match, not a substring. */
const OBSERVER_BASH = [/^git\s+log\b/, /^git\s+status\b/, /^git\s+diff\b/, /^git\s+show\b/];

const SPECS: Record<Exclude<PermissionProfile, 'notion-writer'>, ProfileSpec> = {
  observer: {
    allowedTools: [...READ_ONLY_TOOLS, 'Bash(git log*)', 'Bash(git status*)'],
    disallowedTools: ['Edit', 'Write', 'NotebookEdit', 'Task', 'KillShell'],
    permissionMode: 'default',
    summary: 'Read-only. No file edits, no mutating shell commands.',
  },
  builder: {
    allowedTools: [...READ_ONLY_TOOLS, 'Edit', 'Write', 'NotebookEdit', 'Bash'],
    disallowedTools: [],
    permissionMode: 'acceptEdits',
    summary: 'Can edit files and run commands, confined to the project repo.',
  },
};

export function specFor(profile: PermissionProfile): ProfileSpec {
  if (profile === 'notion-writer') {
    // Arrives with the dream pipeline in M2, together with the Notion MCP server.
    throw new Error('The notion-writer profile is not wired up yet.');
  }
  const spec = SPECS[profile];
  if (!spec) throw new Error(`Unknown permission profile: ${profile}`);
  return spec;
}

/** Path-ish tool inputs, checked for containment before a builder may touch them. */
const PATH_KEYS = ['file_path', 'path', 'notebook_path', 'edits'];

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, resolve(root, candidate));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

export interface Decision {
  behavior: 'allow' | 'deny';
  message?: string;
}

/**
 * The code-level gate. Pure and synchronous so it can be unit-tested directly
 * without spinning up an agent.
 */
export function decide(
  profile: PermissionProfile,
  repoRoot: string,
  toolName: string,
  input: Record<string, unknown>,
): Decision {
  const spec = specFor(profile);

  if (spec.disallowedTools.includes(toolName)) {
    return { behavior: 'deny', message: `${toolName} is not available to a ${profile} run.` };
  }

  if (profile === 'observer') {
    if (toolName === 'Bash') {
      const command = String(input.command ?? '').trim();
      if (!OBSERVER_BASH.some((re) => re.test(command))) {
        return {
          behavior: 'deny',
          message: `An observer run may only shell out to read-only git commands. Refused: ${command.slice(0, 120)}`,
        };
      }
      // Reject chained or substituted commands that smuggle past the prefix check.
      if (/[;&|]|\$\(|`|\n|>/.test(command)) {
        return {
          behavior: 'deny',
          message: 'An observer run may not chain, redirect, or substitute shell commands.',
        };
      }
      return { behavior: 'allow' };
    }

    if (!READ_ONLY_TOOLS.includes(toolName)) {
      return { behavior: 'deny', message: `${toolName} is not a read-only tool.` };
    }
    return { behavior: 'allow' };
  }

  // builder — confined to its repo.
  for (const key of PATH_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && !isInside(repoRoot, value)) {
      return {
        behavior: 'deny',
        message: `A builder run is scoped to ${repoRoot}. Refused path: ${value}`,
      };
    }
  }

  return { behavior: 'allow' };
}
