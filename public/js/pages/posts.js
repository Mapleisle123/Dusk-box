/**
 * 发布页。
 *
 * 三种视图通过地址区分，刷新页面也能回到同一处：
 *   #/posts            时间线（默认）
 *   #/posts/new        写一篇
 *   #/posts/edit/12    编辑
 *   #/posts/12         详情
 */

import { api, fileUrl } from '../api.js';
import {
  esc,
  todayISO,
  dateParts,
  formatDateCN,
  relativeDay,
  emptyState,
  confirmDialog,
  toastError,
  toastSuccess,
  openLightbox,
  icons,
} from '../ui.js';
import { renderMarkdown, stripMarkdown } from '../markdown.js';
import { navigate, refresh } from '../router.js';

/** 时间线筛选状态（页面内保持） */
const filter = { q: '', type: 'all' };

// ===========================================================================
// 时间线
// ===========================================================================

function postCardHtml(post) {
  const p = dateParts(post.postDate);
  const thumbs = post.media.slice(0, 3);
  return `
    <div class="post-card" data-open="${post.id}">
      <div class="post-date-col">
        <div class="post-date-day">${p.day}</div>
        <div class="post-date-ym">${p.ym}</div>
        <div class="post-date-wd">${p.weekday}</div>
      </div>
      <div class="post-body">
        <div class="post-title">${esc(post.title || '无标题')}</div>
        <div class="post-excerpt">${esc(post.excerpt || stripMarkdown(post.content, 70) || '（没有正文）')}</div>
        <div class="post-meta">
          ${post.mediaCount ? `<span class="tag tag-primary">图片 ${post.mediaCount}</span>` : '<span class="tag">纯文字</span>'}
          <span class="tag">${esc(relativeDay(post.postDate))}</span>
        </div>
      </div>
      ${
        thumbs.length
          ? `<div class="post-thumbs">
               ${thumbs
                 .map(
                   (m) => `<div class="photo-thumb"><img src="${fileUrl(m.filePath)}" alt="" loading="lazy"></div>`,
                 )
                 .join('')}
             </div>`
          : ''
      }
    </div>`;
}

function timelineHtml(list) {
  if (!list.items.length) {
    const filtered = filter.q || filter.type !== 'all';
    return emptyState({
      title: filtered ? '没有找到符合条件的内容' : '还没有发布过内容',
      desc: filtered ? '换个关键词或筛选条件试试。' : '写下今天的一件小事，以后翻起来会很有意思。',
      icon: 'file',
      action: filtered
        ? '<button class="btn" data-clear-filter type="button">清除筛选</button>'
        : '<button class="btn btn-primary" data-nav="posts/new" type="button">写第一篇</button>',
    });
  }
  return `<div class="timeline">${list.items.map(postCardHtml).join('')}</div>`;
}

function filterBarHtml() {
  const seg = (value, label) =>
    `<button type="button" data-type="${value}" class="${filter.type === value ? 'active' : ''}">${label}</button>`;
  return `
    <div class="filter-bar">
      <div class="seg" id="type-seg">
        ${seg('all', '全部')}${seg('image', '含图片')}${seg('text', '纯文字')}
      </div>
      <input class="input search-input" id="post-search" type="search"
             placeholder="搜索标题或正文…" value="${esc(filter.q)}" autocomplete="off">
      <span class="spacer" style="flex:1"></span>
      <button class="btn btn-primary" data-nav="posts/new" type="button">${icons.plus}<span>写一篇</span></button>
    </div>`;
}

function timelinePage(list) {
  return `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>发布</h1>
          <div class="sub">记录生活 · 每篇都会以「日期 + 标题」为文件名保存到电脑</div>
        </div>
      </div>
      ${filterBarHtml()}
      <div id="timeline-body">${timelineHtml(list)}</div>
    </div>`;
}

function mountTimeline(root) {
  const body = root.querySelector('#timeline-body');

  const reload = async () => {
    const list = await api.listPosts({ q: filter.q, type: filter.type, limit: 200 });
    body.innerHTML = timelineHtml(list);
    wireCards(body);
  };

  // 类型筛选
  root.querySelectorAll('#type-seg button').forEach((btn) => {
    btn.addEventListener('click', () => {
      filter.type = btn.dataset.type;
      root.querySelectorAll('#type-seg button').forEach((b) => b.classList.toggle('active', b === btn));
      reload();
    });
  });

  // 搜索（输入防抖）
  const search = root.querySelector('#post-search');
  let timer = null;
  search?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filter.q = search.value.trim();
      reload();
    }, 260);
  });

  root.querySelector('[data-clear-filter]')?.addEventListener('click', () => {
    filter.q = '';
    filter.type = 'all';
    refresh();
  });

  wireCards(body);
}

