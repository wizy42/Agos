import type { DreamReport, Project } from '@cockpit/core';
import type { SessionSummary } from '../ingest/sessions.ts';
import type { ProjectPageContext } from '../notion/projectPage.ts';

/**
 * One project's section of the President's brief. Everything the server knows,
 * rendered once so the prompt can stay a template: registry row, Notion page
 * extract, the last dream, recent commits, recent Claude Code sessions.
 *
 * Absence is said out loud. A President that cannot tell "no sessions" from
 * "sessions not read" will invent activity, and the point of the brief is that
 * it never has to.
 */

export interface ProjectBriefInput {
  project: Project;
  page: ProjectPageContext;
  lastDream: { createdAt: string; report: DreamReport } | null;
  gitLog: string;
  sessions: SessionSummary[];
}

const PAGE_MAX = 6000;
const day = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : 'never');

export function renderProjectBrief(input: ProjectBriefInput): string {
  const { project, page, lastDream, gitLog, sessions } = input;
  const a = project.activity;
  const lines: string[] = [];

  lines.push(`## ${project.name} — ${project.tier ?? 'untiered'}`, '');
  lines.push(`- Registry status: ${project.status ?? 'none'} · last dream: ${day(project.lastDream)}`);
  lines.push(`- Next step: ${project.nextStep ?? '(none set)'}`);
  if (!project.repoPath) {
    lines.push('- Repo: no repo linked — nothing below is judged from code.');
  } else if (!a?.repoFound) {
    lines.push(`- Repo: ${project.repoPath} (not found on this machine)`);
  } else {
    lines.push(
      `- Repo: ${project.repoPath} · branch ${a.branch ?? '?'} · last commit ${day(a.lastCommitAt)}` +
        (a.lastCommitSubject ? ` "${a.lastCommitSubject}"` : '') +
        (a.dirty ? ' · uncommitted changes in the tree' : ''),
    );
    lines.push(`- Last Claude Code session on disk: ${day(a.lastSessionAt)}`);
  }
  lines.push('');

  lines.push('### Notion page');
  lines.push(
    page.text
      ? (page.sections.length ? `(sections: ${page.sections.join(', ')})\n` : '') +
          page.text.slice(0, PAGE_MAX)
      : '(The project page could not be read, or there is none. Strategy is unknown, not absent.)',
  );
  lines.push('');

  lines.push('### Last dream');
  if (lastDream) {
    const r = lastDream.report;
    lines.push(`${day(lastDream.createdAt)} — ${r.health}: ${r.where_we_are}`);
    if (r.risks.length) lines.push('Risks: ' + r.risks.join(' · '));
    if (r.proposed_next_actions.length) {
      lines.push('Proposed: ' + r.proposed_next_actions.map((x) => x.title).join(' · '));
    }
  } else {
    lines.push('(This project has never been dreamed.)');
  }
  lines.push('');

  lines.push('### Recent commits');
  lines.push(gitLog.trim() || '(no commits in the window, or no repo)');
  lines.push('');

  lines.push('### Recent Claude Code sessions');
  if (sessions.length === 0) {
    lines.push('(No recent sessions on this disk. Sessions run on claude.ai/code are not visible here.)');
  } else {
    for (const s of sessions) {
      lines.push(`- ${day(s.lastAt ?? s.startedAt)} · ${s.opening} (${s.userTurns} turns)`);
    }
  }

  return lines.join('\n');
}
