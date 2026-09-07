// 复核验证：markdown.js XSS 向量 + 功能
import { pathToFileURL } from "node:url";
const { renderMarkdown } = await import(
  pathToFileURL("/Users/wbtrex/AI助手/node/trexwb/clawLite/src/core/markdown.js").href
);

let pass = 0;
let fail = 0;
function check(label, cond, extra) {
  if (cond) {
    pass++;
    console.log("PASS", label);
  } else {
    fail++;
    console.log("FAIL", label, extra === undefined ? "" : "=>", JSON.stringify(extra));
  }
}

const ALLOWED_TAGS = new Set([
  "p", "br", "strong", "em", "a", "h1", "h2", "h3", "hr",
  "ul", "ol", "li", "blockquote", "table", "thead", "tbody", "tr", "th", "td",
  "pre", "code",
]);

function tagsOf(html) {
  const out = [];
  for (const m of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)) out.push(m[1].toLowerCase());
  return out;
}
function onlyAllowedTags(html) {
  return tagsOf(html).every((t) => ALLOWED_TAGS.has(t));
}
function attrEvents(html) {
  // 输出中不得出现未转义的事件属性（on*=）
  return /[\s"']on[a-z]+\s*=/i.test(html);
}

/* ---- XSS 向量 ---- */
const vectors = [
  ['<img src=x onerror=alert(1)>', "img 标签被转义"],
  ['<script>alert(1)</script>', "script 被转义"],
  ['<svg onload=alert(1)>', "svg onload 被转义"],
  ['[click](javascript:alert(1))', "javascript: 不生成链接"],
  ['[click](JAVASCRIPT:alert(1))', "大写 javascript: 不生成链接"],
  ['[click](data:text/html;base64,PHNjcmlwdD4=)', "data: 不生成链接"],
  ['[x](https://e.com/?a=1&b=2"onmouseover="alert(1))', "URL 中引号无法逃逸属性"],
  ["[x](https://e.com/'onmouseover='alert(1))", "URL 中单引号无法逃逸属性"],
  ['`<script>alert(1)</script>`', "行内代码转义"],
  ['```\n<script>alert(1)</script>\n```', "围栏代码转义"],
  ['> 引用 <b>加粗</b>', "引用内转义"],
  ['| <script> | x |\n| --- | --- |\n| a | b |', "表格内转义"],
  ['# 标题 <img src=x onerror=alert(1)>', "标题内转义"],
  ['- <script>1</script>\n  - <script>2</script>', "列表内转义"],
  ['**<script>x</script>**', "粗体内转义"],
  ['*<img src=x onerror=alert(1)>*', "斜体内转义"],
  ['1. [x](javascript:void(0))', "有序列表内 javascript: 链接"],
  ['[a](https://ok.com) [b](javascript:alert(1))', "混合：正常链接保留，js: 不生成"],
];

for (const [src, label] of vectors) {
  const html = renderMarkdown(src);
  check(label, onlyAllowedTags(html) && !attrEvents(html) && !/<script/i.test(html) && !/<img/i.test(html), html);
}

/* ---- 链接属性 ---- */
{
  const html = renderMarkdown("[a](https://example.com/x?y=1)");
  check("链接带 target=_blank rel=noopener", html.includes('target="_blank"') && html.includes('rel="noopener"'), html);
  check("http(s) 之外不生成 <a", !renderMarkdown("[a](ftp://x.com)").includes("<a "), renderMarkdown("[a](ftp://x.com)"));
}

/* ---- 功能抽样 ---- */
{
  check("标题三级", renderMarkdown("# a\n## b\n### c").includes("<h1>a</h1>") && renderMarkdown("## b").includes("<h2>"));
  const lst = renderMarkdown("- a\n- b\n  - b1\n- c");
  check("嵌套列表", lst.includes("<ul>") && lst.includes("<li>b1</li>"), lst);
  const ol = renderMarkdown("1. a\n2. b");
  check("有序列表", ol.includes("<ol>") && ol.includes("<li>b</li>"), ol);
  const tbl = renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |");
  check("表格", tbl.includes('class="md-table"') && tbl.includes("<td>2</td>"), tbl);
  check("引用", renderMarkdown("> hi").includes('class="md-quote"'));
  check("分隔线", renderMarkdown("---").includes("<hr>"));
  const cb = renderMarkdown("```js\nconst a = \"<b>\";\n```");
  check("围栏代码块含类名且转义", cb.includes('class="md-code-block"') && cb.includes("&lt;b&gt;") && !cb.includes("<b>"), cb);
  check("粗斜体", renderMarkdown("**b** *i*").includes("<strong>b</strong>") && renderMarkdown("*i*").includes("<em>i</em>"));
  check("空输入", renderMarkdown("") === "" && renderMarkdown(null) === "");
  const long = "x".repeat(200000) + "\n\n<script>";
  check("超长内容不抛错且转义", renderMarkdown(long).includes("&lt;script&gt;"));
}

console.log(`\n== markdown.js: ${pass} pass, ${fail} fail ==`);
process.exit(fail ? 1 : 0);
