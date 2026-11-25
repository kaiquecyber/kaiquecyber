#!/usr/bin/env node
// Perfil "Aurora": gera SVGs animados a partir dos seus dados reais do GitHub.
//   assets/hero.svg      -> terminal com seu nome em pixel art, cargo e status
//   assets/shooter.svg   -> sua atividade como um jogo: a nave atira em cada dia com commit
//   assets/stack.svg     -> espectro de tecnologias (linguagens reais + o que você está estudando)
//   assets/project-N.svg -> cards dos projetos
//   assets/galaxy.svg    -> seus repositórios como estrelas + números-chave
//
// Uso:
//   GITHUB_TOKEN=xxx node scripts/generate.mjs     (dados reais)
//   node scripts/generate.mjs --sample             (dados de exemplo, sem internet)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets");
const cfg = JSON.parse(readFileSync(join(ROOT, "config.json"), "utf8"));
const login = process.env.GH_LOGIN || cfg.username;
const token = process.env.GITHUB_TOKEN;
const SAMPLE = process.argv.includes("--sample");

const SANS = "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";
const MONO = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace";
const C = { ink: "#e6edf3", muted: "#8b98ad", dim: "#5b6b86", line: "#1b2744", teal: "#2dd4bf", blue: "#60a5fa", violet: "#a78bfa", green: "#5cf2b8" };
const FALLBACK = ["#60a5fa", "#2dd4bf", "#a78bfa", "#f4a261", "#ff6b9d", "#80ed99"];

// ---------- utilidades ----------
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n1 = (n) => (Math.round(n * 10) / 10).toString();
const isHex = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
const mix = (hex, to, t) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.max(0, Math.min(255, Math.round(c + (to - c) * t))));
  return "#" + ch.map((c) => c.toString(16).padStart(2, "0")).join("");
};
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function wrap(text, max, lines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const out = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) {
      if (cur) out.push(cur);
      cur = w;
      if (out.length === lines) break;
    } else cur = (cur + " " + w).trim();
  }
  if (cur && out.length < lines) out.push(cur);
  if (out.join(" ").length < words.join(" ").length && out.length) out[out.length - 1] = out[out.length - 1].replace(/[.,;:\s]*$/, "").slice(0, max - 1) + "…";
  return out;
}
const svgOpen = (w, h, title, font = SANS) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" font-family="${font}">\n<title>${esc(title)}</title>\n`;
const panelDefs = (p, W, H, r = 16) =>
  `<defs><linearGradient id="${p}-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0d1530"/><stop offset="1" stop-color="#070b16"/></linearGradient><clipPath id="${p}-clip"><rect width="${W}" height="${H}" rx="${r}"/></clipPath></defs>\n<rect width="${W}" height="${H}" rx="${r}" fill="url(#${p}-bg)"/>\n`;
const panelBorder = (W, H, r = 16) => `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="${r}" fill="none" stroke="${C.line}"/>\n`;
const glow = (p, k, cx, cy, rx, ry, color, op, drift = 18, dur = 16) =>
  `<radialGradient id="${p}-g${k}"><stop offset="0" stop-color="${color}" stop-opacity="${op}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>
<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${p}-g${k})"><animateTransform attributeName="transform" type="translate" values="0,0;${drift},${drift / 2};0,0" dur="${dur}s" repeatCount="indefinite"/></ellipse>\n`;

// Linha do tempo SMIL: frames [[segundos, valor], ...] -> keyTimes/values normalizados
function track(frames, L) {
  const out = [];
  for (const [t, v] of frames) {
    let k = Math.min(1, Math.max(0, t / L));
    if (out.length && k <= out[out.length - 1][0]) k = out[out.length - 1][0] + 2e-6;
    out.push([k, v]);
  }
  if (out[0][0] > 0) out.unshift([0, out[0][1]]);
  const last = out[out.length - 1];
  if (last[0] < 1) out.push([1, last[1]]);
  else last[0] = 1;
  return { kt: out.map(([k]) => k.toFixed(6)).join(";"), vals: out.map(([, v]) => v).join(";") };
}
const animate = (attr, frames, L, mode = "linear") => {
  const { kt, vals } = track(frames, L);
  return `<animate attributeName="${attr}" dur="${n1(L * 100) / 100}s" repeatCount="indefinite" calcMode="${mode}" keyTimes="${kt}" values="${vals}"/>`;
};
const animateXY = (frames, L, mode = "linear") => {
  const { kt, vals } = track(frames, L);
  return `<animateTransform attributeName="transform" type="translate" dur="${n1(L * 100) / 100}s" repeatCount="indefinite" calcMode="${mode}" keyTimes="${kt}" values="${vals}"/>`;
};

