// Claw Lite · 极简 Markdown 渲染（Agent B）
// 安全优先：先把整体文本做 HTML 转义，再做语法转换；输出不含任何事件属性（on*）。
// 支持：```围栏代码块、`行内代码`、**粗体**、*斜体*、#/##/### 标题、- 与 1. 列表
//（嵌套一层）、> 引用、[文本](http/https) 链接、--- 分隔线、| a | b | 简单表格。

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* 行内转换：先摘出行内代码（避免其内容被再加粗/斜体），再粗体→斜体→链接，最后还原 */
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(`<code class="md-inline-code">${c}</code>`);
    return `\u0000C${codes.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\u0000C(\d+)\u0000/g, (_, n) => codes[Number(n)] ?? "");
  return s;
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isSepRow(line) {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function buildList(items, ordered) {
  let html = ordered ? "<ol>" : "<ul>";
  let nested = false;
  for (const it of items) {
    const isNested = it.indent >= 2; // 嵌套一层：缩进 ≥ 2 空格
    if (isNested && !nested) {
      html += "<ul>";
      nested = true;
    }
    if (!isNested && nested) {
      html += "</ul>";
      nested = false;
    }
    html += `<li>${inline(it.text)}</li>`;
  }
  if (nested) html += "</ul>";
  return html + (ordered ? "</ol>" : "</ul>");
}

export function renderMarkdown(text) {
  if (text === null || text === undefined) return "";
  // 1) 整体 HTML 转义（安全第一，此后所有语法字符均为字面量）
  let src = escapeHtml(String(text));

  // 2) 提取围栏代码块为占位符（含未闭合到文末的情况）
  const codeBlocks = [];
  src = src.replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, (m) => {
    const firstNl = m.indexOf("\n");
    let body = m.slice(firstNl + 1).replace(/```$/, "").replace(/\n$/, "");
    codeBlocks.push(`<pre class="md-code-block"><code>${body}</code></pre>`);
    return `\u0000B${codeBlocks.length - 1}\u0000`;
  });

  // 3) 逐行做块级解析
  const lines = src.split("\n");
  const out = [];
  let para = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inline).join("<br>")}</p>`);
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    if (!t) {
      flushPara();
      continue;
    }

    // 代码块占位行
    if (/^\u0000B\d+\u0000$/.test(t)) {
      flushPara();
      out.push(t);
      continue;
    }

    // 标题 #/##/###
    const h = t.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      flushPara();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }

    // 分隔线 ---
    if (/^-{3,}$/.test(t)) {
      flushPara();
      out.push("<hr>");
      continue;
    }

    // 表格：当前行 ≥2 个单元格且下一行是 |---|---| 分隔行
    if (t.includes("|")) {
      const header = splitRow(t);
      if (
        header.length >= 2 &&
        i + 1 < lines.length &&
        isSepRow(lines[i + 1]) &&
        splitRow(lines[i + 1]).length === header.length
      ) {
        flushPara();
        const ths = header.map((c) => `<th>${inline(c)}</th>`).join("");
        let rows = "";
        let j = i + 2;
        while (j < lines.length && lines[j].trim().includes("|")) {
          const cells = splitRow(lines[j]);
          if (cells.length !== header.length) break;
          rows += `<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`;
          j++;
        }
        out.push(`<table class="md-table"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`);
        i = j - 1;
        continue;
      }
    }

    // 引用（连续 > 行；因整体已转义，源文本中的 ">" 此处为 "&gt;"）
    if (t.startsWith("&gt;")) {
      flushPara();
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith("&gt;")) {
        buf.push(lines[i].trim().replace(/^&gt;\s?/, ""));
        i++;
      }
      i--;
      out.push(`<blockquote class="md-quote">${buf.map(inline).join("<br>")}</blockquote>`);
      continue;
    }

    // 无序列表（嵌套一层：缩进 ≥ 2 空格的 "- "）
    if (/^\s*-\s+/.test(line)) {
      flushPara();
      const items = [];
      let j = i;
      while (j < lines.length) {
        const m = lines[j].match(/^(\s*)-\s+(.*)$/);
        if (!m) break;
        items.push({ indent: m[1].length, text: m[2] });
        j++;
      }
      i = j - 1;
      out.push(buildList(items, false));
      continue;
    }

    // 有序列表 "1. "
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items = [];
      let j = i;
      while (j < lines.length) {
        const m = lines[j].match(/^(\s*)\d+\.\s+(.*)$/);
        if (!m) break;
        items.push({ indent: m[1].length, text: m[2] });
        j++;
      }
      i = j - 1;
      out.push(buildList(items, true));
      continue;
    }

    // 普通段落
    para.push(t);
  }
  flushPara();

  // 4) 还原代码块占位符
  return (
    out
      .join("\n")
      .replace(/\u0000B(\d+)\u0000/g, (_, n) => codeBlocks[Number(n)] ?? "")
  );
}
