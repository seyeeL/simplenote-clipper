# 站点兼容清单

这个扩展默认走通用启发式提取正文，大部分文章页不用配置就能抓。这里记的是**实测过**
的站点：哪些验证通过、哪些写了专用规则、哪些还有已知缺口。

## 兼容域名

写了专用规则、并且实测通过的站点。这份编号清单只放站点，加一个站点就加一条。

1. **[微信公众号](#微信公众号)** `mp.weixin.qq.com`：正文、作者、时间全部通过。
2. **[微博](#微博)** `weibo.com`、`weibo.cn`：正文、作者、时间、九宫格配图全部通过。
3. **[小红书](#小红书)** `xiaohongshu.com`：正文、作者、时间、九宫格配图全部通过；**要登录态**。

> 不在这张清单上的站点走[通用启发式](#验证过但不需要专用规则的站点)，不用配置也能抓。
> `lib/domains.js` 里另有[二十来个域名只配了标签](#只配了标签的域名)，提取没验证过，别当成支持。
> 想加新站点看[加一个新站点](#加一个新站点)。

## 写了专用规则的站点

### 微信公众号

`mp.weixin.qq.com`

| 项 | 取法 |
|----|------|
| 正文 | `#js_content` |
| 作者 | `#js_name` |
| 时间 | `#publish_time` |
| 标签 | `公众号` |

实测 2026-08-20，[样例文章](https://mp.weixin.qq.com/s/QpoEDH56bWI_7P6WjJu7KQ)，791 字符正文，
段落完整。

踩过的坑：这个站点会把整篇正文放在 `<p class="share_notice_inner">` 里。噪声过滤规则里
有 `share` 这个词，早期版本按类名一刀切，正文从 847 字符掉到 44。现在噪声词分强弱两档，
弱证据的词只在文字量小或链接密度高时才删。

另一个坑：公众号排版大量用 `<div>` / `<section>`，一个 `<p>` 都没有。按段落打分选容器
会得 0 分，转 Markdown 时也会把全文拼成一整行。两处都单独处理过了。

### 微博

`weibo.com`、`weibo.cn`（子域自动继承）

| 项 | 取法 |
|----|------|
| 正文 + 配图 | `.wbpro-feed-content`，兜底 `[class*="wbtext"]` |
| 作者 | `a[class*="_name_"][href*="/u/"]` |
| 时间 | `a[class*="_time_"]`，两位年份补成四位、月日补零 |
| 标题 | 微博没有标题，取正文开头 40 字 |
| 图片 | 缩略图尺寸段换成 `large`（原图） |
| 标签 | `微博` |

实测 2026-08-20 两条：[纯文字](https://weibo.com/1088413295/5113631702256640)483 字符正文；
[带两张配图](https://weibo.com/2954851423/5331427143191023)正文 + 2 张图，作者和时间都对。
两条都不需要登录，headless 直接能渲染。

微博的类名带构建 hash（`_wbtext_1h76l_19`），只匹配稳定的那一段，否则一发版就失效。
时间显示成 `26-8-13 12:19` 这种两位年、月日不补零的格式，规则里补成 `2026-08-13`。
表情是 `<img>`，混进正文会被当成配图，开了图床还会一张张传上去，所以按 `src` 过滤掉。

**配图靠外层容器一起带出来。** 正文块 `[class*="wbtext"]` 和九宫格 `div.picture` 是兄弟节点，
共同的父节点 `.wbpro-feed-content` 不带构建 hash，直接拿它当 `root`，文字和图按页面顺序
一起进正文。`wbtext` 留在 `root` 数组里兜底：外层哪天改名了，至少正文还在——两个选择器
在正常页面上是嵌套关系，只会保留最外层那个，正文不会重复。

**图片要 Referer 才给。** sinaimg 认「浏览器 UA + 没有 Referer」这个组合就 403，跟图片
尺寸无关（`orj360` 一样被拒）。service worker 抓图正好是这个组合，所以微博的图在配上
`imageReferer` 之前根本转存不进图床。规则里配了 `imageReferer: 'https://weibo.com/'` 和
`imageHosts: ['sinaimg.cn']`，抓图期间临时装一条 declarativeNetRequest 会话规则补上 Referer。

**九宫格给的是缩略图。** 页面上的 `src` 是 `orj360`（本文那两张各 14 KB），截图缩到 360 宽
根本看不清字。规则里把地址的尺寸段换成 `large` 拿原图（同一张 477 KB）。只认
`orj360` / `mw690` / `bmiddle` 这类已知尺寸段，头像的 `crop.0.0.1080.1080.180` 不在其中，
不会被误改。

### 小红书

`xiaohongshu.com`

| 项 | 取法 |
|----|------|
| 正文 + 配图 | `.media-container` + `#detail-desc` |
| 标题 | `#detail-title`，没有就取正文开头 40 字 |
| 作者 | `#noteContainer .author-wrapper .name` |
| 时间 | `.bottom-container .date`，去掉「编辑于」前缀和末尾的发布地点 |
| 标签 | `小红书` |

实测 2026-08-20 五条笔记（图文 / 视频 / 有标题 / 无标题 / 带表情各一条），正文、作者、
时间、九宫格配图都对。

**必须在登录态下用。** 干净 profile 打开笔记页会被风控挡掉，跳转到
`website-login/error?error_code=300012`（「IP存在风险，请切换可靠网络环境后重试」）。
扩展跑在你自己已登录的浏览器里，所以剪藏没问题；但 `tools/probe.mjs` 起的是独立
profile，抓小红书只会拿到那张拦截页，调试得连已登录的浏览器（见
[调试某个站点抓不到正文](../README.md#调试某个站点抓不到正文)）。

这个站点一次踩了五个坑，规则里每一条都对应一个：

| 坑 | 表现 | 规则 |
|----|------|------|
| swiper 循环滚动 | 九张图的 DOM 里有 11 个 `<img>`，首尾两张各复制一份 | `drop: .swiper-slide-duplicate` |
| 图区的 UI 文字 | 「1/9」页码、翻页箭头、长按保存提示混进正文 | `drop: .fraction / .arrow-controller / #copy-img-guide` |
| 视频笔记 | 西瓜播放器把「00:00 倍速 2x 1.5x 请刷新试试」写进正文 | `drop: .player-container` |
| 正文表情 | 表情是 `<img>`，开了图床会一张张传上去 | `drop: img.note-content-emoji` |
| 话题标签 | `<a href="/search_result?...">#刘亦菲</a>`，转成 markdown 是一串点不开的相对链接 | `unwrap: a.tag` |

还有两处不是靠删能解决的：

**正文分段靠文本里的换行。** 小红书正文的段落是 `\n` 加 CSS `white-space`，HTML 里既没有
`<p>` 也没有 `<br>`。按通用规则换行只是排版空白，会被压成空格，整篇文案挤成一行。
`keepLineBreaks: ['#detail-desc']` 让这个容器里的换行转成 `<br>`，收口时再变回段落。
别的站点不要开这个：普通 HTML 里的换行确实只是排版。

**话题标签里夹着 `[eoi]`。** 页面上渲染成一个小图标，取 `textContent` 就露出来了，
`#披荆斩棘的哥哥[eoi]#`。它和正文 `<span>` 长得一模一样，选择器区分不了，只能按文本抹掉
（`stripText: [/\[eoi\]/g]`）。

**图片地址不要改。** URL 长这样：

```
https://sns-webpic-qc.xhscdn.com/<时间戳>/<hash>/notes_pre_post/<id>!nd_dft_wlteh_webp_3
```

结尾那段是图片处理参数，横图是 `wgth` 竖图是 `wlteh`。实测换成别的参数、或者去掉整段，
一律 403，签名是绑参数的，只有页面上给的那一个能用。

路径里那段 `202608201652` 是签发时间：**每次重新打开笔记页，同一张图拿到的 URL 都不一样**
（隔 18 分钟再开就变成了 `202608201710`）。旧那条 18 分钟后仍然能取，更长的时效没验证。
这种地址不适合长期躺在笔记里，要留着建议开图床转存。

不需要 Referer（和微博相反），完整 URL 裸请求就是 200。

## 验证过但不需要专用规则的站点

通用启发式直接能用，没写规则：

| 站点 | 说明 |
|------|------|
| 普通博客 / 文档站 | `<article>`、`main`、`.post-content` 这类语义容器一抓一个准 |

（这张表还很空，遇到一个验一个往里加。）

## 只配了标签的域名

`lib/domains.js` 里还有一批域名映射（知乎、B 站、豆瓣、掘金、少数派、V2EX、GitHub、
Medium、Reddit、HackerNews 等）。它们只影响**标签**叫什么，不代表正文提取验证过。
实际抓过并确认无误之后，再挪进上面的[兼容域名](#兼容域名)清单。

## 两张表

两张表分别对应两件事，改的时候别改错文件：

| 表 | 真源 | 管什么 |
|----|------|--------|
| 提取规则 | `lib/site-rules.js` | 正文 / 作者 / 时间在页面哪个元素 |
| 标签映射 | `lib/domains.js` | 域名转成什么标签（`mp.weixin.qq.com` → `公众号`） |

## 加一个新站点

1. 先看通用逻辑够不够：

   ```bash
   node tools/probe.mjs "<url>"
   ```

   `probe.mjs` 要 Node 22+（全局 `fetch` 和 `WebSocket`），版本不够会直接报出来。

   `root` 和 `mdLen` 合理就不用写规则，直接记到「验证过但不需要专用规则」那张表。

2. 抓不对就看正文到底在哪：

   ```bash
   node tools/probe.mjs "<url>" --dump
   ```

   列出页面里文字量最大的容器。两者对不上是选容器的问题，选对了但 `mdLen` 很小是被
   噪声过滤误删了。

3. 往 `lib/site-rules.js` 加一条。字段都是可选的，只写通用逻辑搞不定的那几项：

   ```js
   {
     name: '站点名',
     hosts: ['example.com'],        // 子域自动继承
     root: '.article-body',         // 也可以传一组选择器
     author: '.byline',
     published: 'time.published',
     titleFromBody: true,           // 站点没有标题时用
     normalizePublished: (t) => t,  // 时间格式怪的时候用
     drop: ['.ad-slot'],            // 规则级的额外删除项
     title: '.post-title',          // 标题不在 og:title 里，或者 og:title 带站点名后缀
     rewriteImageSrc: (src) => src, // 改图片地址（缩略图换原图之类）
     imageReferer: 'https://example.com/',  // 图片站点要防盗链 Referer 时用
     imageHosts: ['img.example.com'],       // 上面那个 Referer 补给哪些域名
     unwrap: ['a.tag'],             // 只要文字不要链接，元素本身脱掉
     stripText: [/\[eoi\]/g],        // 按文本抹掉图标占位这类脏字符
     keepLineBreaks: ['.desc'],     // 正文分段靠 \n + CSS 时才开
   }
   ```

   字段都是可选的。`title` / `titleFromBody` 可以一起写：优先用选择器，取不到再退回
   正文开头（小红书的笔记有的有标题有的没有，就靠这个组合）。

   `root` 传数组时是**并集**：命中的块按顺序拼成一个容器。互相嵌套的只留最外层，
   所以「主选择器 + 兜底选择器」这种写法不会把正文收两遍。

4. 需要新标签就再改 `lib/domains.js`。

5. 跑一遍测试，再回来更新这份文档：

   ```bash
   node --test "tests/*.test.mjs"
   ```

## 注意

`lib/extract.js` 依赖 `lib/site-rules.js`，而 `extract.js` 是注入到页面里动态 `import()` 的。
拆出新模块时记得同步加进 `manifest.json` 的 `web_accessible_resources`，否则页面取不到文件，
扩展直接报 `ReferenceError`。
