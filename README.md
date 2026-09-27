# 茜色箱（Dusk Box）

一个**只在你自己电脑上跑**的个人生活日志应用。

它把三件事装进一个箱子里：**记录生活**（写文章、贴图）、**规划生活**（计划 + 每日打卡）、**收藏生活**（相册集）。

和常见的日记 / 待办工具最大的不同在一条原则：

> **你的数据就是你电脑上的文件。**
> 可以随时用资源管理器打开、用记事本读、拷贝、备份，不依赖任何账号与云端。

"茜色"是一种深红偏橙的暖色，是这个应用的主色调。英文名 **Dusk Box**——暮色是一天的收尾，而这个箱子装的正是每天结束时留下的东西。

> 名字怎么用的：界面上显示中文「茜色箱」；数据库文件名、启动脚本、代码常量、日志则用英文 `Dusk Box` / `duskbox.db`。
> 原因是中文文件名在 Windows 上会牵出 `.bat` 的编码坑（中文 bat 必须 GBK + CRLF + 无 BOM，否则双击时 cmd 会在解析阶段把命令行拆断）。

---

## 目录

- [它是怎么工作的](#它是怎么工作的)
- [环境要求](#环境要求)
- [如何使用](#如何使用)
- [界面导览](#界面导览)
- [数据存在哪里](#数据存在哪里)
- [备份与恢复](#备份与恢复)
- [示例](#示例)
- [配置](#配置)
- [开发](#开发)
- [常见问题](#常见问题)

---

## 它是怎么工作的

茜色箱由两部分组成：

| 部分 | 说明 |
|---|---|
| **本地服务** | 一个 Node.js 进程，负责读写 SQLite、把数据导出为分类真实文件、定时备份、开机自启。平时无界面。 |
| **浏览器界面** | 你通过 `http://localhost:8899` 使用它。界面本身**不存任何数据**，只是一个看板与操作入口。 |

数据流向：

```
你的操作 → 页面 → 本地服务 → SQLite 数据库
                                ↓
                   定时任务 → 分类导出为真实文件 + 备份
```

**明确不做的事**：不登录注册、不联网、不云同步、不部署到服务器、不做手机端。

**硬指标**：刷新页面、关浏览器、重启电脑、清空浏览器缓存——数据都不能丢。因为数据根本不在浏览器里。

**零第三方依赖**：HTTP 服务、路由、multipart 解析、ZIP 打包全部基于 Node 内置模块手写，没有 `node_modules`，也不会因为依赖过期而跑不起来。

---

## 环境要求

- **Node.js ≥ 22.5**（用到内置的 `node:sqlite`）。下载地址：<https://nodejs.org/>
- Windows（开机自启功能为 Windows 专属；服务本身跨平台）
- 不需要 `npm install`——项目没有依赖

---

## 如何使用

### 第一次启动

双击项目根目录下的 **`DuskBox-start.bat`**。

脚本会自动找到 Node，启动服务，并打开浏览器。终端窗口里会显示：

```
  Dusk Box 已启动
  访问地址：http://localhost:8899
  数据目录：<项目目录>\data
  关闭此窗口即停止服务（数据不会丢失）
```

> 关掉这个黑窗口就是停止服务。数据已经落在磁盘上，不会丢。

也可以用命令行启动：

```bash
npm start          # 等价于 node server/index.js
node server/index.js
```

### 开机自启

两种方式，效果完全一样（操作的都是「启动」文件夹里的同一个快捷方式）：

- 双击 **`DuskBox-autostart-on.bat`** / **`DuskBox-autostart-off.bat`**
- 或在应用的「设置」页里拨那个开关

因为唯一事实来源是快捷方式本身，所以「手动双击 bat」和「设置页开关」不会各说各话——谁改的，另一处都能立刻看到真实状态。

### 停止服务

关闭启动时的窗口，或在窗口里按 `Ctrl + C`。

### 换台电脑 / 迁移数据

设置页里改「数据目录」，默认会把现有数据整体搬过去（含数据库和分类文件）；改完**重启服务**生效。

---

## 界面导览

左侧常驻导航，五个页面，底部有一个小圆点显示本地服务是否运行中。

| 页面 | 地址 | 用途 |
|---|---|---|
| **首页** | `#/home` | 今日速览：今日计划（可直接打卡）、近期收藏、三个模块的摘要卡片 |
| **发布** | `#/posts` | 图文记录，Markdown 正文，按日期倒序的时间线，支持搜索与筛选 |
| **计划** | `#/plans` | 确认式 / 量化式两种打卡，滚动周期，周期进度与超额标识，打卡历史 |
| **相册** | `#/albums` | 相册集 → 图片，批量上传，大图查看，封面设置 |
| **设置** | `#/settings` | 主题与外观、背景图、数据目录、备份、开机自启、导出 |

**两种打卡方式**：

- **确认式**：今天做没做，点一下打勾（可撤销）。
- **量化式**：记进度，如"每周跑 3 次"，输入本次次数，**允许超额**（跑 4 次就是 4/3，界面会特别标注"超额"）。

**外观是三个独立维度**，可任意组合出 24 种样子：

- 主色调 6 种：`akane`（茜）/ `amber` / `jade` / `azure` / `violet` / `graphite`
- 明暗 2 种：浅色 / 深色
- 风格 2 种：`liquid`（简约·液态玻璃）/ `brutal`（新粗野主义：实色块面、直角、粗边、硬阴影）

---

## 数据存在哪里

默认在 **项目目录下的 `data/`**，你可以在设置页改到任何位置（比如 `D:\DuskBox`）。

双层存储：**SQLite 是主存储**（实时读写），**分类真实文件是给你看的**（随时可打开）。每次操作都会同步落盘。

```
data/
├── duskbox.db                       ← SQLite 主存储
├── 发布/
│   └── 2026/
│       ├── 2026-09-27 秋日散步.md    ← 一篇文章一个 .md，日期开头命名
│       └── media/
│           └── 2026-09-27-01.jpg     ← 图片按"日期-序号"命名
├── 计划/
│   └── 每周跑3次.md                  ← 一个计划一个 .md，含完整打卡记录表
├── 相册/
│   └── 秋天/                         ← 一个相册集一个文件夹
│       ├── _album.json               ← 相册集元信息
│       └── IMG_001.jpg               ← 图片原文件，直接存这里
├── 背景图/                           ← 你在设置页添加的背景图（自带图仍在 img/background/）
└── 备份/
    └── 2026-09-27/                   ← 按日期存放的备份
```

**落盘规则**：

- 一篇文章 = 一个 `.md` 文件，改标题会重命名、不残留旧文件。
- 所有写文件都是"先写临时文件再改名"的原子写入，中途断电不会留下半截文件。
- 文件名经过净化（过滤 Windows 非法字符与保留名），保证一定能落盘成功。

---

## 备份与恢复

| 能力 | 说明 |
|---|---|
| **自动备份** | 默认每天 `23:30` 执行，可在设置页改时间与开关 |
| **保留份数** | 默认保留最近 30 份，超出自动清理最旧的 |
| **手动备份** | 设置页「立即备份一次」，随时可点 |
| **备份内容** | 数据库快照 + 发布/计划/相册/背景图 四个分类目录 |
| **恢复** | 指定某个备份目录恢复，需二次确认（会提示先备份当前状态） |
| **导出** | 一键导出为 ZIP：数据库快照 + 全部原始文件（含你添加的背景图） |

---

## 示例

### 示例一：用界面写第一篇日记

1. 双击 `DuskBox-start.bat`，浏览器打开 `http://localhost:8899`。
2. 左侧点「发布」→ 右上角「写一篇」。
3. 填标题「秋日散步」，正文用 Markdown：

   ```markdown
   今天沿着江边走了很久，风里有桂花香。

   - 路过那家旧书店，还开着
   - 捡了一片很好看的银杏叶
   ```

4. 拖两张照片进去 → 点「发布」。
5. 回到时间线，文章出现在最上面。

现在打开数据目录，你会看到：

```
data/发布/2026/2026-09-27 秋日散步.md
data/发布/2026/media/2026-09-27-01.jpg
data/发布/2026/media/2026-09-27-02.jpg
```

### 示例二：建一个「每周跑 3 次」并打卡

1. 左侧点「计划」→「新建计划」。
2. 名称填「每周跑3次」，打卡方式选**量化式**，目标 `3`、单位「次」，周期选「每周」，首次起算选「创建当天」。
3. 保存后，在首页或计划页给今天记一次进度：输入 `2`。
4. 再改成 `4`——卡片上会出现**超额**标识（4/3），这是特意做的正反馈。

对应的计划文件里会自动生成打卡记录表：

```markdown
## 打卡记录

| 日期 | 结果 |
| --- | --- |
| 2026-09-27 | 4 次 |
```

### 示例三：攒一个「秋天」相册

1. 左侧点「相册」→「新建相册集」，命名「秋天」。
2. 点进去，批量选中一堆图上传。
3. 点任一张图可看大图；在图上设为封面。

磁盘上就是一个普通文件夹，图片原文件直接躺在里面：

```
data/相册/秋天/IMG_001.jpg
data/相册/秋天/_album.json
```

### 示例四：用命令行调接口

服务跑在 `http://localhost:8899`，所有业务接口以 `/api` 开头。下面示例按 bash / Git Bash 写法（Windows 的 cmd 引号规则不同，建议用 Git Bash 或 Postman）。

**看服务是否活着：**

```bash
curl http://localhost:8899/api/health
```

```json
{ "ok": true, "app": "Dusk Box", "dataRoot": "…\\data", "time": "2026-09-27T02:10:00.000Z" }
```

**发一篇纯文字文章：**

```bash
curl -X POST http://localhost:8899/api/posts \
  -H "Content-Type: application/json" \
  -d '{"title":"夜读","content":"读完《小径分岔的花园》。","postDate":"2026-09-27"}'
```

响应里会带上落盘路径：

```json
{ "post": { "id": 1, "title": "夜读", "post_date": "2026-09-27", "media": [] },
  "filePath": "发布/2026/2026-09-27 夜读.md" }
```

**发一篇带图片的文章**（multipart，图片字段名是 `files`，可重复）：

```bash
curl -X POST http://localhost:8899/api/posts \
  -F "title=秋日散步" \
  -F "content=江边走了很久。" \
  -F "postDate=2026-09-27" \
  -F "files=@./a.jpg" \
  -F "files=@./b.jpg"
```

**建一个量化式计划：**

```bash
curl -X POST http://localhost:8899/api/plans \
  -H "Content-Type: application/json" \
  -d '{"name":"每周跑3次","mode":"quant","targetValue":3,"unit":"次","cycleUnit":"week","startMode":"same_day"}'
```

**打卡 / 记进度：**

```bash
curl -X POST http://localhost:8899/api/plans/1/checkin \
  -H "Content-Type: application/json" \
  -d '{"value":4}'
```

**确认式打卡与撤销：**

```bash
curl -X POST http://localhost:8899/api/plans/2/checkin -H "Content-Type: application/json" -d '{"done":true}'
curl -X DELETE "http://localhost:8899/api/plans/2/checkin?date=2026-09-27"
```

**建相册集 + 批量传图：**

```bash
curl -X POST http://localhost:8899/api/albums -H "Content-Type: application/json" -d '{"name":"秋天"}'
curl -X POST http://localhost:8899/api/albums/1/photos -F "files=@./IMG_001.jpg" -F "files=@./IMG_002.jpg"
```

**立即备份 / 查看备份 / 恢复：**

```bash
curl -X POST http://localhost:8899/api/backups -H "Content-Type: application/json" -d '{"reason":"manual"}'
curl http://localhost:8899/api/backups
curl -X POST http://localhost:8899/api/backups/restore -H "Content-Type: application/json" -d '{"name":"2026-09-27"}'
```

**改主题 / 导出全部数据：**

```bash
curl -X PUT http://localhost:8899/api/settings -H "Content-Type: application/json" -d '{"theme":"jade","colorMode":"dark","style":"brutal"}'
curl -L http://localhost:8899/api/export -o DuskBox-导出.zip
```

**常用接口一览：**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查（侧栏小圆点用） |
| GET | `/api/home?date=YYYY-MM-DD` | 首页聚合数据 |
| GET/POST/PUT/DELETE | `/api/posts`、`/api/posts/:id` | 文章增删改查；`GET /api/posts?q=&type=&from=&to=` 支持搜索筛选 |
| GET | `/api/posts/dates` | 有内容的日期列表 |
| GET/POST/PUT/DELETE | `/api/plans`、`/api/plans/:id` | 计划；`/checkin` 打卡、`/history` 历史、`/archive` 归档 |
| GET | `/api/plans/reminder` | 进入计划页的自动提醒数据 |
| GET/POST/PUT/DELETE | `/api/albums`、`/api/albums/:id` | 相册集；`/photos` 上传、`/cover` 设封面 |
| GET/PUT | `/api/settings` | 设置读写（`GET` 返回里含只读的 `runtime` 信息） |
| GET/PUT | `/api/autostart` | 开机自启状态与开关 |
| GET/POST/DELETE | `/api/backups`、`/api/backups/restore`、`/api/backups/prune` | 备份与恢复 |
| GET | `/api/export` | 导出全部数据为 ZIP |

> 写接口接受 **JSON** 或 **multipart/form-data** 两种请求体，带文件时用后者。

---

## 配置

### `config.json`（项目根目录，可不存在）

只放两件**必须在数据库打开之前就知道**的事：

```json
{
  "dataRoot": "D:/DuskBox",
  "port": 8899
}
```

- `dataRoot`：数据目录，默认是项目下的 `data/`。改它**必须重启服务**。
- `port`：端口，默认 `8899`。**端口被占用时会自动向后试探最多 20 个端口**，并在终端里告诉你实际用了哪个。

> 文件不存在或内容损坏时，会静默退回默认值（项目 `data/` + `8899`），不会阻断启动。

### 其余设置

主题、明暗、风格、背景图选择、备份策略存在数据库的 `settings` 表里，在设置页里改，即时生效。

- **换背景图有两条路**：① 在设置页点「添加背景图」直接选一张图——它只存进你**数据目录的 `背景图/`**，
  **不上传到任何地方**（服务本身也只跑在 `127.0.0.1`）；② 把图片丢进 `img/background/` 当自带图。
  两条路的图会合并显示在同一个列表里，自己加的会标上「我的」，可随时删除。
- 想换 logo：替换 `img/logo/logo.jpg`（侧栏徽标和网页图标指向同一个文件，换一次两处都变）。

---

## 开发

### 目录结构

```
server/          服务端
  index.js       入口：读配置 → 装配 → 监听端口 → 开浏览器
  app.js         唯一的装配点（建库、建存储、挂路由）
  constants.js   全局常量（数据库文件名、应用英文名）——不依赖任何模块
  http.js        零依赖 HTTP 层：路由 / JSON / multipart / 静态文件
  db.js          SQLite 建表、设置读写、默认值兜底
  storage.js     落盘层：Markdown / 图片 / 相册文件夹，原子写入
  backup.js      备份、恢复、清理、定时调度
  zip.js         ZIP 打包
  autostart.js   开机自启（以快捷方式为准）
  routes/        路由层（参数解析与校验）
  services/      业务层（规则与落盘）
public/          前端静态文件，无构建步骤
  js/pages/      五个页面
  css/app.css    主题令牌与两套风格
img/             随应用走的自带资源（logo、背景图）
test/            测试
scripts/         辅助脚本
data/            运行时数据（不在版本控制里）
```

### 跑测试

```bash
npm test
```

测试用 Node 内置 `node --test`，每个用例起一个**独立的临时数据目录**，跑完自动清理，**绝不碰你的真实数据**。

除了功能用例，还有几条"护栏"型测试：它们直接扫描前端源码，禁止某些写法回归（例如在 `await` 之后读 `event.currentTarget`、在阴影列表里写 `none`）。

**反向验证**：护栏有没有牙齿，要靠故意改坏代码来确认——

```bash
node scripts/verify-mutations.mjs
```

它会逐个植入退化写法、跑测试、确认确实失败、再还原。改坏了测试还过的，就不算护栏。

### 测试环境变量

| 变量 | 作用 |
|---|---|
| `QSX_CONFIG_FILE` | 把配置文件指向临时文件，避免污染真实 `config.json` |
| `QSX_STARTUP_DIR` | 把开机自启目录指向临时目录 |
| `QSX_BACKGROUND_DIR` | 把背景图目录指向临时目录 |
| `QSX_NO_OPEN=1` | 启动时不自动打开浏览器 |

---

## 常见问题

**关掉黑窗口，数据会丢吗？**
不会。数据在磁盘上，不在内存里，也不在浏览器里。

**能几个人一起用吗？**
不能，也不打算做。这是一个人的箱子。

**改了 `server/` 里的代码，为什么没生效？**
Node 不做热更新。必须关掉旧进程重新启动，否则旧进程还占着端口、按旧逻辑响应。

**端口 8899 打不开？**
看启动窗口里实际打印的地址——端口被占用时它会自动换到 8899 之后的空闲端口。

**数据目录里的 `.md` 我能直接改吗？**
能读、能拷、能备份。但如果直接修改内容，下次在应用里编辑同一条记录时，应用会用数据库里的内容覆盖它——**数据库才是唯一数据源**，文件是它的导出视图。

**第一版明确不做的**：视频上传、累计型计划（"一年读 50 本"）、标签与心情体系、统计图表、富文本编辑器（正文用 Markdown）。详见 `PRD.md`。
