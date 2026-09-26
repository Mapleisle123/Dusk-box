/**
 * 设置页：主题、数据目录、备份与恢复、导出。
 */

import { api } from '../api.js';
import { store, THEME_OPTIONS, STYLE_OPTIONS } from '../store.js';
import {
  esc,
  confirmDialog,
  toastError,
  toastSuccess,
  openModal,
  icons,
  formatBytes,
} from '../ui.js';
import { refresh } from '../router.js';

/**
 * 外观风格的兜底值。
 * 与 server/db.js 的 DEFAULT_SETTINGS.style、index.html 上的 data-style 必须是同一个，
 * 否则老数据/老服务端下会出现"设置页高亮的是 A、界面实际是 B"。
 */
const DEFAULT_STYLE = STYLE_OPTIONS[0].id;

// ===========================================================================
// 各分区
// ===========================================================================

function appearanceBlock(settings, backgrounds) {
  const images = backgrounds?.images ?? [];
  const current = String(settings.backgroundImage ?? '');
  const defaultImage = String(backgrounds?.defaultImage ?? '');
  // 老版本服务端可能还没有 style 这一项，回落到默认值，别让整页炸掉
  const currentStyle = String(settings.style ?? DEFAULT_STYLE);

  const thumbs = [
    `<button class="bg-thumb bg-thumb-none ${current ? '' : 'active'}" type="button"
             data-bg-pick="" title="不使用背景图"><span>不使用</span></button>`,
    ...images.map(
      (img) => `
      <button class="bg-thumb ${current === img.name ? 'active' : ''}" type="button"
              data-bg-pick="${esc(img.name)}" title="${esc(img.name)}">
        <img src="${esc(img.url)}" alt="${esc(img.name)}" loading="lazy" decoding="async">
        ${img.name === defaultImage ? '<span class="bg-badge">默认</span>' : ''}
      </button>`,
    ),
  ].join('');

  return `
    <div class="card settings-block">
      <div class="section-title mb-3">外观</div>

      <div class="settings-row">
        <div>
          <div class="s-label">主题主色调</div>
          <div class="s-desc">选中的颜色会贯穿整个界面</div>
        </div>
        <div class="s-control">
          <div class="theme-dots">
            ${THEME_OPTIONS.map(
              (t) => `
              <button class="theme-dot ${settings.theme === t.id ? 'active' : ''}"
                      type="button" data-theme-pick="${t.id}"
                      title="${esc(t.name)}" aria-label="${esc(t.name)}"
                      style="background:${t.color}"></button>`,
            ).join('')}
          </div>
        </div>
      </div>

      <div class="settings-row">
        <div>
          <div class="s-label">深色模式</div>
          <div class="s-desc">晚上看更舒服一些</div>
        </div>
        <div class="s-control">
          <button class="switch ${settings.colorMode === 'dark' ? 'on' : ''}" type="button"
                  data-toggle-mode aria-label="切换深色模式"></button>
        </div>
      </div>

      <div class="settings-row">
        <div>
          <div class="s-label">界面风格</div>
          <div class="s-desc">
            两套不同的材质语言，切换即时生效。<br>
            与主色调、深浅色互相独立，可以任意组合。
          </div>
        </div>
        <div class="s-control"></div>
      </div>

      <div class="style-picker">
        ${STYLE_OPTIONS.map(
          (s) => `
          <button class="style-opt ${currentStyle === s.id ? 'active' : ''}" type="button"
                  data-style-pick="${esc(s.id)}" aria-pressed="${currentStyle === s.id}">
            <span class="style-opt-preview ${esc(s.id)}"></span>
            <span class="style-opt-name">${esc(s.name)}</span>
            <span class="style-opt-desc">${esc(s.desc)}</span>
          </button>`,
        ).join('')}
      </div>

      <div class="settings-row">
        <div>
          <div class="s-label">页面背景图</div>
          <div class="s-desc">
            选一张图垫在页面最底层，会以大约一半的透明度透出来。<br>
            把图片放进项目里的 <span class="mono">img/background</span> 目录，这里就会自动列出来。<br>
            <span class="muted">「新粗野主义」风格是平的，不看背景图；切回「简约」即恢复。</span>
          </div>
        </div>
        <div class="s-control">
          <span class="s-state bg-state ${current ? 'is-on' : ''}"
                data-bg-state title="${esc(current)}">${esc(current || '未使用')}</span>
        </div>
      </div>

      <div class="bg-picker">${thumbs}</div>
      ${
        images.length
          ? ''
          : `<p class="text-sm muted" style="padding-bottom:12px">
                img/background 里还没有图片，往里面放一张就会出现在上面。
             </p>`
      }
    </div>`;
}

