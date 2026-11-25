#!/usr/bin/env node
// Gera os SVGs animados do "Sistema Solar" do perfil:
//   assets/solar-orbits.svg  -> você é o sol, suas linguagens são os planetas, commits recentes são cometas
//   assets/solar-card-N.svg  -> um card por projeto (o projeto é um planeta com uma lua)
//   assets/solar-log.svg     -> atividade das últimas 26 semanas + sequências
//
// Uso:
//   GITHUB_TOKEN=xxx node scripts/generate-solar-system.mjs   (dados reais)
//   node scripts/generate-solar-system.mjs --sample           (dados de exemplo, sem internet)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets");
const config = JSON.parse(readFileSync(join(ROOT, "config.json"), "utf8"));
const login = process.env.GH_LOGIN || config.username;
const token = process.env.GITHUB_TOKEN;
const SAMPLE = process.argv.includes("--sample");

const FONT = "'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif";
const INK = "#e6edf3";
const MUTED = "#8b949e";
const FALLBACK_COLORS = ["#ffb703", "#4cc9f0", "#c77dff", "#80ed99", "#ff6b6b", "#f4a261"];

// ---------- utilidades ----------
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f1 = (n) => Number(n).toFixed(1);
const isHex = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

function mix(hex, to, t) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.max(0, Math.min(255, Math.round(c + (to - c) * t))));
  return "#" + ch.map((c) => c.toString(16).padStart(2, "0")).join("");
}

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
  if (out.join(" ").length < words.join(" ").length && out.length) {
    out[out.length - 1] = out[out.length - 1].replace(/[.,;:\s]*$/, "").slice(0, max - 1) + "…";
  }
  return out;
}

const svgOpen = (w, h, title) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" font-family="${FONT}">\n<title>${esc(title)}</title>\n`;

// ---------- dados ----------
async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "solar-system-readme" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.data) throw new Error(`GitHub API: ${res.status} ${JSON.stringify(json.errors || json).slice(0, 300)}`);
  if (!json.data.user) throw new Error(`Usuário "${variables.login}" não encontrado.`);
  return json.data;
}

async function loadReal() {
  if (!token) throw new Error("Defina GITHUB_TOKEN (ou rode com --sample para testar sem internet).");
  const projects = (config.projects || []).filter((p) => /^[\w.-]+$/.test(p.repo || ""));
  const aliases = projects
    .map((p, i) => `r${i}: repository(owner: $login, name: ${JSON.stringify(p.repo)}) { name description stargazerCount url primaryLanguage { name color } }`)
    .join("\n");
  const data = await gql(
    `query($login: String!) {
      user(login: $login) {
        avatarUrl(size: 200)
        repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
          nodes { languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } } }
        }
        contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } }
      }
    }`,
    { login }
  );
  // consulta separada para os projetos (se um repositório não existir, os outros continuam funcionando)
  let repos = {};
  if (aliases) {
    try {
      repos = await gql(`query($login: String!) { user(login: $login) { id } ${aliases} }`, { login });
    } catch (e) {
      console.warn("Aviso: não consegui ler os projetos:", e.message);
    }
  }
  const u = data.user;
  const byLang = new Map();
  for (const repo of u.repositories.nodes)
    for (const e of repo.languages.edges) {
      const cur = byLang.get(e.node.name) || { name: e.node.name, color: e.node.color, size: 0 };
      cur.size += e.size;
      byLang.set(e.node.name, cur);
    }
  const days = u.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount })));
  let avatar = null;
  try {
    const img = await fetch(u.avatarUrl);
    if (img.ok) avatar = `data:${img.headers.get("content-type") || "image/jpeg"};base64,${Buffer.from(await img.arrayBuffer()).toString("base64")}`;
  } catch {}
  return {
    languages: [...byLang.values()],
    days,
    total: u.contributionsCollection.contributionCalendar.totalContributions,
    avatar,
    projects: projects.map((p, i) => ({ ...p, api: repos[`r${i}`] || null })),
  };
}

