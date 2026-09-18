#!/usr/bin/env node
/**
 * Line up every `[HETERO-TRACE]` line of one heterogeneous-agent run, across
 * the device CLI, the server and the browser, into a single wall-clock
 * timeline.
 *
 *   node scripts/hetero-trace.mjs                       # newest op in ~/.lobehub/daemon.log
 *   node scripts/hetero-trace.mjs op_1789655958912…     # one op, default log
 *   node scripts/hetero-trace.mjs op_… server.log web-console.txt
 *   cat web-console.txt | node scripts/hetero-trace.mjs op_… - server.log
 *
 * Why a script: the three legs run on different processes (sometimes different
 * machines), and the interesting questions — how long after the last answer
 * event did the terminal event get *enqueued*, acked, published, rendered —
 * are only answerable by sorting the merged lines by their own absolute
 * timestamps.
 *
 * `at=` is each side's own clock (assumes NTP); `elapsed=` is that side's own
 * offset, so per-leg durations stay correct even if clocks disagree.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const DEFAULT_LOG = path.join(homedir(), '.lobehub', 'daemon.log');

const args = process.argv.slice(2);
// Positional args are ambiguous on purpose (`op_…` or a UUID vs. a log path),
// so each one is classified: an existing file (or `-`) is a source, anything
// else is the operation id.
const positional = args.filter((a) => !a.startsWith('-'));
let opArg;
const files = [];
for (const candidate of positional) {
  if (candidate === '-' || existsSync(candidate)) {
    files.push(candidate);
    continue;
  }
  if (opArg === undefined) opArg = candidate;
  else files.push(candidate);
}

const readAll = (sources) => {
  const text = [];
  for (const source of sources) {
    if (source === '-') {
      try {
        text.push(readFileSync(0, 'utf8'));
      } catch {
        /* no stdin */
      }
      continue;
    }
    try {
      if (!statSync(source).isFile()) continue;
      text.push(readFileSync(source, 'utf8'));
    } catch {
      // Fall back to the default log when a path does not exist yet.
      text.push('');
    }
  }
  return text.join('\n');
};

const inputs = files.length > 0 ? files : [DEFAULT_LOG];
let raw = readAll(inputs);
if (!raw.trim() && files.length === 0) {
  console.error(`No ${DEFAULT_LOG} (or it has no trace lines). Pass a log path explicitly.`);
}

// The marker is followed by a single space in every emitted line; keeping the
// separator literal avoids a super-linear backtracking pattern (lint).
const LINE = /\[HETERO-TRACE\] (.*)$/;

/**
 * `detail=` / `run=` carry nested JSON, so they are sliced out by marker
 * position instead of by a key=value regex — the latter would stop at the
 * first closing brace of a nested object.
 */
const extractJson = (body, key) => {
  const marker = new RegExp(`${key}=`);
  const match = marker.exec(body);
  if (!match) return undefined;
  const rest = body.slice(match.index + match[0].length);
  const nextMarker = /\s(?:detail|run)=/.exec(rest);
  const slice = nextMarker ? rest.slice(0, nextMarker.index) : rest;
  if (!slice.startsWith('{')) return undefined;
  try {
    return JSON.parse(slice);
  } catch {
    return undefined;
  }
};

const parseLine = (line) => {
  const match = LINE.exec(line);
  if (!match) return undefined;
  const body = match[1];
  const field = (key) => {
    const found = new RegExp(`(?:^|\\s)${key}=(\\S+)`).exec(body);
    return found?.[1];
  };
  return {
    at: field('at') ? Date.parse(field('at')) : undefined,
    detail: extractJson(body, 'detail') ?? extractJson(body, 'run'),
    elapsed: field('elapsed') ? Number.parseInt(field('elapsed'), 10) : undefined,
    op: field('op'),
    phase: field('phase'),
    side: field('side'),
  };
};