// Fonte pixel 5x7 (A-Z)
const FONT5 = Object.fromEntries(
  Object.entries({
    A: ".###./#...#/#...#/#####/#...#/#...#/#...#", B: "####./#...#/#...#/####./#...#/#...#/####.", C: ".###./#...#/#..../#..../#..../#...#/.###.",
    D: "####./#...#/#...#/#...#/#...#/#...#/####.", E: "#####/#..../#..../####./#..../#..../#####", F: "#####/#..../#..../####./#..../#..../#....",
    G: ".###./#...#/#..../#.###/#...#/#...#/.###.", H: "#...#/#...#/#...#/#####/#...#/#...#/#...#", I: "#####/..#../..#../..#../..#../..#../#####",
    J: "..###/...#./...#./...#./...#./#..#./.##..", K: "#...#/#..#./#.#../##.../#.#../#..#./#...#", L: "#..../#..../#..../#..../#..../#..../#####",
    M: "#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#", N: "#...#/##..#/#.#.#/#..##/#...#/#...#/#...#", O: ".###./#...#/#...#/#...#/#...#/#...#/.###.",
    P: "####./#...#/#...#/####./#..../#..../#....", Q: ".###./#...#/#...#/#...#/#.#.#/#..#./.##.#", R: "####./#...#/#...#/####./#.#../#..#./#...#",
    S: ".####/#..../#..../.###./....#/....#/####.", T: "#####/..#../..#../..#../..#../..#../..#..", U: "#...#/#...#/#...#/#...#/#...#/#...#/.###.",
    V: "#...#/#...#/#...#/#...#/#...#/.#.#./..#..", W: "#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#", X: "#...#/#...#/.#.#./..#../.#.#./#...#/#...#",
    Y: "#...#/#...#/.#.#./..#../..#../..#../..#..", Z: "#####/....#/...#./..#../.#.../#..../#####",
  }).map(([k, v]) => [k, v.split("/")])
);
function pixelCols(text) {
  const clean = String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const cols = [];
  for (const ch of clean) {
    if (ch === " ") { cols.push([], [], []); continue; }
    const g = FONT5[ch];
    if (!g) continue;
    for (let c = 0; c < 5; c++) cols.push([...Array(7).keys()].filter((r) => g[r][c] === "#"));
    cols.push([]);
  }
  while (cols.length && !cols[cols.length - 1].length) cols.pop();
  return cols;
}

// ---------- dados ----------
async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "aurora-profile" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.data) throw new Error(`GitHub API: ${res.status} ${JSON.stringify(json.errors || json).slice(0, 300)}`);
  if (!json.data.user) throw new Error(`Usuário "${variables.login}" não encontrado.`);
  return json.data;
}

async function loadReal() {
  if (!token) throw new Error("Defina GITHUB_TOKEN (ou rode com --sample para testar sem internet).");
  const data = await gql(
    `query($login: String!) {
      user(login: $login) {
        avatarUrl(size: 240)
        repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
          totalCount
          nodes { name pushedAt languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } } }
        }
        contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } }
      }
    }`,
    { login }
  );
  const projects = (cfg.projects || []).filter((p) => /^[\w.-]+$/.test(p.repo || ""));
  let extra = {};
  if (projects.length) {
    const aliases = projects
      .map((p, i) => `r${i}: repository(owner: $login, name: ${JSON.stringify(p.repo)}) { name description stargazerCount pushedAt primaryLanguage { name color } }`)
      .join("\n");
    try { extra = await gql(`query($login: String!) { user(login: $login) { id } ${aliases} }`, { login }); }
    catch (e) { console.warn("Aviso: não consegui ler os projetos:", e.message); }
  }
  const u = data.user;
  const repos = u.repositories.nodes.map((r) => ({
    name: r.name,
    pushedAt: r.pushedAt,
    size: r.languages.edges.reduce((s, e) => s + e.size, 0),
    color: r.languages.edges[0]?.node.color,
    langs: r.languages.edges,
  }));
  let avatar = null;
  try {
    const img = await fetch(u.avatarUrl);
    if (img.ok) avatar = `data:${img.headers.get("content-type") || "image/jpeg"};base64,${Buffer.from(await img.arrayBuffer()).toString("base64")}`;
  } catch {}
  return {
    repos,
    repoCount: u.repositories.totalCount,
    days: u.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount }))),
    total: u.contributionsCollection.contributionCalendar.totalContributions,
    avatar,
    projects: projects.map((p, i) => ({ ...p, api: extra[`r${i}`] || null })),
  };
}

function loadSample() {
  const r = rng(11);
  const today = new Date();
  const days = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const p = i < 40 ? 0.45 : i < 120 ? 0.12 : 0.03;
    days.push({ date: d.toISOString().slice(0, 10), count: r() < p ? 1 + Math.floor(r() * 7) : 0 });
  }
  const L = { JavaScript: "#f1e05a", HTML: "#e34c26", CSS: "#7b5ea7" };
  const names = ["JavaScript", "HTML", "CSS"];
  const repos = Array.from({ length: 10 }, (_, i) => {
    const n = names[i % 3];
    return { name: `repo-${i}`, pushedAt: new Date(Date.now() - i * i * 6e8).toISOString(), size: 3000 + r() * 40000, color: L[n], langs: [{ size: 1000, node: { name: n, color: L[n] } }] };
  });
  return { repos, repoCount: 10, days, total: days.reduce((s, d) => s + d.count, 0), avatar: null, projects: (cfg.projects || []).map((p, i) => ({ ...p, api: { pushedAt: new Date(Date.now() - (i + 1) * 9e8).toISOString(), stargazerCount: i === 0 ? 2 : 0, primaryLanguage: { name: p.tags?.[0] || "JavaScript", color: Object.values(L)[i % 3] } } })) };
}