function dataBlock(runtime) {
  return `
    <div class="card settings-block">
      <div class="section-title mb-3">数据</div>

      <div class="settings-row">
        <div style="min-width:0">
          <div class="s-label">数据存放目录</div>
          <div class="s-desc mono" style="word-break:break-all">${esc(runtime.dataRoot)}</div>
        </div>
        <div class="s-control">
          <button class="btn btn-sm" data-change-root type="button">修改</button>
        </div>
      </div>

      <div class="settings-row">
        <div>
          <div class="s-label">导出全部数据</div>
          <div class="s-desc">打包成一个 ZIP 下载（数据库 + 文章 + 计划 + 相册原图）</div>
        </div>
        <div class="s-control">
          <button class="btn btn-sm" data-export type="button">${icons.download}<span>导出</span></button>
        </div>
      </div>
    </div>`;
}

function backupBlock(settings) {
  return `
    <div class="card settings-block">
      <div class="section-title mb-3">自动备份</div>

      <div class="settings-row">
        <div>
          <div class="s-label">每日自动备份</div>
          <div class="s-desc">到时间后由本地服务自动执行，不需要开着浏览器</div>
        </div>
        <div class="s-control">
          <button class="switch ${settings.backupEnabled === 'true' ? 'on' : ''}" type="button"
                  data-toggle-backup aria-label="切换自动备份"></button>
        </div>
      </div>

      <div class="settings-row">
        <div>
          <div class="s-label">备份时间</div>
          <div class="s-desc">每天这个时刻自动备份一次</div>
        </div>
        <div class="s-control">
          <input class="input" style="width:120px" type="time" value="${esc(settings.backupTime)}" data-backup-time>
        </div>
      </div>

      <div class="settings-row">
        <div>
          <div class="s-label">保留份数</div>
          <div class="s-desc">超出的旧备份会自动清理</div>
        </div>
        <div class="s-control">
          <input class="input" style="width:90px" type="number" min="1" max="365"
                 value="${esc(settings.backupKeep)}" data-backup-keep>
        </div>
      </div>

      <div class="settings-row">
        <div>
          <div class="s-label">立即备份一次</div>
          <div class="s-desc">${settings.lastBackupAt ? `上次备份：${esc(settings.lastBackupAt)}` : '还没有备份过'}</div>
        </div>
        <div class="s-control">
          <button class="btn btn-sm" data-backup-now type="button">${icons.refresh}<span>立即备份</span></button>
        </div>
      </div>
    </div>`;
}

function backupListBlock(backups) {
  return `
    <div class="card settings-block">
      <div class="flex-between mb-3">
        <div class="section-title">备份文件 <span class="count">${backups.length} 份</span></div>
        <button class="btn btn-ghost btn-sm" data-reload-backups type="button">刷新</button>
      </div>
      ${
        backups.length
          ? `<div class="backup-list">
              ${backups
                .map(
                  (b) => `
                <div class="backup-item">
                  <div style="min-width:0">
                    <div class="b-name">${esc(b.name)}</div>
                    <div class="b-meta">${esc(b.createdAt)} · ${b.reason === 'auto' ? '自动' : '手动'} · ${b.fileCount} 个文件 · ${formatBytes(b.totalBytes)}</div>
                  </div>
                  <div class="row-tight">
                    <button class="btn btn-sm" data-restore="${esc(b.name)}" type="button">恢复</button>
                    <button class="btn btn-sm btn-danger" data-del-backup="${esc(b.name)}" type="button">删除</button>
                  </div>
                </div>`,
                )
                .join('')}
            </div>`
          : '<p class="text-sm muted">还没有备份。点上面的「立即备份」可以马上生成一份。</p>'
      }
    </div>`;
}

