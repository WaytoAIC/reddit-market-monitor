#!/usr/bin/env node

/**
 * md_to_html.mjs
 *
 * Zero-dependency Markdown -> standalone styled HTML, tuned for
 * reddit-market-monitor daily/weekly reports (table-first, Chinese-friendly).
 *
 * Handles: #..###### headings, GFM pipe tables, ordered/unordered lists,
 * **bold**, `code`, [text](url) links, --- horizontal rules, > blockquotes,
 * and blank-line-separated paragraphs.
 *
 * Usage:
 *   node md_to_html.mjs <input.md> [output.html]
 * Default output: same path with .html extension.
 */

import fs from 'fs';

const inPath = process.argv[2];
if (!inPath) {
  process.stderr.write('usage: node md_to_html.mjs <input.md> [output.html]\n');
  process.exit(1);
}
const outPath = process.argv[3] || inPath.replace(/\.md$/i, '') + '.html';

const md = fs.readFileSync(inPath, 'utf8');
const lines = md.replace(/\r\n?/g, '\n').split('\n');

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Inline formatting on already-escaped text is unsafe for links, so do links
// on raw text via a placeholder-free ordered pass.
function inline(raw) {
  let t = escapeHtml(raw);
  // inline code first (protect contents)
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // bold
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // links [text](http...)
  t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    (_, text, url) => `<a href="${url}" target="_blank" rel="noopener">${text}</a>`);
  // autolink bare URLs not already inside an href/anchor
  t = t.replace(/(^|[^"=>])(https?:\/\/[^\s<)]+)/g,
    (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
  return t;
}

function prioClass(cellText) {
  const t = cellText.trim();
  if (/^P1$/i.test(t)) return ' class="prio prio-p1"';
  if (/^P2$/i.test(t)) return ' class="prio prio-p2"';
  if (/^P3$/i.test(t)) return ' class="prio prio-p3"';
  return '';
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  // split on unescaped pipes
  return s.split('|').map((c) => c.trim());
}

function isSepRow(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

const out = [];
let i = 0;
let title = null;

while (i < lines.length) {
  const line = lines[i];

  // blank
  if (/^\s*$/.test(line)) { i++; continue; }

  // heading
  const h = line.match(/^(#{1,6})\s+(.*)$/);
  if (h) {
    const level = h[1].length;
    const text = h[2].trim();
    if (level === 1 && !title) title = text;
    out.push(`<h${level}>${inline(text)}</h${level}>`);
    i++;
    continue;
  }

  // horizontal rule (standalone), not a table separator
  if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

  // table: current line has a pipe and next line is a separator row
  if (line.includes('|') && i + 1 < lines.length && isSepRow(lines[i + 1])) {
    const header = splitRow(line);
    i += 2; // skip header + separator
    const rows = [];
    while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
      rows.push(splitRow(lines[i]));
      i++;
    }
    let t = '<div class="table-wrap"><table>';
    t += '<thead><tr>' + header.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead>';
    t += '<tbody>';
    for (const r of rows) {
      t += '<tr>' + header.map((_, ci) => {
        const cell = r[ci] != null ? r[ci] : '';
        return `<td${prioClass(cell)}>${inline(cell)}</td>`;
      }).join('') + '</tr>';
    }
    t += '</tbody></table></div>';
    out.push(t);
    continue;
  }

  // blockquote
  if (/^\s*>\s?/.test(line)) {
    const buf = [];
    while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
      buf.push(lines[i].replace(/^\s*>\s?/, ''));
      i++;
    }
    out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
    continue;
  }

  // unordered list
  if (/^\s*[-*]\s+/.test(line)) {
    const buf = [];
    while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
      buf.push(lines[i].replace(/^\s*[-*]\s+/, ''));
      i++;
    }
    out.push('<ul>' + buf.map((x) => `<li>${inline(x)}</li>`).join('') + '</ul>');
    continue;
  }

  // ordered list
  if (/^\s*\d+\.\s+/.test(line)) {
    const buf = [];
    while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
      buf.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
      i++;
    }
    out.push('<ol>' + buf.map((x) => `<li>${inline(x)}</li>`).join('') + '</ol>');
    continue;
  }

  // paragraph (accumulate until blank / block)
  const buf = [line];
  i++;
  while (i < lines.length && !/^\s*$/.test(lines[i]) &&
         !/^(#{1,6})\s/.test(lines[i]) &&
         !/^\s*[-*]\s+/.test(lines[i]) &&
         !/^\s*\d+\.\s+/.test(lines[i]) &&
         !/^\s*>\s?/.test(lines[i]) &&
         !(lines[i].includes('|') && i + 1 < lines.length && isSepRow(lines[i + 1]))) {
    buf.push(lines[i]);
    i++;
  }
  out.push(`<p>${inline(buf.join(' '))}</p>`);
}

const docTitle = escapeHtml(title || 'Reddit Market Monitor Report');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${docTitle}</title>
<style>
  :root { --fg:#1f2328; --muted:#656d76; --border:#d0d7de; --bg:#ffffff; --soft:#f6f8fa; --accent:#0969da; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    line-height:1.65; }
  .container { max-width:1180px; margin:0 auto; padding:32px 24px 80px; }
  h1 { font-size:1.9rem; border-bottom:2px solid var(--border); padding-bottom:.4em; margin-top:0; }
  h2 { font-size:1.4rem; border-bottom:1px solid var(--border); padding-bottom:.3em; margin-top:2em; }
  h3 { font-size:1.15rem; margin-top:1.6em; }
  h4 { font-size:1rem; color:var(--muted); }
  a { color:var(--accent); text-decoration:none; word-break:break-all; }
  a:hover { text-decoration:underline; }
  code { background:var(--soft); padding:.15em .4em; border-radius:5px; font-size:.86em;
    font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  hr { border:0; border-top:1px solid var(--border); margin:2em 0; }
  blockquote { margin:1em 0; padding:.4em 1em; color:var(--muted); border-left:4px solid var(--border); background:var(--soft); border-radius:0 6px 6px 0; }
  ul,ol { padding-left:1.4em; }
  li { margin:.25em 0; }
  .table-wrap { overflow-x:auto; margin:1em 0; border:1px solid var(--border); border-radius:8px; }
  table { border-collapse:collapse; width:100%; font-size:.86rem; }
  th,td { border-bottom:1px solid var(--border); border-right:1px solid var(--border); padding:8px 11px; text-align:left; vertical-align:top; }
  th:last-child,td:last-child { border-right:0; }
  thead th { background:var(--soft); position:sticky; top:0; font-weight:600; white-space:nowrap; }
  tbody tr:nth-child(even) { background:#fbfcfd; }
  tbody tr:hover { background:#f0f6ff; }
  .prio { font-weight:700; text-align:center; white-space:nowrap; }
  .prio-p1 { color:#b3261e; }
  .prio-p2 { color:#a15c00; }
  .prio-p3 { color:var(--muted); }
  .footer { margin-top:48px; padding-top:16px; border-top:1px solid var(--border); color:var(--muted); font-size:.82rem; }
</style>
</head>
<body>
<div class="container">
${out.join('\n')}
<div class="footer">由 reddit-market-monitor skill 生成 · Way to AIC · <a href="https://github.com/WaytoAIC/reddit-market-monitor" target="_blank" rel="noopener">github.com/WaytoAIC/reddit-market-monitor</a></div>
</div>
</body>
</html>
`;

fs.writeFileSync(outPath, html, 'utf8');
process.stdout.write(JSON.stringify({ ok: true, input: inPath, output: outPath, bytes: Buffer.byteLength(html) }) + '\n');