function streaks(days) {
  let best = 0, run = 0;
  for (const d of days) { run = d.count > 0 ? run + 1 : 0; best = Math.max(best, run); }
  let cur = 0, i = days.length - 1;
  if (i >= 0 && days[i].count === 0) i--;
  for (; i >= 0 && days[i].count > 0; i--) cur++;
  return { cur, best };
}
function weeksOf(days, count) {
  const weeks = [];
  for (const d of days.slice(-(count * 7 + 7))) {
    const dt = new Date(d.date + "T00:00:00Z");
    if (!weeks.length || dt.getUTCDay() === 0) weeks.push([]);
    weeks[weeks.length - 1].push({ ...d, dow: dt.getUTCDay() });
  }
  return weeks.slice(-count);
}
const ago = (iso) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  if (!(d >= 0)) return "";
  if (d < 1) return "atualizado hoje";
  if (d < 30) return `atualizado há ${d} ${d === 1 ? "dia" : "dias"}`;
  const m = Math.floor(d / 30);
  return m < 12 ? `atualizado há ${m} ${m === 1 ? "mês" : "meses"}` : "atualizado há +1 ano";
};

// ---------- 1) HERO ----------
function typedLine(p, k, x, y, segs, begin, dur) {
  const len = segs.reduce((n, [t]) => n + [...t].length, 0);
  const w = len * 8.7 + 10;
  return {
    defs: `<clipPath id="${p}-t${k}"><rect x="${x - 2}" y="${y - 17}" width="0" height="26"><animate attributeName="width" from="0" to="${n1(w)}" begin="${begin}s" dur="${dur}s" fill="freeze"/></rect></clipPath>`,
    body: `<text x="${x}" y="${y}" font-family="${MONO}" font-size="14" xml:space="preserve" clip-path="url(#${p}-t${k})">${segs.map(([t, c]) => `<tspan fill="${c}">${esc(t)}</tspan>`).join("")}</text>\n`,
    endX: x + len * 8.4,
    end: begin + dur,
  };
}

function renderHero({ avatar, learning, langNames }) {
  const W = 900, H = 276, p = "h", X = 206;
  const name = cfg.name || login;
  const cols = pixelCols(name);
  const cell = Math.max(4, Math.min(8, Math.floor(640 / Math.max(1, cols.length))));
  const wmW = cols.length * cell, wmY = 92;
  const stackNow = langNames.slice(0, 3).join(" · ");
  const stackNext = learning.join(" · ");
  const l1 = typedLine(p, 1, X, 190, [["> ", C.green], [cfg.role, C.ink]], 1.5, 1.1);
  const l2 = typedLine(p, 2, X, 216, [["> ", C.green], [stackNow || "HTML · CSS · JavaScript", C.ink], stackNext ? ["   →   ", C.dim] : ["", C.ink], [stackNext, C.violet]], 2.7, 1.3);
  const l3 = typedLine(p, 3, X + 18, 243, [[cfg.status || "aberto a oportunidades", C.muted]], 4.1, 1.0);
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  let s = svgOpen(W, H, `${name}, ${cfg.role}`);
  s += panelDefs(p, W, H);
  s += `<defs>
<linearGradient id="${p}-wm" gradientUnits="userSpaceOnUse" x1="${X}" y1="0" x2="${X + wmW}" y2="0" spreadMethod="reflect"><stop offset="0" stop-color="${C.teal}"/><stop offset=".5" stop-color="${C.blue}"/><stop offset="1" stop-color="${C.violet}"/><animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="${wmW * 2} 0" dur="14s" repeatCount="indefinite"/></linearGradient>
<linearGradient id="${p}-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.teal}"/><stop offset="1" stop-color="${C.violet}"/></linearGradient>
<clipPath id="${p}-av"><circle cx="110" cy="160" r="48"/></clipPath>
${l1.defs}${l2.defs}${l3.defs}
</defs>\n<g clip-path="url(#${p}-clip)">\n`;
  s += glow(p, 1, 760, 120, 260, 120, C.teal, 0.13) + glow(p, 2, 300, 240, 300, 110, C.violet, 0.12, -16, 20);
  // barra de título do terminal
  s += `<rect width="${W}" height="34" fill="#0a1022"/><line x1="0" y1="34.5" x2="${W}" y2="34.5" stroke="${C.line}"/>
<circle cx="22" cy="17" r="5.5" fill="#ff5f56"/><circle cx="42" cy="17" r="5.5" fill="#ffbd2e"/><circle cx="62" cy="17" r="5.5" fill="#27c93f"/>
<text x="${W / 2}" y="21" text-anchor="middle" font-family="${MONO}" font-size="12" fill="${C.dim}">${esc(login)}@github: ~/portfolio</text>\n`;
  // avatar
  s += `<circle cx="110" cy="160" r="64" fill="none" stroke="${C.teal}" stroke-opacity=".35" stroke-dasharray="2 7"><animateTransform attributeName="transform" type="rotate" from="0 110 160" to="360 110 160" dur="60s" repeatCount="indefinite"/></circle>
<circle cx="110" cy="160" r="54" fill="none" stroke="url(#${p}-ring)" stroke-width="3"/>\n`;
  s += avatar
    ? `<image href="${avatar}" xlink:href="${avatar}" x="62" y="112" width="96" height="96" preserveAspectRatio="xMidYMid slice" clip-path="url(#${p}-av)"/>\n`
    : `<circle cx="110" cy="160" r="48" fill="#121a33"/><text x="110" y="170" text-anchor="middle" font-size="28" font-weight="700" fill="${C.blue}">${esc(initials)}</text>\n`;
  // prompt + nome em pixel art
  s += `<text x="${X}" y="76" font-family="${MONO}" font-size="13" fill="${C.green}">$<tspan fill="${C.muted}"> whoami</tspan></text>\n`;
  cols.forEach((rows, ci) => {
    if (!rows.length) return;
    s += `<g opacity="0"><animate attributeName="opacity" from="0" to="1" dur=".35s" begin="${n1(0.35 + ci * 0.022)}s" fill="freeze"/>`;
    for (const r of rows) s += `<rect x="${X + ci * cell}" y="${wmY + r * cell}" width="${cell - 1}" height="${cell - 1}" rx="1.5" fill="url(#${p}-wm)"/>`;
    s += `</g>\n`;
  });
  s += l1.body + l2.body + l3.body;
  // status pulsando + cursor
  s += `<circle cx="${X + 5}" cy="238.5" r="4" fill="${C.green}" opacity="0"><animate attributeName="opacity" from="0" to="1" begin="${l3.end - 0.9}s" dur=".2s" fill="freeze"/></circle>
<circle cx="${X + 5}" cy="238.5" r="4" fill="none" stroke="${C.green}" opacity="0"><animate attributeName="r" values="4;11" dur="2s" begin="${l3.end}s" repeatCount="indefinite"/><animate attributeName="opacity" values=".7;0" dur="2s" begin="${l3.end}s" repeatCount="indefinite"/></circle>
<rect x="${n1(l3.endX + 24)}" y="230" width="8" height="15" fill="${C.green}" opacity="0"><animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;.05;.5;.55;1" dur="1.1s" begin="${l3.end}s" repeatCount="indefinite"/></rect>\n`;
  s += `</g>\n` + panelBorder(W, H) + `</svg>\n`;
  return s;
}