function loadSample() {
  const r = rng(42);
  const today = new Date();
  const days = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const recent = i < 50;
    const count = recent && r() < 0.28 ? 1 + Math.floor(r() * 6) : 0;
    days.push({ date: d.toISOString().slice(0, 10), count });
  }
  return {
    languages: [
      { name: "JavaScript", color: "#f1e05a", size: 58 },
      { name: "HTML", color: "#e34c26", size: 30 },
      { name: "CSS", color: "#7b5ea7", size: 12 },
    ],
    days,
    total: days.reduce((s, d) => s + d.count, 0),
    avatar: null,
    projects: (config.projects || []).map((p) => ({ ...p, api: null })),
  };
}

function streaks(days) {
  let best = 0, run = 0;
  for (const d of days) { run = d.count > 0 ? run + 1 : 0; best = Math.max(best, run); }
  let cur = 0, i = days.length - 1;
  if (i >= 0 && days[i].count === 0) i--; // hoje ainda sem commit não quebra a sequência
  for (; i >= 0 && days[i].count > 0; i--) cur++;
  return { cur, best };
}

// ---------- 1) órbitas ----------
function renderOrbits({ langs, avatar, recentDays }) {
  const W = 900, H = 380, cx = 450, cy = 190, K = 0.36;
  const r = rng(7);
  const n = langs.length;
  const step = n > 1 ? Math.min(85, 240 / (n - 1)) : 0;
  const maxPct = langs[0]?.pct || 1;
  const title = `Sistema solar de ${login}: o sol é o perfil e as linguagens ${langs.map((l) => l.name).join(", ")} são os planetas`;

  let s = svgOpen(W, H, title);
  s += `<defs>
<radialGradient id="bg" cx="50%" cy="50%" r="75%"><stop offset="0" stop-color="#141b30"/><stop offset="1" stop-color="#050810"/></radialGradient>
<radialGradient id="glow"><stop offset="0" stop-color="#ffb703" stop-opacity=".55"/><stop offset=".55" stop-color="#ff7b00" stop-opacity=".16"/><stop offset="1" stop-color="#ff7b00" stop-opacity="0"/></radialGradient>
<radialGradient id="sun" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#fff3b0"/><stop offset=".5" stop-color="#ffb703"/><stop offset="1" stop-color="#e85d04"/></radialGradient>
<linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe66d"/><stop offset="1" stop-color="#ff7b00"/></linearGradient>
<clipPath id="av"><circle cx="${cx}" cy="${cy}" r="47"/></clipPath>
`;
  langs.forEach((l, i) => {
    const c = l.color;
    s += `<radialGradient id="pl${i}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${mix(c, 255, 0.45)}"/><stop offset=".55" stop-color="${c}"/><stop offset="1" stop-color="${mix(c, 0, 0.55)}"/></radialGradient>\n`;
  });
  s += `</defs>\n<rect width="${W}" height="${H}" rx="16" fill="url(#bg)"/>\n`;

  // estrelas
  for (let i = 0; i < 80; i++) {
    const x = r() * W, y = r() * H, rad = 0.4 + r() * 1.1;
    if (Math.hypot(x - cx, (y - cy) / K) < 120) continue;
    const tw = r() < 0.4;
    s += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rad)}" fill="#fff" opacity="${f1(0.3 + r() * 0.5)}">${
      tw ? `<animate attributeName="opacity" values=".15;.9;.15" dur="${f1(2 + r() * 4)}s" begin="-${f1(r() * 5)}s" repeatCount="indefinite"/>` : ""
    }</circle>\n`;
  }

  // cometas (um por dia com commit na última semana, no máximo 3)
  for (let k = 0; k < Math.min(3, recentDays); k++) {
    const y0 = 30 + r() * 140, dy = 110 + r() * 90, dur = 22 + k * 5;
    const len = Math.hypot(1180, dy), tx = (-110 * 1180) / len, ty = (-110 * dy) / len;
    s += `<g><animateTransform attributeName="transform" type="translate" dur="${dur}s" begin="-${k * 7 + 3}s" repeatCount="indefinite" calcMode="linear" keyTimes="0;.4;1" values="-140,${f1(y0)};1040,${f1(y0 + dy)};1040,${f1(y0 + dy)}"/>
