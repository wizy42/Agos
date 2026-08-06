/**
 * Startup failure reporting.
 *
 * Two problems this exists to solve, both visible in a plain `npm run dev`:
 *
 *  1. Notion's errors are terse ("API token is invalid.") and say nothing about
 *     which of the three fixable causes you hit, so `describeNotionFailure`
 *     turns them into the sentence plus the fix.
 *  2. `tsx watch` does not exit when the script it runs exits — it sits waiting
 *     for a file change. So a dead server looks identical to a slow one, and
 *     the only thing on screen is Vite retrying its proxy. Every fatal path
 *     prints `FATAL_PREFIX`, which `scripts/dev.mjs` watches for so it can tear
 *     the whole dev environment down immediately instead of waiting out the
 *     health-check timeout.
 */

/** Sentinel line. `scripts/dev.mjs` greps for this; keep the two in sync. */
export const FATAL_PREFIX = '[cockpit] fatal:';

export interface BootFailure {
  message: string;
  /** What to do about it. Printed under the message, one fix per line. */
  hint: string;
}

/** Aligns hint lines under the message, past the `[cockpit] ` tag. */
const INDENT = ' '.repeat('[cockpit] '.length);

/** Prints a boot failure in the shape `dev.mjs` recognises, then exits(1). */
export function fatal(failure: BootFailure): never {
  const hint = failure.hint
    .split('\n')
    .map((line) => INDENT + line)
    .join('\n');
  console.error(`\n${FATAL_PREFIX} ${failure.message}\n${hint}\n`);
  process.exit(1);
}

/** Where a value in `process.env` came from, for error messages. */
export type EnvSource = 'shell' | '.env' | 'unset';

/**
 * dotenv never overrides an already-exported variable, so a stale
 * `export NOTION_TOKEN=…` in a shell profile silently wins over the `.env` the
 * user is editing. Capture the shell value *before* loading `.env` to tell the
 * two apart.
 */
export function tokenSource(shellValue: string | undefined, loadedValue: string | undefined): EnvSource {
  if (!loadedValue) return 'unset';
  return shellValue ? 'shell' : '.env';
}

const SOURCE_LABEL: Record<EnvSource, string> = {
  shell: 'your shell environment (an exported NOTION_TOKEN, which wins over .env)',
  '.env': '.env in this repo',
  unset: 'nowhere',
};

/** `ntn_abcd…` — enough to compare against Notion without printing the secret. */
export function maskToken(token: string): string {
  return token.length <= 8 ? '…' : `${token.slice(0, 8)}…`;
}

function errorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface NotionContext {
  /** The token in use, so the message can name its prefix and origin. */
  token: string;
  source: EnvSource;
  registryDatabaseId: string;
}

/**
 * Maps a `@notionhq/client` error thrown during boot onto the thing the user
 * has to change. The three interesting codes each have a different fix, and
 * guessing wrong costs a trip through the Notion UI.
 */
export function describeNotionFailure(err: unknown, ctx: NotionContext): BootFailure {
  const code = errorCode(err);

  if (code === 'unauthorized') {
    return {
      message: `Notion rejected NOTION_TOKEN (${maskToken(ctx.token)}) as invalid.`,
      hint:
        `That token was read from ${SOURCE_LABEL[ctx.source]}.\n` +
        'Create an internal integration at https://www.notion.so/profile/integrations\n' +
        '(Read + Update + Insert), copy the token — it starts with "ntn_" — and paste it\n' +
        'into .env. Tokens are revoked when the integration is deleted or rotated.\n' +
        'Then: npm run preflight',
    };
  }

  if (code === 'object_not_found' || code === 'restricted_resource') {
    return {
      message: `The Cockpit Registry (${ctx.registryDatabaseId}) is not visible to this integration.`,
      hint:
        'The token is valid, so this is almost always page sharing: open the\n' +
        '"Convergence Labs Projects" hub page in Notion → ··· → Connections →\n' +
        'add your Cockpit integration. The registry database inherits that access.\n' +
        'Then: npm run preflight',
    };
  }

  if (code === 'rate_limited') {
    return {
      message: 'Notion rate-limited the registry read at boot.',
      hint: 'Wait a minute and start again. Nothing is misconfigured.',
    };
  }

  if (code === 'notionhq_client_request_error') {
    return {
      message: `Could not reach the Notion API: ${errorMessage(err)}`,
      hint: 'Check your network or VPN, then start again.',
    };
  }

  // The response was not something the Notion client could parse — usually a
  // proxy, a captive portal, or a corporate TLS interceptor answering instead.
  if (code === 'notionhq_client_response_error') {
    return {
      message: `Notion returned an unexpected response: ${errorMessage(err)}`,
      hint:
        'Something between you and api.notion.com answered instead of Notion —\n' +
        'a proxy, a VPN, or a captive portal. Check that curl https://api.notion.com/v1/users/me\n' +
        'returns JSON, then start again.',
    };
  }

  return {
    message: `Could not read the Cockpit Registry: ${errorMessage(err)}`,
    hint: 'Run `npm run preflight` — it checks the token, the sharing, and the repo paths.',
  };
}

/** Boot failures that are not Notion's fault: sqlite, a taken port, bad config. */
export function describeStartupFailure(err: unknown, apiPort: number): BootFailure {
  if (errorCode(err) === 'EADDRINUSE') {
    return {
      message: `Port ${apiPort} is already in use, so the API could not listen.`,
      hint:
        'Another `npm run dev` is probably still running. Stop it, or start this one\n' +
        `on a different port: PORT=4300 npm run dev\n` +
        `To find the process: lsof -nP -iTCP:${apiPort} -sTCP:LISTEN`,
    };
  }

  return {
    message: `The API server failed to start: ${errorMessage(err)}`,
    hint: 'The stack above is the whole story. Run `npm run preflight` if it mentions config.',
  };
}