// ---------- 2) NAVE (space shooter) ----------
function renderShooter({ days, total }) {
  const W = 900, H = 276, P = 16, CELL = 12, p = "s";
  const cols = weeksOf(days, 53);
  const x0 = Math.round((W - cols.length * P) / 2) + 2, y0 = 48;
  const max = Math.max(1, ...cols.flat().map((d) => d.count));
  const lvl = (c) => (c === 0 ? 0 : c / max <= 0.25 ? 1 : c / max <= 0.5 ? 2 : c / max <= 0.75 ? 3 : 4);
  const PAL = ["#111a2e", "#0f4a47", "#128673", "#1fc79a", C.green];
  const { cur, best } = streaks(days);

  const all = [];
  cols.forEach((w, ci) => w.forEach((d) => { if (d.count > 0) all.push({ ci, row: d.dow, cx: x0 + ci * P + CELL / 2, cy: y0 + d.dow * P + CELL / 2, count: d.count, lv: lvl(d.count), date: d.date }); }));
  all.sort((a, b) => a.ci - b.ci || b.row - a.row);
  let shots = all;
  if (all.length > 140) {
    const keep = new Set([...all].sort((a, b) => b.count - a.count).slice(0, 140));
    shots = all.filter((t) => keep.has(t));
  }
  const shotSet = new Set(shots);

  const shipY = H - 40, muzzle = shipY - 24, speed = 520, minSlot = 0.34, travel = 0.2, mid = W / 2;
  let L = 8;
  if (shots.length) {
    let t = Math.max(1.2, Math.abs(shots[0].cx - mid) / speed + 0.5), prev = shots[0].cx;
    shots.forEach((s, i) => {
      if (i) t += Math.max(minSlot, Math.abs(s.cx - prev) / speed + 0.12);
      s.t = t; prev = s.cx;
    });
    L = shots[shots.length - 1].t + travel + 3.4;
  }
  const title = `Atividade de ${login} no último ano como um jogo: ${total} contribuições, sequência atual de ${cur} dias, maior sequência de ${best}`;

  let s = svgOpen(W, H, title);
  s += panelDefs(p, W, H);
  s += `<defs><rect id="${p}-c" width="${CELL}" height="${CELL}" rx="3"/>
<linearGradient id="${p}-hull" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe3ff"/><stop offset=".5" stop-color="${C.blue}"/><stop offset="1" stop-color="#2f5fd0"/></linearGradient>
<radialGradient id="${p}-eg"><stop offset="0" stop-color="${C.green}" stop-opacity=".55"/><stop offset="1" stop-color="${C.green}" stop-opacity="0"/></radialGradient></defs>
<g clip-path="url(#${p}-clip)">\n`;
  s += glow(p, 1, 450, 150, 380, 110, C.teal, 0.08, 22, 18);
  const r = rng(5);
  for (let i = 0; i < 46; i++) s += `<circle cx="${n1(r() * W)}" cy="${n1(r() * H)}" r="${n1(0.4 + r() * 0.9)}" fill="#fff" opacity="${n1(0.15 + r() * 0.35)}"/>`;
  s += "\n";
  // HUD
  s += `<g font-family="${MONO}" font-size="12"><text x="28" y="28" fill="${C.dim}">PONTOS <tspan fill="${C.green}" font-weight="700">${total.toLocaleString("pt-BR")}</tspan></text>
<text x="${W / 2}" y="28" text-anchor="middle" fill="${C.dim}">cada bloco é um dia · cada tiro é uma contribuição</text>
<text x="${W - 28}" y="28" text-anchor="end" fill="${C.dim}">SEQUÊNCIA <tspan fill="${C.green}" font-weight="700">${cur}</tspan>   RECORDE <tspan fill="${C.green}" font-weight="700">${best}</tspan></text></g>\n`;
  // grade
  cols.forEach((w, ci) => w.forEach((d) => {
    const x = x0 + ci * P, y = y0 + d.dow * P, lv = lvl(d.count);
    const target = [...shotSet].find((t) => t.ci === ci && t.row === d.dow);
    if (!lv || !target) { s += `<use href="#${p}-c" xlink:href="#${p}-c" x="${x}" y="${y}" fill="${PAL[lv]}"><title>${d.date}: ${d.count}</title></use>`; return; }
    const hit = target.t + travel;
    s += `<use href="#${p}-c" xlink:href="#${p}-c" x="${x}" y="${y}" fill="${PAL[lv]}"><title>${d.date}: ${d.count}</title>${animate("opacity", [[0, 1], [hit, 1], [hit + 0.14, 0], [L - 0.8, 0], [L, 1]], L)}</use>`;
  }));
  s += "\n";
  if (shots.length) {
    // bala, explosão e nave
    const fb = shots[0];
    const bTrans = [[0, `${fb.cx},${muzzle}`]], bOp = [[0, 0]], ePos = [[0, "-60,-60"]], eR = [[0, 0]], eOp = [[0, 0]], ship = [[0, mid]];
    shots.forEach((t) => {
      const hit = t.t + travel;
      bTrans.push([t.t, `${n1(t.cx)},${muzzle}`], [hit, `${n1(t.cx)},${n1(t.cy)}`]);
      bOp.push([t.t, 1], [hit, 0]);
      ePos.push([hit - 0.004, `${n1(t.cx)},${n1(t.cy)}`]);
      eR.push([hit - 0.003, 0], [hit, 2], [hit + 0.3, 11]);
      eOp.push([hit - 0.003, 0], [hit, 0.95], [hit + 0.3, 0]);
      ship.push([t.t, n1(t.cx)]);
    });
    const lastT = shots[shots.length - 1].t + travel + 0.5;
    ship.push([lastT, shots[shots.length - 1].cx], [L, mid]);
    s += `<g>${animateXY(bTrans, L)}<rect x="-3" y="-10" width="6" height="12" rx="3" fill="${C.green}" opacity="0">${animate("opacity", bOp.map(([t, v]) => [t, v * 0.3]), L, "discrete")}</rect><rect x="-1.4" y="-10" width="2.8" height="11" rx="1.4" fill="#eafff6" opacity="0">${animate("opacity", bOp, L, "discrete")}</rect></g>\n`;
    s += `<g>${animateXY(ePos, L, "discrete")}<circle r="0" fill="url(#${p}-eg)">${animate("r", eR.map(([t, v]) => [t, v * 2.2]), L)}${animate("opacity", eOp, L)}</circle><circle r="0" fill="none" stroke="${C.green}" stroke-width="1.5">${animate("r", eR, L)}${animate("opacity", eOp, L)}</circle></g>\n`;
    s += `<g>${animateXY(ship.map(([t, x]) => [t, `${x},${shipY}`]), L)}${shipShape(p)}</g>\n`;
  } else {
    s += `<g transform="translate(${mid} ${shipY})"><animateTransform attributeName="transform" type="translate" values="${mid - 70},${shipY};${mid + 70},${shipY};${mid - 70},${shipY}" dur="9s" repeatCount="indefinite"/>${shipShape(p)}</g>\n`;
  }
  return s + `</g>\n` + panelBorder(W, H) + `</svg>\n`;
}
function shipShape(p) {
  return `<path d="M-5,16 L0,${28} L5,16 Z" fill="#ffb347"><animate attributeName="opacity" values=".55;1;.55" dur=".18s" repeatCount="indefinite"/></path>
<path d="M0,-24 L8,-6 L21,10 L12,10 L8,17 L-8,17 L-12,10 L-21,10 L-8,-6 Z" fill="url(#${p}-hull)"/>
<path d="M0,-24 L3,-6 L0,17 L-3,-6 Z" fill="#ffffff" opacity=".18"/><ellipse cx="0" cy="-3" rx="3.2" ry="5.2" fill="#0a1226" stroke="#bfe3ff" stroke-width="1"/>`;
}

