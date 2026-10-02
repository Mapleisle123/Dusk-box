/**
 * 全局常量。
 *
 * 这里不 import 任何东西，避免循环依赖——
 * app.js 与 backup.js 都要用这些名字，且 backup.js 位于 app.js 的引用链下游。
 */

/**
 * 数据库文件名。
 *
 * 用纯 ASCII 而非中文：Windows 上中文文件名会牵扯 .bat 的 GBK 编码坑，
 * 也会让命令行、备份脚本、日志里的路径难以处理。
 */
export const DB_FILENAME = 'duskbox.db';

/**
 * 改名前的旧数据库文件名。
 * 2026-09-27 之前生成的备份里仍是这个名字，恢复时必须兼容，否则老备份会作废。
 */
export const LEGACY_DB_FILENAME = '茜色箱.db';

/**
 * 应用英文名，用于 API 返回、备份清单、日志前缀。
 * 界面上仍然显示中文「茜色箱」——那是给用户看的，这里是给机器看的。
 */
export const APP_NAME = 'Dusk Box';

/**
 * 启动相关脚本的文件名。
 *
 * 两个启动脚本分工不同，缺一不可：
 *   - START_SCRIPT 有窗口：双击能看到启动日志，关掉窗口就等于停止服务。
 *     它同时是"没找到 Node 时"的兜底——里面的中文提示会告诉用户去装 Node。
 *   - LAUNCH_SCRIPT 无窗口：桌面快捷方式与开机自启都指向它，
 *     双击后由 server/launch.js 在后台把服务拉起来，再打开浏览器。
 */
export const START_SCRIPT = 'DuskBox-start.bat';
export const LAUNCH_SCRIPT = 'DuskBox-launch.vbs';

/** 快捷方式文件名（开机自启与桌面用同一个名字，靠所在目录区分） */
export const SHORTCUT_NAME = 'DuskBox.lnk';

/** 安装 / 移除快捷方式的辅助脚本（可以手动双击，与设置页开关等效） */
export const AUTOSTART_ON_SCRIPT = 'DuskBox-autostart-on.bat';
export const AUTOSTART_OFF_SCRIPT = 'DuskBox-autostart-off.bat';
export const DESKTOP_ON_SCRIPT = 'DuskBox-desktop-on.bat';
export const DESKTOP_OFF_SCRIPT = 'DuskBox-desktop-off.bat';

/**
 * 「停止服务」接口要求的自定义请求头。
 *
 * 服务只绑在 127.0.0.1 上，外部网络进不来；但**浏览器里任何一个网页**都能
 * 对着 localhost 发请求。所以这里要求一个自定义请求头：
 * 跨站请求想带上它必须先通过 CORS 预检，而本服务从不放行 CORS，
 * 于是别的网页就点不到"停止服务"这个按钮。
 *
 * 注意它不是一个密钥——同机的本程序（托盘、设置页）本来就有权停止服务，
 * 它挡的是"别的网页顺手把服务停掉"。
 */
export const SHUTDOWN_HEADER = 'x-duskbox-action';
export const SHUTDOWN_TOKEN = 'shutdown';
