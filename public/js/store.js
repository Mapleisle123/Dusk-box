/**
 * 全局状态：设置与主题。
 *
 * 主题是"即时生效"的——切换后立刻改写 html 上的 data 属性，
 * 不需要刷新页面。
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

  /** 把主题与背景图写到根元素上 */
  applyTheme() {
    const theme = this.settings?.theme || 'akane';
    const mode = this.settings?.colorMode || 'light';
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-mode', mode);
    this.applyBackground();
  },

  /**
   * 应用页面背景图。
   *
   * 只把图片地址写进 CSS 变量、并打一个 data-bg 标记；
   * 半透明的效果完全交给 CSS 的图层规则去做（见 app.css），
   * 这样换主题、切深浅色时纱的颜色会自动跟着变。
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

  /** 更新任意设置项 */
  async update(patch) {
    const res = await api.updateSettings(patch);
    this.settings = res.settings;
    this.applyTheme();
    return res.settings;
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