// ---------- 3) STACK ----------
const CODE = { JavaScript: "JS", TypeScript: "TS", HTML: "H5", CSS: "C3", Python: "PY", Vue: "VU", Markdown: "MD", Shell: "SH", Java: "JV", PHP: "PH", "C#": "C#", "C++": "C+" };
function renderStack({ langs, learning }) {
  const W = 900, p = "k", colW = 205, x0 = 46;
  const known = new Set(langs.map((l) => l.name.toLowerCase()));
  const study = learning.filter((n) => !known.has(n.toLowerCase()));
  const rows = Math.ceil(langs.length / 4);
  const yTiles = 118, rowH = 104;
  const yStudy = yTiles + rows * rowH + 8;
  const H = yStudy + (study.length ? 126 : 8) + 14;
  const maxPct = langs[0]?.pct || 1;
  let s = svgOpen(W, H, `Tecnologias de ${login}: ${langs.map((l) => `${l.name} ${l.pct}%`).join(", ")}${study.length ? `; em estudo: ${study.join(", ")}` : ""}`);
  s += panelDefs(p, W, H) + `<g clip-path="url(#${p}-clip)">` + glow(p, 1, 780, 40, 260, 90, C.violet, 0.1, 14, 18);
  s += `<text x="${x0}" y="44" font-family="${MONO}" font-size="12" fill="${C.dim}">// espectro de tecnologias</text>
<text x="${x0}" y="74" font-size="23" font-weight="700" fill="${C.ink}">As ferramentas por trás do trabalho</text>
<line x1="${x0}" y1="92" x2="${W - x0}" y2="92" stroke="${C.line}" stroke-dasharray="5 7"/>\n`;
  langs.forEach((l, i) => {
    const x = x0 + (i % 4) * colW, y = yTiles + Math.floor(i / 4) * rowH, bw = 168, fw = Math.max(6, (bw * l.pct) / maxPct);
    const code = CODE[l.name] || l.name.slice(0, 2).toUpperCase();
    const bright = mix(l.color, 255, 0.25);
    s += `<rect x="${x}" y="${y}" width="36" height="36" rx="9" fill="${l.color}" fill-opacity=".16" stroke="${l.color}" stroke-opacity=".45"/>
<text x="${x + 18}" y="${y + 23}" text-anchor="middle" font-family="${MONO}" font-size="13" font-weight="700" fill="${bright}">${esc(code)}</text>
<text x="${x}" y="${y + 58}" font-size="15" font-weight="600" fill="${C.ink}">${esc(l.name)}</text>
<text x="${x}" y="${y + 75}" font-family="${MONO}" font-size="11" fill="${C.muted}">${l.pct}% do código público</text>
<rect x="${x}" y="${y + 85}" width="${bw}" height="3" rx="1.5" fill="#16213d"/>
<rect x="${x}" y="${y + 85}" width="0" height="3" rx="1.5" fill="${l.color}"><animate attributeName="width" from="0" to="${n1(fw)}" dur=".9s" begin="${n1(0.2 + i * 0.12)}s" fill="freeze"/></rect>
<circle cx="${x}" cy="${y + 86.5}" r="3" fill="${bright}" opacity="0"><animate attributeName="cx" from="${x}" to="${n1(x + fw)}" dur=".9s" begin="${n1(0.2 + i * 0.12)}s" fill="freeze"/><animate attributeName="opacity" from="1" to="1" begin="${n1(0.2 + i * 0.12)}s" dur=".01s" fill="freeze"/></circle>\n`;
  });
  if (study.length) {
    s += `<line x1="${x0}" y1="${yStudy}" x2="${W - x0}" y2="${yStudy}" stroke="${C.line}" stroke-dasharray="5 7"/>
<text x="${x0}" y="${yStudy + 28}" font-family="${MONO}" font-size="12" fill="${C.dim}">// em estudo agora</text>\n`;
    study.slice(0, 4).forEach((n, i) => {
      const x = x0 + i * colW, y = yStudy + 44;
      s += `<rect x="${x}" y="${y}" width="36" height="36" rx="9" fill="${C.violet}" fill-opacity=".08" stroke="${C.violet}" stroke-opacity=".6" stroke-dasharray="3 3"/>
<text x="${x + 18}" y="${y + 23}" text-anchor="middle" font-family="${MONO}" font-size="13" font-weight="700" fill="${C.violet}">${esc(CODE[n] || n.slice(0, 2).toUpperCase())}</text>
<text x="${x + 50}" y="${y + 15}" font-size="15" font-weight="600" fill="${C.ink}">${esc(n)}</text>
<text x="${x + 50}" y="${y + 32}" font-family="${MONO}" font-size="11" fill="${C.violet}">próximo passo</text>
<circle cx="${x + 36 + 0}" cy="${y + 4}" r="3" fill="${C.violet}"><animate attributeName="opacity" values="1;.2;1" dur="2.4s" begin="${i * 0.4}s" repeatCount="indefinite"/></circle>\n`;
    });
  }
  return s + `</g>\n` + panelBorder(W, H) + `</svg>\n`;
}

