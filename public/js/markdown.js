/**
 * 轻量 Markdown 渲染。
 *
 * 为什么不直接输出 HTML 而用 Markdown：Markdown 存成 .md 文件后，
 * 用户用记事本打开就能读、能改；换成 HTML 存出来的是一堆标签。
 *
 * 只实现日记场景真正会用到的语法：标题、粗体斜体、行内代码、
 * 代码块、引用、有序/无序列表、分隔线、链接、图片。
 */

import { esc } from './ui.js';

/** 把图片/链接的相对路径解析成可访问的地址 */
function resolveSrc(src) {
  const value = String(src || '').trim();
  if (!value) return '';
  if (/^(https?:|data:|\/)/i.test(value)) return value;
  return `/files/${value
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')}`;
}

/** 行内语法 */
function inline(text) {
  let out = esc(text);

  // 图片要在链接之前处理，否则 ![a](b) 会被链接规则先吃掉
  out = out.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_m, alt, src) => `<img src="${resolveSrc(src)}" alt="${alt}" loading="lazy">`,
  );
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, label, href) => `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');

  return out;
}

/**
 * 渲染 Markdown 为 HTML。
 * @param {string} source
 */
export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let paragraph = [];
  let i = 0;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inline(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`);
    paragraph = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (/^\s*```/.test(line)) {
      flushParagraph();
      const buf = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // 跳过结束的 ```
      html.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph();
      html.push('<hr>');
      i += 1;
      continue;
    }

    // 标题
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      html.push(`<blockquote>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</blockquote>`);
      continue;
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph();
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i += 1;
      }
      html.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
      continue;
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushParagraph();
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i += 1;
      }
      html.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`);
      continue;
    }

    // 空行
    if (!line.trim()) {
      flushParagraph();
      i += 1;
      continue;
    }

    paragraph.push(line);
    i += 1;
  }

  flushParagraph();
  return html.join('\n');
}

/** 去掉 Markdown 语法，用于生成摘要 */
export function stripMarkdown(source, maxLen = 80) {
  const flat = String(source ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > maxLen ? `${flat.slice(0, maxLen)}…` : flat;
}