<defs><linearGradient id="ct${k}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${f1(tx)}" y2="${f1(ty)}"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#9ad1ff" stop-opacity="0"/></linearGradient></defs>
<path d="M0,-2.4 L${f1(tx)},${f1(ty)} L0,2.4 Z" fill="url(#ct${k})"/><circle r="7" fill="#fff" opacity=".18"/><circle r="2.6" fill="#fff"/></g>\n`;
  }

  // anéis das órbitas
  langs.forEach((l, i) => {
    const rx = 170 + i * step;
    s += `<ellipse cx="${cx}" cy="${cy}" rx="${f1(rx)}" ry="${f1(rx * K)}" fill="none" stroke="#fff" stroke-opacity=".11" stroke-dasharray="2 7"/>\n`;
  });

  // sol
  s += `<circle cx="${cx}" cy="${cy}" r="92" fill="url(#glow)"><animate attributeName="r" values="84;100;84" dur="6s" repeatCount="indefinite"/></circle>\n`;
  s += avatar
    ? `<circle cx="${cx}" cy="${cy}" r="53" fill="none" stroke="url(#ring)" stroke-width="5"/>\n<image href="${avatar}" xlink:href="${avatar}" x="${cx - 47}" y="${cy - 47}" width="94" height="94" preserveAspectRatio="xMidYMid slice" clip-path="url(#av)"/>\n`
    : `<circle cx="${cx}" cy="${cy}" r="47" fill="url(#sun)"/>\n`;

  // planetas
  langs.forEach((l, i) => {
    const rx = 170 + i * step, ry = rx * K;
    const rad = 9 + 15 * Math.sqrt(l.pct / maxPct);
    const dur = 16 * Math.pow(rx / 170, 1.5);
    const path = `M${f1(cx + rx)},${cy} A${f1(rx)},${f1(ry)} 0 1,1 ${f1(cx - rx)},${cy} A${f1(rx)},${f1(ry)} 0 1,1 ${f1(cx + rx)},${cy}`;
    s += `<g><animateMotion dur="${f1(dur)}s" begin="-${f1(r() * dur)}s" repeatCount="indefinite" path="${path}"/>\n`;
    if (i === 0) s += `<ellipse rx="${f1(rad * 1.75)}" ry="${f1(rad * 0.45)}" fill="none" stroke="${l.color}" stroke-opacity=".55" stroke-width="2" transform="rotate(-18)"/>\n`;
    s += `<circle r="${f1(rad)}" fill="url(#pl${i})"/>\n`;
    if (i === 0) s += `<path d="M${f1(-rad * 1.75 * 0.97)},${f1(rad * 0.1)} A${f1(rad * 1.75)},${f1(rad * 0.45)} 0 0,0 ${f1(rad * 1.75 * 0.97)},${f1(-rad * 0.05)}" fill="none" stroke="${l.color}" stroke-opacity=".55" stroke-width="2" transform="rotate(-18)"/>\n`;
    s += `<text y="${f1(rad + (i === 0 ? 22 : 14))}" text-anchor="middle" font-size="11.5" fill="${INK}" stroke="#050810" stroke-width="3" paint-order="stroke" font-weight="600">${esc(l.name)} ${l.pct}%</text></g>\n`;
  });

  // textos
  s += `<text x="28" y="42" font-size="19" font-weight="700" fill="${INK}">${esc(login)}</text>
