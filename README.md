# Simplenote 剪藏

Chrome / Edge MV3 扩展：提取当前网页正文，转成 Markdown，直接写进 Simplenote。

不依赖任何中转服务，也不需要自建后端。扩展直接调用 Simplenote 官方的 Simperium API，
加载后登录即可用。

## 安装

1. 打开 `chrome://extensions/`（Edge 是 `edge://extensions/`）
2. 打开「开发者模式」
3. 点「加载已解压的扩展程序」，选这个目录

## 登录

点扩展图标 → 「设置」，填 Simplenote 邮箱 → 发送验证码 → 填邮件里的验证码 → 登录。

走的是 Simplenote 官方的邮箱魔法链接流程，**密码不经过这个扩展**。拿到的 token 只存在本机
`chrome.storage.local`，不上传、不写日志、不进 git。「退出登录」会把它清掉。

## 用法

- 点扩展图标 → 改标签（可选）→「剪藏本页」
- 或在页面上右键 →「剪藏到 Simplenote」，用设置里的默认标签

写进 Simplenote 的笔记长这样（第一行是标题，Simplenote 按第一行给笔记命名）：

```
文章标题

来源：https://example.com/article
某某站点 · 作者 张三 · 发布 2026-08-01 · 剪藏 2026-08-20

---

## 小节标题

正文段落，**行内标记**、[链接](https://example.com)、列表、代码块、表格都会保留。
```

笔记默认打上 `markdown` 这个 systemTag，Simplenote 客户端里会按 Markdown 渲染。

## 接口

| 用途 | 端点 |
|------|------|
| 发验证码 | `POST https://app.simplenote.com/account/request-login` |
| 换 token | `POST https://app.simplenote.com/account/complete-login` → `sync_token` |
| 建笔记 | `POST https://api.simperium.com/1/chalk-bump-f49/note/i/<uuid>?ccid=<uuid>`，头 `X-Simperium-Token` |

端点和字段口径抄自 [Automattic/simplenote-mcp](https://github.com/Automattic/simplenote-mcp)
（`src/providers/auth.ts`、`src/providers/simperium-api.ts`）。

两个容易踩的点：

- **`request_source` 必须是 `macOS` 或 `iOS`**。服务端按这个字段给 token 划范围，填自定义值
  能拿到 token，但 Simperium 写入时会拒。
- **note payload 要补齐 `publishURL` / `shareURL` / `systemTags` / `tags`**。Simperium 的
  REST POST 是整体替换，缺的字段会被别的客户端当成空值同步覆盖。

## 目录

| 文件 | 职责 |
|------|------|
| `lib/extract.js` | 网页正文与元信息提取。需要真 DOM，只在页面上下文里跑 |
| `lib/html2md.js` | DOM → Markdown。只用五个 DOM 接口走树，纯逻辑，可 node 测 |
| `lib/note.js` | 纯函数：拼笔记正文、组 Simperium payload、标签规范化 |
| `lib/simperium.js` | 登录与写入的 HTTP 客户端，错误统一包成 `SimperiumError` |
| `storage.js` | `chrome.storage.local` 封装。**故意不放 lib/**，那个目录是 web accessible 的 |
| `background.js` | service worker：注入抓取 → 拼正文 → POST。放这里是因为 popup 一关 fetch 就断 |
| `popup.*` / `options.*` | 剪藏面板 / 登录与默认值设置 |

`lib/extract.js` 和 `lib/html2md.js` 在 `manifest.json` 里声明为 `web_accessible_resources`，
因为注入脚本要 `import()` 它们；`lib/simperium.js`、`storage.js` 不外露。

## 测试

纯逻辑用 node 原生 test runner，无第三方依赖。`html2md` 的测试用 `tests/fake-dom.mjs` 手搓
假节点，不引 jsdom。

```bash
node --test "tests/*.test.mjs"
```

需要 Node 18 以上（`node --test` 从 18 开始提供）。系统默认的 node 版本较低时，
用 nvm / fnm 这类工具切一个新版本再跑。

改图标后重新生成 PNG（任意带 Pillow 的 python）：

```bash
python icons/render.py
```

## 已知边界

- **正文提取是启发式的**。语义选择器猜不中就按「段落文字量 × (1 - 链接密度)」打分选容器，
  论坛、瀑布流、SPA 这类页面会漏。提取不到正文时笔记只留链接，不会写出空笔记。
- **不去重**。同一个 URL 剪两次会产生两条笔记。查重要走 Simperium 的 index 接口全表扫，
  代价和收益不匹配，先不做。
- **只存文本**。Simplenote 不支持附件，图片以 Markdown 链接形式保留，原图不落地。
- **不做划词剪藏**。当前只有整页正文一条路径。
- **受限页面剪不了**：`chrome://`、扩展商店、PDF 阅读器不允许注入脚本，会提示换页面。