/** 给时间线卡片挂上点击事件 */
function wireCards(container) {
  container.querySelectorAll('[data-open]').forEach((card) => {
    card.addEventListener('click', () => navigate(`posts/${card.dataset.open}`));
  });
}

// ===========================================================================
// 详情
// ===========================================================================

function detailHtml(post) {
  const photos = post.media.map((m) => ({ url: fileUrl(m.filePath), caption: m.originalName }));
  return `
    <div class="page">
      <div class="page-head">
        <div>
          <div class="sub" style="margin-bottom:4px">
             <span class="section-link" data-nav="posts">← 返回时间线</span>
          </div>
          <h1>${esc(post.title || '无标题')}</h1>
          <div class="sub">${esc(formatDateCN(post.postDate))} · 创建于 ${esc(post.createdAt)}</div>
        </div>
        <div class="row-tight">
          <button class="btn" data-edit="${post.id}" type="button">${icons.edit}<span>编辑</span></button>
          <button class="btn btn-danger" data-delete="${post.id}" type="button">${icons.trash}<span>删除</span></button>
        </div>
      </div>

      <div class="card">
        <div class="md-body">${renderMarkdown(post.content) || '<p class="muted">（没有正文）</p>'}</div>
        ${
          photos.length
            ? `<div class="divider"></div>
               <div class="section-title mb-3">附图 <span class="count">${photos.length} 张</span></div>
               <div class="photo-wall">
                 ${post.media
                   .map(
                     (m, i) => `
                   <div class="photo-cell" data-photo="${i}">
                     <img src="${fileUrl(m.filePath)}" alt="${esc(m.originalName)}" loading="lazy">
                   </div>`,
                   )
                   .join('')}
               </div>`
            : ''
        }
      </div>

      <div class="card mt-3">
        <div class="kv"><span class="k">保存位置</span><span class="v mono">${esc(post.filePath || '—')}</span></div>
      </div>
    </div>`;
}

function mountDetail(root, post) {
  const photos = post.media.map((m) => ({ url: fileUrl(m.filePath), caption: m.originalName }));
  root.querySelectorAll('[data-photo]').forEach((cell) => {
    cell.addEventListener('click', () => openLightbox(photos, Number(cell.dataset.photo)));
  });

  root.querySelector('[data-edit]')?.addEventListener('click', () => navigate(`posts/edit/${post.id}`));

  root.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: '删除这篇内容',
      message: `确定要删除「${esc(post.title || '无标题')}」吗？<br>磁盘上的 <span class="mono">${esc(post.filePath || '')}</span> 与它的图片都会被删除，无法恢复。`,
      confirmText: '删除',
      danger: true,
    });
    if (!yes) return;
    try {
      await api.deletePost(post.id);
      toastSuccess('已删除');
      navigate('posts');
    } catch (err) {
      toastError(err.message);
    }
  });
}

// ===========================================================================
// 编辑器
// ===========================================================================

function editorHtml({ post, mode }) {
  const isEdit = mode === 'edit';
  return `
    <div class="page">
      <div class="page-head">
        <div>
          <div class="sub" style="margin-bottom:4px">
            <span class="section-link" data-nav="${isEdit ? `posts/${post.id}` : 'posts'}">← 返回</span>
          </div>
          <h1>${isEdit ? '编辑' : '写一篇'}</h1>
          <div class="sub">正文支持 Markdown：<span class="mono">**粗体**</span>、<span class="mono"># 标题</span>、<span class="mono">![](图片)</span></div>
        </div>
      </div>

      <div class="card">
        <div class="field">
          <label for="ed-title">标题</label>
          <input class="input" id="ed-title" type="text" placeholder="给今天起个名字"
                 value="${esc(post.title || '')}" autocomplete="off">
        </div>

        <div class="field">
          <label for="ed-date">日期</label>
          <input class="input" id="ed-date" type="date" value="${esc(post.postDate || todayISO())}" style="max-width:200px">
        </div>

        <div class="field">
          <label for="ed-content">正文</label>
          <textarea class="textarea" id="ed-content" placeholder="今天发生了什么…">${esc(post.content || '')}</textarea>
        </div>

        <div class="field">
          <label>图片</label>
          <div class="dropzone" id="ed-drop">
            拖入图片，或点击选择文件（支持一次选多张）
            <input type="file" id="ed-files" accept="image/*" multiple hidden>
          </div>
          <div class="preview-grid" id="ed-preview"></div>
        </div>

        <div class="editor-actions">
          <button class="btn" data-act="cancel" type="button">取消</button>
          <button class="btn btn-primary" data-act="save" type="button">${isEdit ? '保存修改' : '发布'}</button>
        </div>
      </div>
    </div>`;
}