<text x="28" y="62" font-size="12.5" fill="${MUTED}">Eu sou o sol. Minhas linguagens são os planetas.</text>
<text x="28" y="${H - 20}" font-size="11" fill="#6e7681">Planetas são linguagens. Cometas são dias com commits nesta semana.</text>
</svg>\n`;
  return s;
}

// ---------- 2) cards dos projetos ----------
function renderCard(p, i) {
  const W = 280, H = 160;
  const api = p.api;
  const lang = api?.primaryLanguage;
  const color = isHex(lang?.color) ? lang.color : FALLBACK_COLORS[i % FALLBACK_COLORS.length];
  const title = p.title || api?.name || p.repo;
  const desc = p.description || api?.description || "";
  const lines = wrap(desc, 38, 3);
  const r = rng(100 + i);
  let s = svgOpen(W, H, `${title}: ${desc}`);
  s += `<defs>
<linearGradient id="cb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#121a30"/><stop offset="1" stop-color="#060912"/></linearGradient>
<radialGradient id="cg"><stop offset="0" stop-color="${color}" stop-opacity=".5"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>
<radialGradient id="cp" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${mix(color, 255, 0.45)}"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${mix(color, 0, 0.55)}"/></radialGradient>
</defs>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="14" fill="url(#cb)" stroke="#233152"/>\n`;
  for (let k = 0; k < 14; k++)
    s += `<circle cx="${f1(r() * W)}" cy="${f1(r() * H)}" r="${f1(0.4 + r() * 0.8)}" fill="#fff" opacity="${f1(0.2 + r() * 0.4)}"/>\n`;
  s += `<circle cx="50" cy="52" r="34" fill="url(#cg)"/>
<circle cx="50" cy="52" r="17" fill="url(#cp)"/>
<g transform="translate(50 52) rotate(-20)"><ellipse rx="33" ry="11" fill="none" stroke="#fff" stroke-opacity=".18" stroke-dasharray="2 4"/>
<circle r="3.6" fill="${INK}"><animateMotion dur="${5 + i}s" begin="-${i * 1.3}s" repeatCount="indefinite" path="M33,0 A33,11 0 1,1 -33,0 A33,11 0 1,1 33,0"/></circle></g>
<text x="96" y="48" font-size="15" font-weight="700" fill="${INK}">${esc(title.length > 20 ? title.slice(0, 19) + "…" : title)}</text>\n`;
  if (lang?.name) s += `<circle cx="101" cy="64" r="4" fill="${color}"/><text x="110" y="68" font-size="11.5" fill="${MUTED}">${esc(lang.name)}</text>\n`;
  if (api?.stargazerCount > 0) s += `<text x="262" y="68" text-anchor="end" font-size="11.5" fill="${MUTED}">★ ${api.stargazerCount}</text>\n`;
  lines.forEach((ln, k) => {
    s += `<text x="20" y="${106 + k * 17}" font-size="12" fill="#a8b3c4">${esc(ln)}</text>\n`;
  });
  return s + `</svg>\n`;
}

// ---------- 3) atividade ----------
function renderLog({ days, total }) {
  const W = 900, H = 230, pitch = 17, x0 = 30, y0 = 64;
  const recent = days.slice(-26 * 7 - 7); // margem; recortamos por semanas abaixo
  // agrupa por semana (domingo a sábado) e fica com as 26 últimas
  const weeks = [];
  for (const d of recent) {
    const dt = new Date(d.date + "T00:00:00Z");
    if (!weeks.length || dt.getUTCDay() === 0) weeks.push([]);
    weeks[weeks.length - 1].push({ ...d, dow: dt.getUTCDay() });
  }
  const last = weeks.slice(-26);
  const max = Math.max(1, ...last.flat().map((d) => d.count));
  const level = (c) => (c === 0 ? 0 : c / max <= 0.25 ? 1 : c / max <= 0.5 ? 2 : c / max <= 0.75 ? 3 : 4);
  const PAL = ["#182036", "#5c3d12", "#b3641a", "#f08a1c", "#ffd23f"];
  const { cur, best } = streaks(days);
  const title = `Atividade de ${login} nas últimas 26 semanas: ${total} contribuições no ano, sequência atual de ${cur} dias`;

  let s = svgOpen(W, H, title);
  s += `<defs><radialGradient id="lbg" cx="30%" cy="40%" r="90%"><stop offset="0" stop-color="#121a30"/><stop offset="1" stop-color="#050810"/></radialGradient>
