/**
 * 吉祥物的几条纯规则（能在 Node 里直接跑测试，不碰 DOM）。
 */

/** 10 秒没人理她就待机 */
export const IDLE_AFTER_MS = 10000;

/** 位移超过这么多像素才算拖动，否则算点击 */
export const DRAG_THRESHOLD_PX = 4;

/** 每个页面她指的"该干什么"——她手指朝右，气泡里说的就是这句话 */
export const PAGE_LINES = {
  home: '今天还有几项没打勾，进去看看',
  posts: '想写点什么，就写下来吧',
  plans: '今天的计划还等着你打卡',
  projects: '手头那件事推进到哪儿了？',
  albums: '攒的图，进去翻翻',
  settings: '换个颜色，换个心情',
};

/** 从地址栏的 hash 里认出当前页面名（#/plans/3 → plans） */
export function pageKeyOf(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  return raw.split('/').filter(Boolean)[0] || 'home';
}

/** 当前页面该说的话；不认识的页面返回空串（那就只显示她，不冒泡） */
export function mascotLineFor(hash) {
  return PAGE_LINES[pageKeyOf(hash)] || '';
}
