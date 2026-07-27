import { useEffect, useRef } from 'react';
import type { RunEvent } from '@cockpit/core';

export type ServerMessage =
  | { kind: 'run:started'; runId: string; projectId: string | null; agentName: string }
  | { kind: 'run:event'; runId: string; event: RunEvent }
  | { kind: 'run:finished'; runId: string };

/**
 * Subscribes to the server's run stream. The handler is held in a ref so a
 * re-render never tears down and re-opens the socket mid-run.
 */
export function useRunStream(onMessage: (msg: ServerMessage) => void): void {
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      if (closed) return;
      socket = new WebSocket(url);
      socket.onmessage = (ev) => {
        try {
          handler.current(JSON.parse(ev.data as string) as ServerMessage);
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 1000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, []);
}
