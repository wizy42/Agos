import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Project } from '@cockpit/core';
import { renderProjectBrief, type ProjectBriefInput } from './brief.ts';

const project: Project = {
  id: 'id-1',
  name: 'LaunchPad',
  projectPageUrl: 'https://notion.so/page',
  registryRowUrl: 'https://notion.so/row',
  tier: 'SHIP NOW',
  status: 'orange',
  repoPath: '~/code/launchpad',
  dream: true,
  lastDream: '2026-10-08T02:00:00Z',
  nextStep: 'Ship pricing',
  activity: {
    repoFound: true,
    branch: 'main',
    lastCommitAt: '2026-10-07T10:00:00Z',
    lastCommitSubject: 'Add checkout',
    dirty: true,
    lastSessionAt: '2026-10-08T20:00:00Z',
  },
};

const input: ProjectBriefInput = {
  project,
  page: { text: '## AGENT_CONTEXT\nMRR: 0\nPrimary blocker: no pricing', sections: ['AGENT_CONTEXT'] },
  lastDream: {
    createdAt: '2026-10-08T02:00:00Z',
    report: {
      project: 'LaunchPad',
      where_we_are: 'Nearly shippable.',
      what_moved: [],
      risks: ['No price'],
      proposed_next_actions: [{ title: 'Price it', why: 'w', agent: 'builder', prompt: 'p' }],
      questions_for_ceo: [],
      health: 'orange',
    },
  },
  gitLog: 'abc1234 2026-10-07 Add checkout',
  sessions: [
    { file: 'x', startedAt: '2026-10-08T19:00:00Z', lastAt: '2026-10-08T20:00:00Z', opening: 'Wire Stripe webhook', userTurns: 4 },
  ],
};

test('a project brief carries registry, page, dream, git and session evidence', () => {
  const md = renderProjectBrief(input);
  assert.match(md, /^## LaunchPad — SHIP NOW/m);
  assert.match(md, /orange/);
  assert.match(md, /Next step: Ship pricing/);
  assert.match(md, /uncommitted changes/);
  assert.match(md, /Primary blocker: no pricing/);
  assert.match(md, /Nearly shippable\./);
  assert.match(md, /Price it/);
  assert.match(md, /abc1234 2026-10-07 Add checkout/);
  assert.match(md, /2026-10-08.*Wire Stripe webhook.*4 turns/);
});

test('missing evidence is named, not silently omitted', () => {
  const md = renderProjectBrief({
    project: { ...project, repoPath: null, activity: null, lastDream: null, nextStep: null },
    page: { text: null, sections: [] },
    lastDream: null,
    gitLog: '',
    sessions: [],
  });
  assert.match(md, /no repo linked/i);
  assert.match(md, /page could not be read/i);
  assert.match(md, /never been dreamed/i);
  assert.match(md, /no recent sessions/i);
});