<filter id="gl" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.4"/></filter></defs>
<rect width="${W}" height="${H}" rx="16" fill="url(#lbg)"/>
<text x="${x0}" y="38" font-size="15" font-weight="700" fill="${INK}">Atividade nas últimas 26 semanas</text>\n`;
  last.forEach((w, ci) => {
    w.forEach((d) => {
      const lv = level(d.count);
      const cx = x0 + 6 + ci * pitch, cy = y0 + 6 + d.dow * pitch;
      const fade = `<animate attributeName="opacity" from="0" to="1" dur=".5s" begin="${f1(ci * 0.045)}s" fill="freeze"/>`;
      if (lv === 4) s += `<circle cx="${cx}" cy="${cy}" r="7" fill="${PAL[4]}" opacity="0" filter="url(#gl)">${fade}</circle>\n`;
      s += `<circle cx="${cx}" cy="${cy}" r="${lv ? 6 : 4.2}" fill="${PAL[lv]}" opacity="0"><title>${d.date}: ${d.count}</title>${fade}</circle>\n`;
    });
  });
  const ly = y0 + 7 * pitch + 22;
  s += `<text x="${x0}" y="${ly + 4}" font-size="11" fill="#6e7681">menos</text>`;
  PAL.forEach((c, i) => (s += `<circle cx="${x0 + 44 + i * 16}" cy="${ly}" r="5" fill="${c}"/>`));
  s += `<text x="${x0 + 44 + 5 * 16 + 4}" y="${ly + 4}" font-size="11" fill="#6e7681">mais</text>\n`;

  const stat = (y, num, label) =>
    `<text x="610" y="${y}" font-size="32" font-weight="700" fill="#ffc233" text-anchor="end">${esc(num)}</text><text x="626" y="${y - 2}" font-size="13" fill="${MUTED}">${esc(label)}</text>\n`;
  s += stat(94, total.toLocaleString("pt-BR"), "contribuições no último ano");
  s += stat(146, String(cur), cur === 1 ? "dia de sequência atual" : "dias de sequência atual");
  s += stat(198, String(best), best === 1 ? "dia na maior sequência" : "dias na maior sequência");
  return s + `</svg>\n`;
}

// ---------- execução ----------
mkdirSync(OUT, { recursive: true });
const data = SAMPLE ? loadSample() : await loadReal();

if (!data.avatar) {
  const local = join(OUT, "avatar.jpg");
  if (existsSync(local)) data.avatar = `data:image/jpeg;base64,${readFileSync(local).toString("base64")}`;
}

const sizeTotal = data.languages.reduce((s, l) => s + l.size, 0) || 1;
const langs = data.languages
  .sort((a, b) => b.size - a.size)
  .slice(0, 6)
  .map((l, i) => ({ name: l.name, color: isHex(l.color) ? l.color : FALLBACK_COLORS[i % FALLBACK_COLORS.length], pct: Math.max(1, Math.round((l.size / sizeTotal) * 100)) }));
if (!langs.length) langs.push({ name: "Em breve", color: FALLBACK_COLORS[0], pct: 100 });

const recentDays = data.days.slice(-7).filter((d) => d.count > 0).length;

writeFileSync(join(OUT, "solar-orbits.svg"), renderOrbits({ langs, avatar: data.avatar, recentDays }));
data.projects.forEach((p, i) => writeFileSync(join(OUT, `solar-card-${i}.svg`), renderCard(p, i)));
writeFileSync(join(OUT, "solar-log.svg"), renderLog({ days: data.days, total: data.total }));
console.log(`OK: ${langs.map((l) => `${l.name} ${l.pct}%`).join(", ")} | ${data.projects.length} cards | ${data.total} contribuições`);