function aboutBlock(autostart) {
  const supported = autostart?.supported !== false;
  const enabled = Boolean(autostart?.enabled);
  const stateText = !supported ? '仅 Windows 支持' : enabled ? '已开启' : '未开启';

  return `
    <div class="card settings-block">
      <div class="section-title mb-3">关于</div>
      <div class="settings-row">
        <div>
          <div class="s-label">开机自动启动</div>
          <div class="s-desc">
            开启后每次开机在后台自行启动（窗口最小化）。<br>
            也可以直接双击目录里的「安装开机自启.bat」或「取消开机自启.bat」，两种方式等效。
          </div>
        </div>
        <div class="s-control">
          ${
            supported
              ? `<span class="s-state ${enabled ? 'is-on' : ''}" data-autostart-state>${esc(stateText)}</span>
                 <button class="switch ${enabled ? 'on' : ''}" type="button"
                         data-toggle-autostart aria-label="切换开机自动启动"></button>`
              : `<span class="tag">${esc(stateText)}</span>`
          }
        </div>
      </div>
      <div class="settings-row">
        <div>
          <div class="s-label">数据说明</div>
          <div class="s-desc">
            所有内容都以真实文件保存在上面那个目录里：<br>
            一篇文章 = 一个 <span class="mono">.md</span> 文件，一个相册集 = 一个文件夹。
          </div>
        </div>
      </div>
    </div>`;
}

// ===========================================================================
// 交互
// ===========================================================================

/** 修改数据目录 */
function changeDataRootDialog(currentRoot) {
  openModal({
    title: '修改数据存放目录',
    body: `
      <div class="field">
        <label for="new-root">新的数据目录（绝对路径）</label>
        <input class="input" id="new-root" type="text" placeholder="例如：D:\\茜色箱" autocomplete="off">
        <span class="hint">当前目录：<span class="mono">${esc(currentRoot)}</span></span>
      </div>
      <div class="field">
        <label>是否把现有数据搬过去</label>
        <div class="seg" id="migrate-seg">
          <button type="button" data-migrate="1" class="active">一起搬过去（推荐）</button>
          <button type="button" data-migrate="0">从空目录重新开始</button>
        </div>
        <span class="hint">搬过去之后，原目录的数据不会被删除，可以自行清理。</span>
      </div>
      <p class="text-sm" style="color:var(--text-2)">修改后需要关闭并重新启动茜色箱才会生效。</p>`,
    footer: `
      <button class="btn" data-act="cancel" type="button">取消</button>
      <button class="btn btn-primary" data-act="save" type="button">修改</button>`,
    onMount: ({ body, foot, close }) => {
      let migrate = true;
      body.querySelectorAll('#migrate-seg button').forEach((btn) => {
        btn.addEventListener('click', () => {
          migrate = btn.dataset.migrate === '1';
          body.querySelectorAll('#migrate-seg button').forEach((b) => b.classList.toggle('active', b === btn));
        });
      });

      foot.querySelector('[data-act="cancel"]').addEventListener('click', close);
      foot.querySelector('[data-act="save"]').addEventListener('click', async () => {
        const dataRoot = body.querySelector('#new-root').value.trim();
        if (!dataRoot) {
          toastError('请填写新的数据目录');
          return;
        }
        try {
          const res = await api.changeDataRoot({ dataRoot, migrate });
          close();
          await confirmDialog({
            title: '数据目录已修改',
            message: `${esc(res.message)}${res.migrated ? `<br>已迁移 ${res.migratedFiles} 个文件。` : ''}`,
            confirmText: '知道了',
            cancelText: '稍后重启',
          });
        } catch (err) {
          toastError(err.message);
        }
      });
    },
  });
}