function mountEditor(root, { post, mode }) {
  const dropzone = root.querySelector('#ed-drop');
  const fileInput = root.querySelector('#ed-files');
  const preview = root.querySelector('#ed-preview');

  /** 待上传的新文件 */
  let newFiles = [];
  /** 编辑时保留的已有图片 id */
  let keepIds = (post.media || []).map((m) => m.id);

  const renderPreview = () => {
    const existing = (post.media || []).filter((m) => keepIds.includes(m.id));
    preview.innerHTML = [
      ...existing.map(
        (m) => `
        <div class="preview-item">
          <img src="${fileUrl(m.filePath)}" alt="${esc(m.originalName)}">
          <button class="preview-remove" type="button" data-drop-existing="${m.id}" title="移除">×</button>
        </div>`,
      ),
      ...newFiles.map(
        (f, i) => `
        <div class="preview-item">
          <img src="${f.preview}" alt="${esc(f.file.name)}">
          <button class="preview-remove" type="button" data-drop-new="${i}" title="移除">×</button>
        </div>`,
      ),
    ].join('');

    preview.querySelectorAll('[data-drop-existing]').forEach((btn) => {
      btn.addEventListener('click', () => {
        keepIds = keepIds.filter((id) => id !== Number(btn.dataset.dropExisting));
        renderPreview();
      });
    });
    preview.querySelectorAll('[data-drop-new]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const removed = newFiles.splice(Number(btn.dataset.dropNew), 1)[0];
        if (removed) URL.revokeObjectURL(removed.preview);
        renderPreview();
      });
    });
  };

  const addFiles = (fileList) => {
    for (const file of fileList) {
      if (!file.type.startsWith('image/')) {
        toastError(`「${file.name}」不是图片，已跳过`);
        continue;
      }
      newFiles.push({ file, preview: URL.createObjectURL(file) });
    }
    renderPreview();
  };

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });

  // 支持直接往输入框里粘贴图片
  root.addEventListener('paste', (e) => {
    const items = [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith('image/'));
    if (!items.length) return;
    e.preventDefault();
    addFiles(items.map((i) => i.getAsFile()).filter(Boolean));
  });

  renderPreview();

  const save = async () => {
    const title = root.querySelector('#ed-title').value.trim();
    const content = root.querySelector('#ed-content').value;
    const postDate = root.querySelector('#ed-date').value || todayISO();

    if (!title && !content.trim()) {
      toastError('标题和正文不能同时为空');
      return;
    }

    const form = new FormData();
    form.append('title', title);
    form.append('content', content);
    form.append('postDate', postDate);
    if (mode === 'edit') form.append('keepMediaIds', JSON.stringify(keepIds));
    for (const { file } of newFiles) form.append('files', file, file.name);

    try {
      const res =
        mode === 'edit'
          ? await api.updatePost(post.id, form)
          : await api.createPost(form);
      newFiles.forEach((f) => URL.revokeObjectURL(f.preview));
      toastSuccess(mode === 'edit' ? '已保存修改' : '已发布，文件已保存到电脑');
      // 告诉页面右侧的吉祥物"刚记了一笔"（它只冒一次气泡，不打扰）
      if (mode !== 'edit') window.dispatchEvent(new CustomEvent('duskbox:published'));
      navigate(mode === 'edit' ? `posts/${post.id}` : 'posts');
      void res;
    } catch (err) {
      toastError(err.message);
    }
  };

  root.querySelector('[data-act="save"]').addEventListener('click', save);
  root.querySelector('[data-act="cancel"]').addEventListener('click', () => {
    newFiles.forEach((f) => URL.revokeObjectURL(f.preview));
    navigate('posts');
  });

  // Ctrl/Cmd + S 保存
  root.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });
}

// ===========================================================================
// 入口
// ===========================================================================

export async function pagePosts({ route }) {
  const [first, second] = route.params;

  // 编辑器
  if (first === 'new') {
    return {
      html: editorHtml({ post: {}, mode: 'new' }),
      mount: (root) => mountEditor(root, { post: {}, mode: 'new' }),
    };
  }
  if (first === 'edit' && second) {
    const post = await api.getPost(second);
    return {
      html: editorHtml({ post, mode: 'edit' }),
      mount: (root) => mountEditor(root, { post, mode: 'edit' }),
    };
  }

  // 详情
  if (first) {
    const post = await api.getPost(first);
    return {
      html: detailHtml(post),
      mount: (root) => mountDetail(root, post),
    };
  }

  // 时间线
  const list = await api.listPosts({ q: filter.q, type: filter.type, limit: 200 });
  return {
    html: timelinePage(list),
    mount: (root) => mountTimeline(root),
  };
}