// ---------- 4) CARDS DOS PROJETOS ----------
function renderProject(pr, i) {
  const W = 280, H = 204, p = `p${i}`;
  const api = pr.api, lang = api?.primaryLanguage;
  const color = isHex(lang?.color) ? lang.color : FALLBACK[i % FALLBACK.length];
  const title = pr.title || api?.name || pr.repo;
  const desc = pr.description || api?.description || "";
  const lines = wrap(desc, 36, 3);
  const r = rng(300 + i);
  let s = svgOpen(W, H, `${title}: ${desc}`);
  s += `<defs><linearGradient id="${p}-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f1733"/><stop offset="1" stop-color="#070b16"/></linearGradient>
<radialGradient id="${p}-gl"><stop offset="0" stop-color="${color}" stop-opacity=".45"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>
<radialGradient id="${p}-pl" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${mix(color, 255, 0.45)}"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${mix(color, 0, 0.55)}"/></radialGradient></defs>
<rect width="${W}" height="${H}" rx="14" fill="url(#${p}-bg)"/>\n`;
  for (let k = 0; k < 12; k++) s += `<circle cx="${n1(r() * W)}" cy="${n1(r() * H)}" r="${n1(0.4 + r() * 0.8)}" fill="#fff" opacity="${n1(0.15 + r() * 0.3)}"/>`;
  s += `\n<circle cx="38" cy="40" r="32" fill="url(#${p}-gl)"/><circle cx="38" cy="40" r="15" fill="url(#${p}-pl)"/>
<g transform="translate(38 40) rotate(-20)"><ellipse rx="29" ry="10" fill="none" stroke="#fff" stroke-opacity=".16" stroke-dasharray="2 4"/><circle r="3.4" fill="${C.ink}"><animateMotion dur="${5 + i}s" begin="-${i * 1.4}s" repeatCount="indefinite" path="M29,0 A29,10 0 1,1 -29,0 A29,10 0 1,1 29,0"/></circle></g>
<text x="76" y="38" font-size="16" font-weight="700" fill="${C.ink}">${esc(title.length > 18 ? title.slice(0, 17) + "…" : title)}</text>\n`;
  if (lang?.name) s += `<circle cx="80" cy="53" r="3.5" fill="${color}"/><text x="89" y="57" font-family="${MONO}" font-size="11" fill="${C.muted}">${esc(lang.name)}</text>\n`;
  if (api?.stargazerCount > 0) s += `<text x="${W - 18}" y="57" text-anchor="end" font-family="${MONO}" font-size="11" fill="${C.muted}">★ ${api.stargazerCount}</text>\n`;
  s += `<line x1="18" y1="80" x2="${W - 18}" y2="80" stroke="${C.line}"/>\n`;
  lines.forEach((ln, k) => (s += `<text x="18" y="${102 + k * 18}" font-size="13" fill="#b4bfd0">${esc(ln)}</text>\n`));
  let tx = 18;
  for (const t of (pr.tags || []).slice(0, 3)) {
    const w = Math.round(t.length * 6.6 + 18);
    s += `<rect x="${tx}" y="150" width="${w}" height="20" rx="10" fill="#101a35" stroke="#24345c"/><text x="${tx + w / 2}" y="164" text-anchor="middle" font-family="${MONO}" font-size="10.5" fill="${C.blue}">${esc(t)}</text>\n`;
    tx += w + 6;
  }
  const foot = [pr.demo ? "demo online" : "código aberto", api?.pushedAt ? ago(api.pushedAt) : ""].filter(Boolean).join("  ·  ");
  s += `<line x1="18" y1="180" x2="${W - 18}" y2="180" stroke="${C.line}"/>`;
  if (pr.demo) s += `<circle cx="22" cy="194" r="3" fill="${C.green}"><animate attributeName="opacity" values="1;.3;1" dur="2s" repeatCount="indefinite"/></circle><text x="30" y="197" font-family="${MONO}" font-size="10.5" fill="${C.muted}">${esc(foot)}</text>\n`;
  else s += `<text x="18" y="197" font-family="${MONO}" font-size="10.5" fill="${C.muted}">${esc(foot)}</text>\n`;
  return s + `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="${C.line}"/></svg>\n`;
}

