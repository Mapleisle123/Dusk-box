/**
 * 吉祥物的几条纯规则。
 *
 * 单独成一个文件，是为了能**在 Node 里直接跑单元测试**：
 * `mascot.js` 里全是 DOM 与 <video>，测试碰不了；
 * 但"连点三次算跺脚、间隔超时就重新数"这种判断是纯计算，值得单独钉住。
 */

/** 连续点几次算"她在被戳" */
export const STOMP_CLICKS = 3;

/** 这几次点击必须落在多长时间里 */
export const STOMP_WINDOW_MS = 2000;

/** 完全没人理她多久之后开始待机 */
export const IDLE_AFTER_MS = 20000;

/** 位移超过这么多像素才算拖动，否则算点击 */
export const DRAG_THRESHOLD_PX = 4;

/**
 * 记一次点击，返回"该不该跺脚"。
 *
 * @param {number[]} clickTimes 之前的点击时刻
 * @param {number} now 这一次的时刻
 * @returns {{stomp:boolean, recent:number[]}} recent 是下次要带上的历史
 */
export function noteClick(
  clickTimes,
  now,
  { clicks = STOMP_CLICKS, windowMs = STOMP_WINDOW_MS } = {},
) {
  const recent = [...clickTimes.filter((t) => now - t <= windowMs), now];
  if (recent.length >= clicks) return { stomp: true, recent: [] };
  return { stomp: false, recent };
}
