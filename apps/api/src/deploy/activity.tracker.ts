import { Injectable } from '@nestjs/common';

/**
 * §26 — in-memory record of recent real user activity, used only by the deploy-guard
 * readiness probe to decide whether it's safe to enter maintenance mode. A ring buffer of
 * the last few hundred requests is plenty: we only ever ask "was anyone active in the last
 * N seconds?". Resets on restart, which is fine — readiness is always checked BEFORE a deploy.
 */
export interface ActivitySnapshot {
  windowSec: number;
  idle: boolean;
  activeClients: number; // distinct sessions/IPs seen in the window
  activeWriters: number; // distinct clients that made a mutating (non-GET) request
  recentRequests: number;
  lastActivitySecAgo: number | null;
  topPaths: { path: string; count: number }[];
}

@Injectable()
export class ActivityTracker {
  private events: { t: number; client: string; write: boolean; path: string }[] = [];
  private readonly MAX = 600;

  record(client: string, method: string, path: string): void {
    const write = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    this.events.push({ t: Date.now(), client, write, path });
    if (this.events.length > this.MAX) this.events.splice(0, this.events.length - this.MAX);
  }

  snapshot(windowSec: number): ActivitySnapshot {
    const now = Date.now();
    const cutoff = now - windowSec * 1000;
    const recent = this.events.filter((e) => e.t >= cutoff);
    const clients = new Set(recent.map((e) => e.client));
    const writers = new Set(recent.filter((e) => e.write).map((e) => e.client));
    const counts = new Map<string, number>();
    for (const e of recent) counts.set(e.path, (counts.get(e.path) ?? 0) + 1);
    const topPaths = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([path, count]) => ({ path, count }));
    return {
      windowSec,
      idle: clients.size === 0,
      activeClients: clients.size,
      activeWriters: writers.size,
      recentRequests: recent.length,
      lastActivitySecAgo: recent.length ? Math.round((now - Math.max(...recent.map((e) => e.t))) / 1000) : null,
      topPaths,
    };
  }
}
