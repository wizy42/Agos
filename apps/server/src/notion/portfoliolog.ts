import type { Client } from '@notionhq/client';
import type { PresidentReport } from '@cockpit/core';
import { presidentToMarkdown } from '../president/contract.ts';
import { appendMarkdown, createLogPage, findChildPage } from './dreamlog.ts';

/**
 * The Portfolio Log: one page under the hub, created on the President's first
 * pass, with a dated section appended per pass. Nothing else in the hub is
 * touched — the tier pages and project pages keep their structure.
 */

const PORTFOLIO_LOG_TITLE = 'Portfolio Log';

export async function resolvePortfolioLog(notion: Client, hubPageId: string): Promise<string> {
  return (
    (await findChildPage(notion, hubPageId, PORTFOLIO_LOG_TITLE)) ??
    (await createLogPage(notion, hubPageId, {
      title: PORTFOLIO_LOG_TITLE,
      emoji: '🏛️',
      intro:
        'Weekly portfolio reviews written by the Cockpit President: where Convergence Labs ' +
        'stands on product, legal, marketing, traction, tooling and assets, and the ' +
        'cross-project priorities for the week. Each pass appends a dated section below.',
    }))
  );
}

export async function appendPresidentReport(
  notion: Client,
  logPageId: string,
  report: PresidentReport,
  when: Date,
): Promise<void> {
  await appendMarkdown(notion, logPageId, presidentToMarkdown(report, when));
}
