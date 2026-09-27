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