// ---------- 5) GALÁXIA ----------
function renderGalaxy({ repos, repoCount, days, langCount }) {
  const W = 900, H = 214, p = "g", cx = 215, cy = 107;
  const { best } = streaks(days);
  const activeDays = days.filter((d) => d.count > 0).length;
  const list = [...repos].sort((a, b) => new Date(b.pushedAt) - new Date(a.pushedAt)).slice(0, 40);
  const maxSize = Math.max(1, ...list.map((x) => x.size));
  const r = rng(21);
  let s = svgOpen(W, H, `${repoCount} repositórios públicos de ${login} representados como estrelas; ${activeDays} dias ativos no último ano; maior sequência de ${best} dias`);
  s += panelDefs(p, W, H) + `<defs><linearGradient id="${p}-num" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.teal}"/><stop offset="1" stop-color="${C.blue}"/></linearGradient>
<radialGradient id="${p}-core"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".2" stop-color="${C.teal}" stop-opacity=".5"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/></radialGradient></defs>
<g clip-path="url(#${p}-clip)">\n`;
  for (let i = 0; i < 90; i++) {
    const a = r() * 6.283, d = Math.sqrt(r()) * 190;
    s += `<circle cx="${n1(cx + Math.cos(a) * d * 1.15)}" cy="${n1(cy + Math.sin(a) * d * 0.55)}" r="${n1(0.4 + r() * 0.8)}" fill="#fff" opacity="${n1(0.1 + r() * 0.3)}"/>`;
  }
  s += `\n<g><animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur="140s" repeatCount="indefinite"/>
<circle cx="${cx}" cy="${cy}" r="34" fill="url(#${p}-core)"/>\n`;
  list.forEach((rp, i) => {
    const ang = i * 2.399963, rad = Math.min(98, 27 * Math.sqrt(i + 0.5)), x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
    const color = isHex(rp.color) ? rp.color : FALLBACK[i % FALLBACK.length];
    const age = (Date.now() - new Date(rp.pushedAt).getTime()) / 864e5;
    const lum = Math.max(0.35, Math.min(1, 1 - age / 400));
    const sz = 2 + 3.2 * Math.sqrt(rp.size / maxSize);
    s += `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(sz * 2.3)}" fill="${color}" opacity="${n1(0.2 * lum)}"/><circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(sz)}" fill="${mix(color, 255, 0.3)}" opacity="${n1(lum)}"><animate attributeName="opacity" values="${n1(lum)};${n1(lum * 0.55)};${n1(lum)}" dur="${n1(3 + r() * 4)}s" begin="-${n1(r() * 5)}s" repeatCount="indefinite"/></circle>\n`;
  });
  s += `</g>\n<text x="28" y="${H - 20}" font-family="${MONO}" font-size="11" fill="${C.dim}">cada estrela é um repositório · brilho = atividade recente</text>\n`;
  const stat = (x, y, n, label) => `<text x="${x}" y="${y}" font-size="40" font-weight="700" fill="url(#${p}-num)">${esc(n)}</text><text x="${x}" y="${y + 22}" font-family="${MONO}" font-size="12" fill="${C.muted}">${esc(label)}</text>\n`;
  s += stat(500, 88, String(repoCount), "repositórios públicos") + stat(700, 88, String(langCount), langCount === 1 ? "linguagem" : "linguagens");
  s += stat(500, 172, String(activeDays), "dias ativos em 12 meses") + stat(700, 172, String(best), best === 1 ? "dia na maior sequência" : "dias na maior sequência");
  s += `<line x1="450" y1="30" x2="450" y2="${H - 30}" stroke="${C.line}"/></g>\n` + panelBorder(W, H) + `</svg>\n`;
  return s;
}

