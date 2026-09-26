/**
 * 相册页。
 *
 * #/albums        相册集网格
 * #/albums/12     某个相册集内的照片
 *
 * 磁盘上：一个相册集就是一个文件夹，照片原文件直接躺在里面。
 */

import { api, fileUrl } from '../api.js';
import {
  esc,
  emptyState,
  confirmDialog,
  toastError,
  toastSuccess,
  openLightbox,
  openModal,
  icons,
  formatDateCN,
} from '../ui.js';
import { navigate, refresh } from '../router.js';

// ===========================================================================
// 相册集网格
// ===========================================================================

function albumCardHtml(album) {
  return `
    <div class="album-card" data-album="${album.id}">
      <div class="album-cover">
        ${
          album.coverPath
            ? `<img src="${fileUrl(album.coverPath)}" alt="${esc(album.name)}" loading="lazy">`
            : icons.album
        }
      </div>
      <div class="album-info">
        <div class="album-name">${esc(album.name)}</div>
        <div class="album-count">${album.photoCount} 张照片</div>
      </div>
    </div>`;
}

function albumsPageHtml(albums) {
  return `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>相册</h1>
          <div class="sub">把喜欢的图片收进自己的相册集 · 每个相册集就是电脑上的一个文件夹</div>
        </div>
        <button class="btn btn-primary" data-new-album type="button">${icons.plus}<span>新建相册集</span></button>
      </div>
      ${
        albums.length
          ? `<div class="album-grid">${albums.map(albumCardHtml).join('')}</div>`
          : emptyState({
              title: '还没有相册集',
              desc: '给喜欢的图片分个类，比如「秋天」「喜欢的画」「旅行」。',
              icon: 'album',
              action: '<button class="btn btn-primary" data-new-album type="button">新建第一个相册集</button>',
            })
      }
    </div>`;
}

/** 新建 / 重命名相册集的弹窗 */
function albumEditorDialog({ album = null, onSaved } = {}) {
  const editing = !!album;
  openModal({
    title: editing ? '重命名相册集' : '新建相册集',
    size: 'narrow',
    body: `
      <div class="field">
        <label for="album-name">相册集名称</label>
        <input class="input" id="album-name" type="text" placeholder="例如：秋天"
               value="${esc(album?.name || '')}" autocomplete="off">
        ${editing ? '<span class="hint">改名会同时重命名电脑上的文件夹，里面的照片会一起搬过去。</span>' : ''}
      </div>`,
    footer: `
      <button class="btn" data-act="cancel" type="button">取消</button>
      <button class="btn btn-primary" data-act="save" type="button">${editing ? '保存' : '创建'}</button>`,
    onMount: ({ body, foot, close }) => {
      const input = body.querySelector('#album-name');
      const submit = async () => {
        const name = input.value.trim();
        if (!name) {
          toastError('请填写相册集名称');
          return;
        }
        try {
          const saved = editing
            ? await api.updateAlbum(album.id, { name })
            : await api.createAlbum({ name });
          close();
          toastSuccess(editing ? '已重命名' : '相册集已创建');
          if (onSaved) onSaved(saved);
          else refresh();
        } catch (err) {
          toastError(err.message);
        }
      };
      foot.querySelector('[data-act="cancel"]').addEventListener('click', close);
      foot.querySelector('[data-act="save"]').addEventListener('click', submit);
      body.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
    },
  });
}

function mountAlbums(root) {
  root.querySelectorAll('[data-new-album]').forEach((el) => {
    el.addEventListener('click', () => albumEditorDialog({}));
  });
  root.querySelectorAll('[data-album]').forEach((card) => {
    card.addEventListener('click', () => navigate(`albums/${card.dataset.album}`));
  });
}

// ===========================================================================
// 相册集详情
// ===========================================================================