let entries = raw
  .split('\n')
  .map(parseLine)
  .filter((entry) => entry?.at && entry.phase);

let op = opArg;
if (!op) {
  const newest = entries.reduce(
    (acc, entry) => (acc === undefined || entry.at > acc.at ? entry : acc),
    undefined,
  );
  op = newest?.op;
}
if (!op) {
  console.error('No trace lines found.');
  process.exit(1);
}

// The server's HTTP-boundary lines are labelled by procedure path, not by
// operation id (their body is not parsed there), so they are kept in a
// separate, unfiltered list for the transport summary.
const allEntries = entries;
entries = entries.filter((entry) => entry.op === op).sort((a, b) => a.at - b.at);
if (entries.length === 0) {
  console.error(`No trace lines for op=${op} in: ${inputs.join(', ')}`);
  process.exit(1);
}

const t0 = entries[0].at;
const fmt = (ms) =>
  `${new Date(ms).toISOString().slice(11, 23)} (+${String(ms - t0).padStart(6)}ms)`;

console.log(
  `\nop=${op}  lines=${entries.length}  span=${((entries.at(-1).at - t0) / 1000).toFixed(1)}s`,
);
console.log(`sources: ${inputs.join(', ')}\n`);

let prev;
for (const entry of entries) {
  const gap = prev ? entry.at - prev.at : 0;
  const gapTag = gap >= 1000 ? `  ⚠ +${(gap / 1000).toFixed(1)}s` : gap >= 300 ? `  +${gap}ms` : '';
  const detail = entry.detail ? ` ${JSON.stringify(entry.detail)}` : '';
  console.log(
    `${fmt(entry.at)}  ${(entry.side ?? '?').padEnd(11)} ${entry.phase}${detail}${gapTag}`,
  );
  prev = entry;
}

// ─── Headline numbers ──────────────────────────────────────────────────────
const pick = (phase) => entries.find((entry) => entry.phase === phase);
const terminalEvent = pick('agent:terminalEvent');
const terminalQueued = pick('ingest:terminal:queued');
const terminalAcked = entries.find(
  (entry) => entry.phase === 'ingest:batch:sent' && entry.detail?.terminalType,
);
const serverTerminal = entries.find(
  (entry) => entry.phase === 'ingest:received' && entry.detail?.terminalType,
);
const serverPublished = pick('stream:terminal:published');
const webDone = pick('web:run:completed');

const lastAnswerEvent = entries.findLast(
  (entry) => entry.phase === 'ingest:received' && entry.detail?.lastType,
);

console.log('\n── headline ─────────────────────────────────────────────────────────');
const show = (label, from, to) => {
  if (!from || !to) return;
  console.log(`${label}: ${((to.at - from.at) / 1000).toFixed(1)}s`);
};
show('pi terminal event → CLI enqueued it', terminalEvent, terminalQueued);
show('pi terminal event → server acked the batch', terminalEvent, terminalAcked);
show('pi terminal event → server received it', terminalEvent, serverTerminal);
show('pi terminal event → server published it', terminalEvent, serverPublished);
show('pi terminal event → UI stopped (web)', terminalEvent, webDone);
show('CLI run:start → UI stopped (web)', entries[0], webDone);
if (terminalAcked?.detail?.terminalAgeMs !== undefined) {
  console.log(
    `terminal event was ${(terminalAcked.detail.terminalAgeMs / 1000).toFixed(1)}s old when the server acked its batch`,
  );
}
if (terminalQueued?.detail?.depth !== undefined) {
  console.log(`terminal event was queued behind ${terminalQueued.detail.depth} unsent event(s)`);
}
if (lastAnswerEvent?.detail?.lastType) {
  console.log(`server's last ingested event type: ${lastAnswerEvent.detail.lastType}`);
}

