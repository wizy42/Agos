import type { RunEvent } from '@cockpit/core';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';

/** Messages pushed to the browser over `/ws`. */
export type ServerMessage =
  | { kind: 'run:started'; runId: string; projectId: string | null; agentName: string }
  | { kind: 'run:event'; runId: string; event: RunEvent }
  | { kind: 'run:finished'; runId: string };

/**
 * One broadcast channel for every connected browser tab. Clients filter by
 * runId; the volume here is a single local user watching one run at a time.
 */
export class Bus {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (socket) => {
      this.clients.add(socket);
      socket.on('close', () => this.clients.delete(socket));
      socket.on('error', () => this.clients.delete(socket));
    });
  }

  broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const socket of this.clients) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }
}
