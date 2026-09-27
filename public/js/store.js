/**
 * 全局状态：设置与外观。
 *
 * 外观是"即时生效"的——切换后立刻改写 html 上的 data 属性，
 * 不需要刷新页面。
 *
 * 外观有三个相互独立的维度，可以任意组合：
 *   data-theme  主色调（茜色 / 栀子 / 青瓷 …）
 *   data-mode   深浅色（light / dark）
 *   data-style  风格（liquid 简约 / brutal 新粗野主义）
 * 三个都写成 html 上的属性，而不是往 body 里塞 class：
 * CSS 那边只需要一条 `html[data-style="brutal"] { … }` 就能换掉整套材质，
 * 组件本身一行都不用改。
 */

import { api, assetUrl } from './api.js';

export const store = {
  settings: null,
  runtime: null,

  /** 从服务端拉取设置 */
  async load() {
    const data = await api.getSettings();
    this.settings = data.settings;
    this.runtime = data.runtime;
    this.applyTheme();
    return data;
  },

  /** 把外观的三个维度 + 背景图写到根元素上 */
  applyTheme() {
    const root = document.documentElement;
    root.setAttribute('data-theme', this.settings?.theme || 'akane');
    root.setAttribute('data-mode', this.settings?.colorMode || 'light');
    root.setAttribute('data-style', this.settings?.style || 'liquid');
    this.applyBackground();
  },

  /**
   * 应用页面背景图。
   *
   * 只把图片地址写进 CSS 变量、并打一个 data-bg 标记；
   * 半透明的效果完全交给 CSS 的图层规则去做（见 app.css），
   * 这样换主题、切深浅色时纱的颜色会自动跟着变。
   *
   * 注意：新粗野主义风格是平的，那张图在那里不会显示
   * （由 CSS 里的 `--bg-photo: none !important` 关掉），
   * 但这里照常写上——切回简约时不需要再走一遍这一步。
   */
  applyBackground() {
    const root = document.documentElement;
    const name = this.settings?.backgroundImage;
    if (name) {
      root.style.setProperty('--bg-photo', `url("${assetUrl(`background/${name}`)}")`);
      root.setAttribute('data-bg', 'on');
    } else {
      root.style.removeProperty('--bg-photo');
      root.removeAttribute('data-bg');
    }
  },

  /** 切换主色调 */
  async setTheme(theme) {
    const res = await api.updateSettings({ theme });
    this.settings = res.settings;
    this.applyTheme();
  },

  /** 切换深浅色 */
  async setColorMode(mode) {
    const res = await api.updateSettings({ colorMode: mode });
    this.settings = res.settings;
    this.applyTheme();
  },

  /** 切换外观风格（简约 / 新粗野主义） */
  async setStyle(style) {
    const res = await api.updateSettings({ style });
    this.settings = res.settings;
    this.applyTheme();
  },

  /** 更新任意设置项 */
  async update(patch) {
    const res = await api.updateSettings(patch);
    this.settings = res.settings;
    this.applyTheme();
    return res.settings;
  },

  /**
   * 采纳服务端**已经返回**的设置值（不再发写请求）。
   *
   * 有些接口会顺手改动设置并把新值一并返回——比如删除正在使用的那张背景图时，
   * 服务端会把 backgroundImage 清空。这类改动必须在这里跟上：
   * 不跟的话，页面上那块底图会留在原地（接口说"已关掉"，屏幕上却还画着
   * 那张已经被删掉的图），而且下一次 applyTheme 还会拿着过期的名字去取一张
   * 不存在的图。
   *
   * 与 update 的分工：update = "我请求写入"，adopt = "服务端已经改了，我跟上"。
   */
  adopt(patch) {
    this.settings = { ...(this.settings || {}), ...patch };
    this.applyTheme();
    return this.settings;
  },
};

/** 主题可选项（与后端 THEMES 保持一致） */
export const THEME_OPTIONS = [
  { id: 'akane', name: '茜色', color: '#B7282E' },
  { id: 'amber', name: '栀子', color: '#BA7517' },
  { id: 'jade', name: '青瓷', color: '#1D9E75' },
  { id: 'azure', name: '靛蓝', color: '#2F7FD1' },
  { id: 'violet', name: '紫藤', color: '#7F77DD' },
  { id: 'graphite', name: '墨色', color: '#5F5E5A' },
];

/** 外观风格可选项（与后端 STYLES 保持一致，这里多带一份界面文案） */
export const STYLE_OPTIONS = [
  {
    id: 'liquid',
    name: '简约 · 液态玻璃',
    desc: '半透的玻璃浮在光场上，边缘有一道亮线，模糊把底下的内容推到焦外。',
  },
  {
    id: 'brutal',
    name: '新粗野主义',
    desc: '实色块面、直角、粗边、硬偏移的阴影。没有模糊，也没有底下那层光。',
  },
];