// ─── Settlement gap (pi's own silence) ─────────────────────────────────────
const settled = pick('pi.agent_settled');
if (settled?.detail) {
  const { eventsAfterAgentEnd, sinceLastOutputMs, sinceTurnEndMs } = settled.detail;
  console.log(
    `pi settled ${sinceLastOutputMs}ms after its last output (turn_end→settle ${sinceTurnEndMs}ms, ${eventsAfterAgentEnd} event(s) in between${eventsAfterAgentEnd ? ' — pi was still working' : ' — pure silence'})`,
  );
}
if (terminalEvent?.detail?.sinceLastOutputMs !== undefined) {
  console.log(
    `CLI: last output → terminal event = ${terminalEvent.detail.sinceLastOutputMs}ms` +
      (terminalEvent.detail.type ? ` (${terminalEvent.detail.type})` : ''),
  );
}

// ─── Slow ingest batches (server sub-phases) ───────────────────────────────
const ingestDone = entries.filter(
  (entry) => entry.phase === 'ingest:done' && entry.detail?.totalMs,
);
if (ingestDone.length > 0) {
  const slowest = ingestDone.reduce((acc, entry) =>
    entry.detail.totalMs > acc.detail.totalMs ? entry : acc,
  );
  const d = slowest.detail;
  console.log(
    `slowest ingest batch: ${d.totalMs}ms for ${d.count} event(s) — touch=${d.touchMs}ms persist=${d.persistMs}ms publish=${d.publishMs}ms/${d.publishCount}x trace=${d.traceMs}ms (deduped ${d.deduped})`,
  );
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  console.log(
    `ingest batches: n=${ingestDone.length} median=${median(ingestDone.map((e) => e.detail.totalMs))}ms max=${slowest.detail.totalMs}ms`,
  );
}
const routerLines = entries.filter(
  (entry) => entry.phase === 'ingest:router' && entry.detail?.totalMs,
);
if (routerLines.length > 0) {
  const slowestRouter = routerLines.reduce((acc, entry) =>
    entry.detail.totalMs > acc.detail.totalMs ? entry : acc,
  );
  const d = slowestRouter.detail;
  console.log(
    `slowest router pass: ${d.totalMs}ms — authorize=${d.authorizeMs}ms resolveWorkspace=${d.resolveWorkspaceMs}ms service=${d.serviceMs}ms`,
  );
}

// ─── Transport (client HTTP) ──────────────────────────────────────────────
const httpLines = entries.filter(
  (entry) => entry.side === 'cli-http' && entry.phase?.startsWith('http:'),
);
if (httpLines.length > 0) {
  const worst = httpLines.reduce((acc, entry) =>
    (entry.detail?.ms ?? 0) > (acc.detail?.ms ?? 0) ? entry : acc,
  );
  console.log(
    `client HTTP: ${httpLines.length} slow/failed request(s); worst ${worst.detail?.ms}ms (ttfb=${worst.detail?.ttfbMs}ms body=${worst.detail?.bodyMs ?? '-'}ms status=${worst.detail?.status ?? '-'})`,
  );
  const nonJson = httpLines.filter((entry) => entry.phase === 'http:non-json');
  for (const entry of nonJson.slice(0, 3)) {
    console.log(
      `  ✗ non-JSON response: status=${entry.detail?.status} type=${entry.detail?.contentType} body="${String(entry.detail?.body ?? '').slice(0, 90)}"` +
        ` at ${new Date(entry.at).toISOString()}`,
    );
  }
}
const serverHttp = allEntries.filter(
  (entry) => entry.side === 'server-http' && entry.phase === 'http:done' && entry.detail?.ms,
);
if (serverHttp.length > 0) {
  const worst = serverHttp.reduce((acc, entry) => (entry.detail.ms > acc.detail.ms ? entry : acc));
  console.log(
    `server HTTP (all middlewares): worst ${worst.detail.ms}ms ${worst.detail.method} ${worst.op} status=${worst.detail.status}`,
  );
}
console.log('');