// ---------- execução ----------
mkdirSync(OUT, { recursive: true });
const data = SAMPLE ? loadSample() : await loadReal();
if (!data.avatar && existsSync(join(OUT, "avatar.jpg"))) data.avatar = `data:image/jpeg;base64,${readFileSync(join(OUT, "avatar.jpg")).toString("base64")}`;

const agg = new Map();
for (const rp of data.repos) for (const e of rp.langs) {
  const c = agg.get(e.node.name) || { name: e.node.name, color: e.node.color, size: 0 };
  c.size += e.size; agg.set(e.node.name, c);
}
const total = [...agg.values()].reduce((s, l) => s + l.size, 0) || 1;
const allLangs = [...agg.values()].sort((a, b) => b.size - a.size);
const langs = allLangs.slice(0, 8).map((l, i) => ({ name: l.name, color: isHex(l.color) ? l.color : FALLBACK[i % FALLBACK.length], pct: Math.max(1, Math.round((l.size / total) * 100)) }));
const learning = cfg.learning || [];

writeFileSync(join(OUT, "hero.svg"), renderHero({ avatar: data.avatar, learning, langNames: langs.map((l) => l.name) }));
writeFileSync(join(OUT, "shooter.svg"), renderShooter({ days: data.days, total: data.total }));
if (langs.length) writeFileSync(join(OUT, "stack.svg"), renderStack({ langs, learning }));
data.projects.forEach((pr, i) => writeFileSync(join(OUT, `project-${i}.svg`), renderProject(pr, i)));
writeFileSync(join(OUT, "galaxy.svg"), renderGalaxy({ repos: data.repos, repoCount: data.repoCount, days: data.days, langCount: allLangs.length }));
console.log(`OK: ${langs.map((l) => `${l.name} ${l.pct}%`).join(", ")} | ${data.projects.length} projetos | ${data.total} contribuições`);
