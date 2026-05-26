#!/usr/bin/env node
// scripts/update-legacy.mjs
//
// Appends new trades from the bot's options_trades.csv into the Legacy Files
// section of index.html. Idempotent — only adds rows for trades that aren't
// already represented (compares by total trade count).
//
// Recomputes the .phase__stats block from ALL trades.
// Updates the .phase__sub paragraph (count + date range).
//
// Usage:
//   node scripts/update-legacy.mjs
//   node scripts/update-legacy.mjs --csv /path/to/options_trades.csv
//   node scripts/update-legacy.mjs --no-commit         # write file only
//   node scripts/update-legacy.mjs --dry-run           # print plan, don't write

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const args = parseArgs(process.argv.slice(2));
const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const HTML_PATH = join(REPO_ROOT, "index.html");
const CSV_PATH =
  args.csv ?? join(homedir(), "projects/spy_paper_bot/options_trades.csv");
const STARTING_BANKROLL = 1000;

const rows = loadCsv(CSV_PATH);
console.log(`[legacy] read ${rows.length} trades from ${CSV_PATH}`);

const html = readFileSync(HTML_PATH, "utf8");
const existingCount = (html.match(/<li class="trade /g) || []).length;
console.log(`[legacy] existing trade rows in HTML: ${existingCount}`);

if (rows.length === existingCount) {
  console.log("[legacy] no new trades — nothing to do.");
  process.exit(0);
}

if (rows.length < existingCount) {
  console.error(
    `[legacy] WARNING: CSV has fewer trades (${rows.length}) than HTML (${existingCount}). ` +
      `Refusing to remove rows automatically. Inspect manually.`,
  );
  process.exit(2);
}

const newRows = rows.slice(existingCount);
console.log(`[legacy] appending ${newRows.length} new trade(s):`);
for (const r of newRows) {
  console.log(
    `         · ${r.timestamp_open.slice(0, 10)} ${r.side.toUpperCase()} ${r.strike} ${r.exit_reason} ${signed(r.pnl_usd)}`,
  );
}

// Compute running bankroll over ALL trades (for both ticker + new-row labels).
let bankroll = STARTING_BANKROLL;
const rowsWithBank = rows.map((r) => {
  bankroll += Number(r.pnl_usd);
  return { ...r, bankrollAfter: bankroll };
});

// Render the new <li> blocks.
const renderedLis = newRows
  .map((r, i) => renderTradeLi(rowsWithBank[existingCount + i], existingCount + i + 1))
  .join("\n\n");

// Insert before the closing </ol> of .trades.
const olCloseRe = /(\n\s*<\/ol>\s*<p class="phase__after util">)/;
let updated = html.replace(
  olCloseRe,
  `\n\n${renderedLis}\n\n    </ol>\n\n    <p class="phase__after util">`,
);
// Sanity: that replace inserts a duplicate </ol>. Recover:
updated = updated.replace(
  /<\/ol>\s*\n\s*<\/ol>\s*\n\s*<p class="phase__after util">/,
  '</ol>\n\n    <p class="phase__after util">',
);

// Recompute stats from ALL trades.
const stats = computeStats(rowsWithBank);

// Replace .phase__stats block.
updated = updated.replace(
  /<div class="phase__stats">[\s\S]*?<\/div>\s*<\/header>/,
  renderStatsBlock(stats) + "\n    </header>",
);

// Update .phase__sub paragraph (count + date range).
const firstDate = rows[0].timestamp_open.slice(0, 10);
const lastDate = rows[rows.length - 1].timestamp_open.slice(0, 10);
updated = updated.replace(
  /(\d+ paper trades, <span class="ws-nowrap">)[^<]+(<\/span>)/,
  `${rows.length} paper trades, <span class="ws-nowrap">${firstDate} → ${lastDate}$2`,
);

if (args["dry-run"]) {
  console.log("[legacy] --dry-run: not writing.");
  console.log(`[legacy] would update phase__stats to: ${JSON.stringify(stats)}`);
  process.exit(0);
}

writeFileSync(HTML_PATH, updated);
console.log(`[legacy] wrote ${HTML_PATH}`);

if (!args["no-commit"]) {
  try {
    execFileSync("git", ["-C", REPO_ROOT, "add", "index.html"], { stdio: "inherit" });
    const msg = `feat(legacy): append ${newRows.length} new trade${newRows.length === 1 ? "" : "s"} (${newRows.map((r) => r.timestamp_open.slice(0, 10)).join(", ")})`;
    execFileSync(
      "git",
      [
        "-C", REPO_ROOT,
        "-c", "user.name=Ironclaw1644",
        "-c", "user.email=ironclaw1644@icloud.com",
        "commit", "-m",
        msg + "\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>",
      ],
      { stdio: "inherit" },
    );
    execFileSync("git", ["-C", REPO_ROOT, "push", "origin", "main"], { stdio: "inherit" });
    console.log("[legacy] ✓ committed + pushed. Vercel will auto-deploy.");
  } catch (e) {
    console.error("[legacy] commit/push failed — file is written, but git did not complete.");
    console.error(`        ${e.message}`);
    process.exit(3);
  }
}

// ─── HTML rendering ─────────────────────────────────────────────────────────

function renderTradeLi(row, dayNumber) {
  const dt = row.timestamp_open.slice(0, 10);
  const [, mm, dd] = dt.split("-");
  const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const dateLabel = `${months[Number(mm) - 1]} ${dd}`;

  const isWin = Number(row.pnl_usd) >= 0;
  const pct = Number(row.pnl_pct);
  const isWorst = pct <= -30;
  const isManual = row.exit_reason === "manual_lock_in";

  const classes = ["trade", isWin ? "trade--win" : "trade--loss"];
  if (!isWin && isWorst) classes.push("trade--worst");
  if (isManual) classes.push("trade--manual");

  const sideUpper = row.side.toUpperCase();
  const sideClass = row.side === "call" ? "trade__side--call" : "trade__side--put";
  const strikeShort = `${Number(row.strike).toFixed(0)}${row.side === "put" ? "P" : "C"}`;
  const exitLabel = exitLabelFor(row.exit_reason);
  const note = generateNarrative(row);
  const pnl = signed(row.pnl_usd);
  const bank = `→ ${fmtUsd(row.bankrollAfter)}`;

  return `      <li class="${classes.join(" ")}">
        <div class="trade__date">
          <div class="trade__day">${String(dayNumber).padStart(2, "0")}</div>
          <div class="trade__dt util">${dateLabel}</div>
        </div>
        <div class="trade__main">
          <div class="trade__head">
            <span class="trade__side ${sideClass}">${sideUpper}</span>
            <span class="trade__contract util">QQQ ${strikeShort} · 1DTE</span>
            <span class="trade__exit util">${exitLabel}</span>
          </div>
          <div class="trade__note">${note}</div>
        </div>
        <div class="trade__pnl">
          <div class="trade__pnl__val">${pnl}</div>
          <div class="trade__pnl__bank util">${bank}</div>
        </div>
      </li>`;
}

function renderStatsBlock(s) {
  const deltaClass = s.deltaPct >= 0 ? "phase__stat__val--up" : "phase__stat__val--down";
  const deltaSign = s.deltaPct >= 0 ? "+" : "";
  return `<div class="phase__stats">
        <div class="phase__stat">
          <div class="util">trades</div>
          <div class="phase__stat__val">${s.count}</div>
        </div>
        <div class="phase__stat">
          <div class="util">paper start</div>
          <div class="phase__stat__val">${fmtUsd(STARTING_BANKROLL)}</div>
        </div>
        <div class="phase__stat">
          <div class="util">paper end</div>
          <div class="phase__stat__val">${fmtUsd(s.end)}</div>
        </div>
        <div class="phase__stat">
          <div class="util">paper δ</div>
          <div class="phase__stat__val ${deltaClass}">${deltaSign}${s.deltaPct.toFixed(1)}%</div>
        </div>
        <div class="phase__stat">
          <div class="util">best</div>
          <div class="phase__stat__val phase__stat__val--up">${signed(s.best)}</div>
        </div>
        <div class="phase__stat">
          <div class="util">worst</div>
          <div class="phase__stat__val phase__stat__val--down">${signed(s.worst)}</div>
        </div>
      </div>`;
}

// ─── narrative + helpers ────────────────────────────────────────────────────

function generateNarrative(row) {
  const pct = Number(row.pnl_pct);
  const dur = Number(row.duration_min);
  const reason = row.exit_reason;
  const isWin = Number(row.pnl_usd) >= 0;
  const sig = (row.signal_reasoning || "").toLowerCase();
  const hasMagnet = /magnet=/.test(sig);
  const scoreMatch = sig.match(/score=(\d+)/);
  const score = scoreMatch ? scoreMatch[1] : null;

  const dPart = `${dur < 1 ? "<1" : dur.toFixed(0)} min`;
  const pctPart = `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;

  if (reason === "take_profit") {
    if (hasMagnet) return `magnet target hit. ${pctPart} on the option in ${dPart}.`;
    return `${score ? `score ${score}. ` : ""}take profit. ${pctPart} in ${dPart}.`;
  }
  if (reason === "trail_sl" && isWin) {
    return `trail caught the reversal. locked ${pctPart}.`;
  }
  if (reason === "trail_sl") {
    return `moved against then reversed. trail at ${pctPart}.`;
  }
  if (reason === "stop_loss") {
    if (Math.abs(pct) >= 30) {
      return `the bad one. wrong direction, hit SL hard. ${pctPart} in ${dPart}.`;
    }
    return `wrong direction. SL in ${dPart}.`;
  }
  if (reason === "time_stop") {
    return `didn't develop. bled to ${pctPart} over ${dPart}.`;
  }
  if (reason === "manual_lock_in") {
    return `closed by hand ${isWin ? "in green" : ""} before TP. ${pctPart}.`;
  }
  if (reason === "post_tp_trail") {
    return `runner past TP. trail locked ${pctPart}.`;
  }
  // fallback
  return `${reason}. ${pctPart} in ${dPart}.`;
}

function exitLabelFor(reason) {
  return {
    take_profit: "take profit",
    stop_loss: "stop loss",
    trail_sl: "trail stop",
    time_stop: "time stop",
    manual_lock_in: "manual close",
    post_tp_trail: "post-tp trail",
  }[reason] || reason.replace(/_/g, " ");
}

function fmtUsd(n) {
  const v = Math.abs(Number(n));
  const formatted = v >= 1000
    ? Math.round(v).toLocaleString("en-US")
    : v.toFixed(v < 100 ? 2 : 0);
  return `$${formatted}`;
}

function signed(n) {
  const v = Number(n);
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  const formatted = abs >= 1000
    ? Math.round(abs).toLocaleString("en-US")
    : abs.toFixed(abs < 100 ? 2 : 0);
  return `${sign}$${formatted}`;
}

function computeStats(rows) {
  const count = rows.length;
  const end = rows.length ? rows[rows.length - 1].bankrollAfter : STARTING_BANKROLL;
  const deltaPct = ((end - STARTING_BANKROLL) / STARTING_BANKROLL) * 100;
  const pnls = rows.map((r) => Number(r.pnl_usd));
  const best = pnls.length ? Math.max(...pnls) : 0;
  const worst = pnls.length ? Math.min(...pnls) : 0;
  return { count, end, deltaPct, best, worst };
}

// ─── csv parsing ────────────────────────────────────────────────────────────

function loadCsv(path) {
  const text = readFileSync(path, "utf8");
  const lines = text.trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--") || ["no-commit", "dry-run"].includes(key)) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}
