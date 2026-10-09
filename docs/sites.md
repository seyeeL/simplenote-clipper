# 站点兼容清单

这个扩展走默认规则提取正文，大部分文章页不用配置就能抓。提取逻辑和站点规则在独立仓库
[web-extract](https://github.com/seyeeL/web-extract)，每个站点**怎么取、实测过哪些页面、踩过什么坑**
都记在它的 [docs/sites.md](https://github.com/seyeeL/web-extract/blob/main/docs/sites.md)。
这里只记扩展这一侧的事。

## 兼容域名

写了专用规则、并且实测通过的站点（链接指向 web-extract 里的细节）：

1. **[微信公众号](https://github.com/seyeeL/web-extract/blob/main/docs/sites.md#微信公众号)** `mp.weixin.qq.com`：
   普通图文、纯文字分享、贴图型（图片消息）三种版式，正文、配图、作者、时间全部通过。
2. **[微博](https://github.com/seyeeL/web-extract/blob/main/docs/sites.md#微博)** `weibo.com`、`weibo.cn`：
   正文、作者、时间、九宫格配图全部通过。
3. **[小红书](https://github.com/seyeeL/web-extract/blob/main/docs/sites.md#小红书)** `xiaohongshu.com`：
   正文、作者、时间、九宫格配图全部通过；**要登录态**（扩展跑在你自己的浏览器里，不受影响）。
4. **[X（推特）](https://github.com/seyeeL/web-extract/blob/main/docs/sites.md#x推特)** `x.com`、`twitter.com`：
   推文正文、配图、视频封面、引用推文、作者、时间全部通过；剪的是你点开的那一条，
   回复默认一起剪（popup 里「同时剪藏评论」可以取消），互动数字不进笔记。

`lib/domains.js` 里另有[二十来个域名只配了标签](#只配了标签的域名)，提取没验证过，别当成支持。

## 各站点的标签

设置页勾了「域名来源」时打上的标签（默认不打）：

| 站点 | 标签 |
|------|------|
| 微信公众号 | `公众号` |
| 微博 | `微博` |
| 小红书 | `小红书` |
| X（推特） | `推特` |

## 只配了标签的域名

`lib/domains.js` 里还有一批域名映射（知乎、B 站、豆瓣、掘金、少数派、V2EX、GitHub、
Medium、Reddit、HackerNews 等）。它们只影响**标签**叫什么，不代表正文提取验证过。
实际抓过并确认无误之后，再挪进上面的[兼容域名](#兼容域名)清单。

## 两张表

两张表分别对应两件事，改的时候别改错地方：

| 表 | 真源 | 管什么 |
|----|------|--------|
| 提取规则 | web-extract 的 `src/site-rules.js`（这里的 `lib/site-rules.js` 是副本） | 正文 / 作者 / 时间在页面哪个元素 |
| 标签映射 | `lib/domains.js` | 域名转成什么标签（`mp.weixin.qq.com` → `公众号`） |

## 加一个新站点

1. 在 web-extract 里按它的[加一个新站点](https://github.com/seyeeL/web-extract/blob/main/docs/sites.md#加一个新站点)
   写规则、补测试、提交。
2. 回到这里同步副本：

   ```bash
   npm run sync:web-extract
   ```

3. 需要新标签就再改 `lib/domains.js`，把站点加进上面的清单。
4. 跑一遍测试：

   ```bash
   npm ci
   npm test
   ```

## 注意

`lib/extract.js` 依赖 `lib/site-rules.js`，而 `extract.js` 是注入到页面里动态 `import()` 的。
web-extract 那边新增了被 `extract.js` 依赖的模块时，同步脚本的 `FILES` 和 `manifest.json` 的
`web_accessible_resources` 要一起加，否则页面取不到文件，扩展直接报 `ReferenceError`
（`tests/vendor.test.mjs` 会检查副本都在 `web_accessible_resources` 里）。
