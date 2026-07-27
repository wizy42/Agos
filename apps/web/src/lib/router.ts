import { useEffect, useState } from 'react';

export type Route =
  | { name: 'portfolio' }
  | { name: 'inbox' }
  | { name: 'project'; id: string }
  | { name: 'run'; id: string };

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [head, id] = path.split('/');
  if (head === 'inbox') return { name: 'inbox' };
  if (head === 'project' && id) return { name: 'project', id };
  if (head === 'run' && id) return { name: 'run', id };
  return { name: 'portfolio' };
}

/** Hash routing — four screens do not need a router dependency. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export const href = {
  portfolio: () => '#/',
  inbox: () => '#/inbox',
  project: (id: string) => `#/project/${id.replace(/-/g, '')}`,
  run: (id: string) => `#/run/${id}`,
};

export function navigate(to: string): void {
  window.location.hash = to.replace(/^#/, '');
}