function albumDetailHtml(album) {
  return `
    <div class="page">
      <div class="page-head">
        <div>
          <div class="sub" style="margin-bottom:4px">
            <span class="section-link" data-nav="albums">← 返回相册</span>
          </div>
          <h1>${esc(album.name)}</h1>
          <div class="sub">${album.photoCount} 张照片 · 创建于 ${esc(album.createdAt)}</div>
        </div>
        <div class="row-tight">
          <button class="btn" data-upload type="button">${icons.camera}<span>添加照片</span></button>
          <button class="btn btn-icon" data-rename type="button" title="重命名">${icons.edit}</button>
          <button class="btn btn-icon btn-danger" data-delete-album type="button" title="删除相册集">${icons.trash}</button>
        </div>
      </div>

      <input type="file" id="album-files" accept="image/*" multiple hidden>

      ${
        album.photos.length
          ? `<div class="photo-wall">
               ${album.photos
                 .map((p, i) => {
                   const isCover = album.coverPath === p.filePath;
                   return `
                   <div class="photo-cell" data-photo="${i}">
                     <img src="${fileUrl(p.filePath)}" alt="${esc(p.originalName)}" loading="lazy">
                     <div class="photo-actions">
                       ${isCover ? '' : `<button type="button" data-cover="${p.id}" title="设为封面">${icons.star}</button>`}
                       <button type="button" data-remove-photo="${p.id}" title="删除这张">${icons.trash}</button>
                     </div>
                     ${isCover ? '<span class="tag tag-primary" style="position:absolute;top:6px;left:6px">封面</span>' : ''}
                   </div>`;
                 })
                 .join('')}
             </div>
             <div class="card mt-3">
               <div class="kv"><span class="k">保存位置</span><span class="v mono">相册/${esc(album.folder)}/</span></div>
             </div>`
          : emptyState({
              title: '这个相册集还是空的',
              desc: '把喜欢的照片拖进来吧，支持一次选多张。',
              icon: 'camera',
              action: '<button class="btn btn-primary" data-upload type="button">添加照片</button>',
            })
      }
    </div>`;
}

function mountAlbumDetail(root, album) {
  const fileInput = root.querySelector('#album-files');

  const upload = async (fileList) => {
    const images = [...fileList].filter((f) => f.type.startsWith('image/'));
    if (!images.length) {
      toastError('请选择图片文件');
      return;
    }
    const form = new FormData();
    for (const file of images) form.append('files', file, file.name);
    try {
      await api.uploadPhotos(album.id, form);
      toastSuccess(`已添加 ${images.length} 张照片`);
      refresh();
    } catch (err) {
      toastError(err.message);
    }
  };

  root.querySelectorAll('[data-upload]').forEach((el) =>
    el.addEventListener('click', () => fileInput.click()),
  );
  fileInput?.addEventListener('change', () => {
    upload(fileInput.files);
    fileInput.value = '';
  });

  // 重命名
  root.querySelector('[data-rename]')?.addEventListener('click', () =>
    albumEditorDialog({ album, onSaved: () => refresh() }),
  );

  // 删除相册集
  root.querySelector('[data-delete-album]')?.addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: '删除相册集',
      message: `确定要删除「${esc(album.name)}」吗？<br>电脑上的文件夹 <span class="mono">相册/${esc(album.folder)}/</span> 以及里面的 ${album.photoCount} 张照片都会被删除，无法恢复。`,
      confirmText: '删除',
      danger: true,
    });
    if (!yes) return;
    try {
      await api.deleteAlbum(album.id);
      toastSuccess('已删除');
      navigate('albums');
    } catch (err) {
      toastError(err.message);
    }
  });

  // 大图查看
  const items = album.photos.map((p) => ({
    url: fileUrl(p.filePath),
    caption: `${album.name} · ${p.originalName}`,
  }));
  root.querySelectorAll('[data-photo]').forEach((cell) => {
    cell.addEventListener('click', (e) => {
      if (e.target.closest('[data-cover]') || e.target.closest('[data-remove-photo]')) return;
      openLightbox(items, Number(cell.dataset.photo));
    });
  });

  // 设为封面
  root.querySelectorAll('[data-cover]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.setCover(album.id, Number(btn.dataset.cover));
        toastSuccess('已设为封面');
        refresh();
      } catch (err) {
        toastError(err.message);
      }
    });
  });

  // 删除单张
  root.querySelectorAll('[data-remove-photo]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const photo = album.photos.find((p) => p.id === Number(btn.dataset.removePhoto));
      const yes = await confirmDialog({
        title: '删除这张照片',
        message: `确定要删除「${esc(photo?.originalName || '')}」吗？<br>电脑上的文件也会被一起删除。`,
        confirmText: '删除',
        danger: true,
      });
      if (!yes) return;
      try {
        await api.deletePhoto(album.id, Number(btn.dataset.removePhoto));
        toastSuccess('已删除');
        refresh();
      } catch (err) {
        toastError(err.message);
      }
    });
  });

  // 拖拽上传
  const wall = root.querySelector('.page');
  wall.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  wall.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) upload(e.dataTransfer.files);
  });
}

// ===========================================================================
// 入口
// ===========================================================================

export async function pageAlbums({ route }) {
  const [id] = route.params;

  if (id) {
    const album = await api.getAlbum(id);
    return {
      html: albumDetailHtml(album),
      mount: (root) => mountAlbumDetail(root, album),
    };
  }

  const { albums } = await api.listAlbums();
  return {
    html: albumsPageHtml(albums),
    mount: mountAlbums,
  };
}