async function restoreFlow(name) {
  const yes = await confirmDialog({
    title: '从备份恢复',
    message: `确定要用备份「${esc(name)}」覆盖当前数据吗？<br><br><strong>当前数据会被替换掉。</strong>建议先点一次「立即备份」保住现在的状态。`,
    confirmText: '确认恢复',
    danger: true,
  });
  if (!yes) return;
  try {
    const res = await api.restoreBackup(name);
    toastSuccess(`已从 ${res.restoredFrom} 恢复`);
    refresh();
  } catch (err) {
    toastError(err.message);
  }
}

// ===========================================================================
// 入口
// ===========================================================================

export async function pageSettings() {
  const [{ settings, runtime }, { backups }, autostart, backgrounds] = await Promise.all([
    api.getSettings(),
    api.listBackups(),
    api.getAutostart(),
    // 背景图列表失败时不连累整页设置（老版本服务端可能还没有这个接口）
    api.listBackgrounds().catch(() => ({ images: [], current: '', defaultImage: '' })),
  ]);

  const html = `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>设置</h1>
          <div class="sub">主题、数据位置与备份</div>
        </div>
      </div>
      ${appearanceBlock(settings, backgrounds)}
      ${dataBlock(runtime)}
      ${backupBlock(settings)}
      ${backupListBlock(backups)}
      ${aboutBlock(autostart)}
    </div>`;

  return {
    html,
    mount(root) {
      // 主题
      root.querySelectorAll('[data-theme-pick]').forEach((dot) => {
        dot.addEventListener('click', async () => {
          try {
            await store.setTheme(dot.dataset.themePick);
            root.querySelectorAll('[data-theme-pick]').forEach((d) =>
              d.classList.toggle('active', d === dot),
            );
          } catch (err) {
            toastError(err.message);
          }
        });
      });

      // 界面风格
      root.querySelectorAll('[data-style-pick]').forEach((opt) => {
        // 用闭包里的 opt，不碰 e.currentTarget——它在 await 之后会被置为 null
        opt.addEventListener('click', async () => {
          const next = opt.dataset.stylePick;
          if (next === store.settings?.style) return;
          try {
            await store.setStyle(next);
            // 状态以服务端回报的设置为准；aria-pressed 也一起同步，
            // 因为它是一个真实的开关状态，不该只在视觉上高亮
            root.querySelectorAll('[data-style-pick]').forEach((o) => {
              const on = o.dataset.stylePick === store.settings.style;
              o.classList.toggle('active', on);
              o.setAttribute('aria-pressed', String(on));
            });
            const name = STYLE_OPTIONS.find((s) => s.id === store.settings.style)?.name;
            toastSuccess(`界面风格已切成「${name}」`);
          } catch (err) {
            toastError(err.message);
          }
        });
      });

      // 深色模式
      root.querySelector('[data-toggle-mode]')?.addEventListener('click', async (e) => {
        // 必须在 await 之前把按钮取出来：事件派发一结束，e.currentTarget 就会被置为 null，
        // 等 await 回来再去读它只会抛 TypeError（被下面的 catch 吞掉，
        // 表现成"页面变了、按钮不动"）。
        const btn = e.currentTarget;
        const next = store.settings.colorMode === 'dark' ? 'light' : 'dark';
        try {
          await store.setColorMode(next);
          // 以服务端回报的设置为准：万一写库失败或被规范化，按钮也不会显示假状态
          btn.classList.toggle('on', store.settings.colorMode === 'dark');
        } catch (err) {
          toastError(err.message);
        }
      });

      // 背景图
      root.querySelectorAll('[data-bg-pick]').forEach((thumb) => {
        thumb.addEventListener('click', async () => {
          const name = thumb.dataset.bgPick;
          if (name === String(store.settings?.backgroundImage ?? '')) return;
          try {
            await store.update({ backgroundImage: name });
            root
              .querySelectorAll('[data-bg-pick]')
              .forEach((t) => t.classList.toggle('active', t === thumb));
            const state = root.querySelector('[data-bg-state]');
            if (state) {
              state.textContent = name || '未使用';
              state.title = name;
              state.classList.toggle('is-on', Boolean(name));
            }
            toastSuccess(name ? `背景图已换成 ${name}` : '已关闭页面背景图');
          } catch (err) {
            toastError(err.message);
          }
        });
      });

      // 修改数据目录
      root.querySelector('[data-change-root]')?.addEventListener('click', () =>
        changeDataRootDialog(runtime.dataRoot),
      );

      // 导出
      root.querySelector('[data-export]')?.addEventListener('click', () => {
        window.location.href = '/api/export';
        toastSuccess('正在打包，稍等片刻…');
      });

      // 开机自启
      root.querySelector('[data-toggle-autostart]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const next = !btn.classList.contains('on');
        btn.disabled = true;
        try {
          const res = await api.setAutostart(next);
          // 以服务端回报的真实状态为准（快捷方式真的建好了才算开启）
          btn.classList.toggle('on', res.enabled);
          const state = root.querySelector('[data-autostart-state]');
          if (state) {
            state.textContent = res.enabled ? '已开启' : '未开启';
            state.classList.toggle('is-on', res.enabled);
          }
          toastSuccess(res.enabled ? '已开启开机自启' : '已取消开机自启');
        } catch (err) {
          toastError(err.message);
        } finally {
          btn.disabled = false;
        }
      });

      // 自动备份开关
      root.querySelector('[data-toggle-backup]')?.addEventListener('click', async (e) => {
        // 同上：e.currentTarget 在 await 之后会变成 null，先同步取出来
        const btn = e.currentTarget;
        const next = store.settings.backupEnabled === 'true' ? 'false' : 'true';
        try {
          await store.update({ backupEnabled: next });
          btn.classList.toggle('on', store.settings.backupEnabled === 'true');
          toastSuccess(next === 'true' ? '已开启自动备份' : '已关闭自动备份');
        } catch (err) {
          toastError(err.message);
        }
      });

      // 备份时间
      root.querySelector('[data-backup-time]')?.addEventListener('change', async (e) => {
        try {
          await store.update({ backupTime: e.target.value });
          toastSuccess('备份时间已更新');
        } catch (err) {
          toastError(err.message);
          e.target.value = store.settings.backupTime;
        }
      });

      // 保留份数
      root.querySelector('[data-backup-keep]')?.addEventListener('change', async (e) => {
        try {
          await store.update({ backupKeep: e.target.value });
          toastSuccess('保留份数已更新');
        } catch (err) {
          toastError(err.message);
          e.target.value = store.settings.backupKeep;
        }
      });

      // 立即备份
      root.querySelector('[data-backup-now]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const res = await api.createBackup('manual');
          toastSuccess(`已备份：${res.backup.name}`);
          refresh();
        } catch (err) {
          toastError(err.message);
          btn.disabled = false;
        }
      });

      root.querySelector('[data-reload-backups]')?.addEventListener('click', () => refresh());

      // 恢复
      root.querySelectorAll('[data-restore]').forEach((btn) => {
        btn.addEventListener('click', () => restoreFlow(btn.dataset.restore));
      });

      // 删除备份
      root.querySelectorAll('[data-del-backup]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const yes = await confirmDialog({
            title: '删除备份',
            message: `确定要删除备份「${esc(btn.dataset.delBackup)}」吗？删除后无法再从这个时间点恢复。`,
            confirmText: '删除',
            danger: true,
          });
          if (!yes) return;
          try {
            await api.deleteBackup(btn.dataset.delBackup);
            toastSuccess('已删除备份');
            refresh();
          } catch (err) {
            toastError(err.message);
          }
        });
      });
    },
  };
}
