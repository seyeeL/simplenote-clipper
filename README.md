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

写进 Simplenote 的笔记长这样。第一行是标题 —— Simplenote 按第一行给笔记命名，
所以 frontmatter 不能顶格，顶格写 `---` 会让每条笔记在列表里都叫「---」：

```
文章标题

---
url: https://example.com/article
published: 2026-08-01
created: 2026-08-20
---

## 小节标题

正文段落，**行内标记**、[链接](https://example.com)、列表、代码块、表格都会保留。
```

笔记默认打上 `markdown` 这个 systemTag，Simplenote 客户端里会按 Markdown 渲染。

设置里可以把第一行改成 `# 标题`（默认关闭）。默认关是因为 Simplenote 的笔记列表直接
显示第一行原文，开了会连 `#` 一起显示；想让笔记正文本身是规范 Markdown 就打开它。

正文开头如果有和标题一模一样的 heading（大部分文章页的 `<h1>` 就是标题），会被去掉，
不然笔记里会连着出现两行标题。不一致的 heading 保留 —— 那是文章自己的小节标题。

### 标签

标签 = 你手填的（或设置里的默认值）+ 作者 + 来源站点。作者名里的空格会换成连字符，
否则 Simplenote 会把它拆成好几个标签。

站点标签走 `lib/domains.js` 里的映射表，子域自动继承（`zhuanlan.zhihu.com` → `知乎`），
没配的域名退回主机名本身，不硬造中文名。常用站点加映射直接改那张表：

| URL | 标签 |
|-----|------|
| `mp.weixin.qq.com/s/xxx` | `公众号` |
| `weibo.com/xxx` | `微博` |
| `zhuanlan.zhihu.com/p/1` | `知乎` |
| `blog.example.com/a` | `blog.example.com` |

作者和站点只进标签，不进 frontmatter。

## 图床（可选）

不配的话，笔记里就是原图链接。微信、知乎这类站点有防盗链：带错 Referer 取图只会拿到
「未经允许不可引用」的占位图，换个客户端看就废了。配了图床，正文里的图片会先转存到
你自己的阿里云 OSS，笔记里存的是图床地址。

设置页填 AccessKey ID / Secret、Bucket、Region，可选路径前缀和自定义域名。

几个实现上的决定：

- **用 URL 签名，不用请求头签名。** 请求头方案要发 `Date` 头，而 `Date` 是 fetch 规范里的
  禁止头，浏览器会静默删掉，签名必然对不上。URL 签名把 `OSSAccessKeyId` / `Expires` /
  `Signature` 放 query，不碰任何禁止头。
- **对象名是内容哈希**（`<前缀>/<年-月>/<sha256 前 16 位>.<后缀>`）。同一张图重复剪藏不会
  传两份，也不会因为原站文件名撞车而互相覆盖。
- **单张失败就保留原链接**，不让整次剪藏失败。少一张图的笔记比没有笔记有用。
- **抓图不发 Referer**。扩展 service worker 默认就不发，防盗链站点反而给原图。
- 单张超过 10 MB 跳过；同时最多传 4 张。
- bucket 不需要配 CORS 规则：扩展拿到 host 权限后发请求不受 CORS 限制。

**权限**：抓任意站点的图需要跨域读取权限，这是个可选权限（`optional_host_permissions`），
只在设置页勾选「启用图床」时才向你申请。不用图床的话，装扩展不需要授权全站访问。

**密钥**：AccessKey 存在本机 `chrome.storage.local`。建议用只有 `oss:PutObject` 权限、
并且限定到这个 bucket 和路径前缀的 RAM 子账号，别用主账号密钥。

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
| `lib/domains.js` | 域名 → 标签映射表。加常用站点改这里 |
| `lib/images.js` | 正文里图片链接的收集与替换、后缀判定、内容哈希 |
| `lib/oss.js` | 阿里云 OSS 签名与上传 |
| `lib/simperium.js` | 登录与写入的 HTTP 客户端，错误统一包成 `SimperiumError` |
| `storage.js` | `chrome.storage.local` 封装。**故意不放 lib/**，那个目录是 web accessible 的 |
| `background.js` | service worker：注入抓取 → 拼正文 → POST。放这里是因为 popup 一关 fetch 就断 |
| `popup.*` / `options.*` | 剪藏面板 / 登录与默认值设置 |
| `tools/probe.mjs` | 调试用：对真实页面跑一遍提取，见下 |

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

图标用 Simplenote 官方应用图标，源文件 `icons/source-256.png` 取自
[simplenote-electron](https://github.com/Automattic/simplenote-electron)
的 `resources/images/icon_256x256.png`。`render.py` 只做裁白边和缩放，不改设计
（源图四周有约 14px 留白，16px 工具栏图标不裁的话白色圆盘在浅色工具栏上几乎看不见）：

```bash
python icons/render.py
```

## 调试某个站点抓不到正文

`lib/extract.js` 要真 DOM 才能跑，node 里测不了；抓 HTTP 请求也没用，很多站点的正文是
JS 渲染出来的。`tools/probe.mjs` 起一个独立 profile 的 Chrome（不碰你正在用的那个），
把提取逻辑注进页面执行：

```bash
node tools/probe.mjs "<url>"          # 看提取结果：标题、选中的容器、正文开头
node tools/probe.mjs "<url>" --dump   # 看页面里文字量最大的容器，定位正文到底在哪
node tools/probe.mjs "<url>" --wx     # 用微信 UA，公众号链接需要
node tools/probe.mjs "<url>" --show   # 开真窗口，不用 headless
```

排查顺序：`--dump` 看正文在哪个容器 → 不带参数看提取选中了谁。两者对不上就是选容器的
问题（改 `PREFERRED` 或 `scoreNode`）；选对了但 `mdLen` 很小，就是被 `cleanClone` 的噪声
规则误删了（改 `ALWAYS_JUNK` / `WEAK_JUNK`）。

## 已知边界

- **正文提取是启发式的**。语义选择器猜不中就按「段落文字量 × (1 - 链接密度)」打分选容器，
  论坛、瀑布流、SPA 这类页面会漏。提取不到正文时笔记只留链接，不会写出空笔记。
  新站点抓不到正文按上面的「调试某个站点抓不到正文」走。
- **噪声过滤按 class / id 命名猜**，会误伤。命名里带 `share`、`nav`、`footer` 这类词但
  文字量大且不是链接堆的容器会被保留 —— 公众号正文就挂在 `p.share_notice_inner` 上，
  一刀切会把正文删光。反过来，正文容器如果被命名成 `related` / `comments` 就一定会丢。
- **不去重**。同一个 URL 剪两次会产生两条笔记。查重要走 Simperium 的 index 接口全表扫，
  代价和收益不匹配，先不做。
- **只存文本**。Simplenote 不支持附件，图片以 Markdown 链接形式保留。想让图片长期可用
  就配图床，否则原站换域名或加防盗链之后笔记里的图就废了。
- **图床只支持阿里云 OSS**。腾讯 COS、七牛这些签名方式不同，没做。
- **不做划词剪藏**。当前只有整页正文一条路径。
- **受限页面剪不了**：`chrome://`、扩展商店、PDF 阅读器不允许注入脚本，会提示换页面。
