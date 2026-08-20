import test from 'node:test';
import assert from 'node:assert/strict';

import { htmlToMarkdown, normalizeMarkdown } from '../lib/html2md.js';
import { el } from './fake-dom.mjs';

test('标题按层级转成 # 前缀', () => {
	const root = el('div', {}, [el('h1', {}, ['大标题']), el('h3', {}, ['小标题'])]);
	assert.equal(htmlToMarkdown(root), '# 大标题\n\n### 小标题');
});

test('段落之间留一个空行，行内标记就地转换', () => {
	const root = el('div', {}, [
		el('p', {}, ['前', el('strong', {}, ['粗']), '后']),
		el('p', {}, [el('em', {}, ['斜']), el('del', {}, ['删'])]),
	]);
	assert.equal(htmlToMarkdown(root), '前**粗**后\n\n*斜*~~删~~');
});

test('链接保留 href，锚点和 javascript: 退成纯文本', () => {
	const root = el('p', {}, [
		el('a', { href: 'https://example.com/a' }, ['正常']),
		el('a', { href: '#top' }, ['锚点']),
		el('a', { href: 'javascript:void(0)' }, ['脚本']),
	]);
	assert.equal(htmlToMarkdown(root), '[正常](https://example.com/a)锚点脚本');
});

test('懒加载图片取 data-src，占位的 data: URI 不算', () => {
	const root = el('p', {}, [
		el('img', { src: 'data:image/gif;base64,R0lGOD', 'data-src': 'https://cdn/x.jpg', alt: '图 说' }),
	]);
	assert.equal(htmlToMarkdown(root), '![图 说](https://cdn/x.jpg)');
});

test('无 src 的图片直接丢掉', () => {
	assert.equal(htmlToMarkdown(el('p', {}, [el('img', { alt: '空' })])), '');
});

test('有序列表沿用 start，子列表按父级 marker 宽度缩进', () => {
	const root = el('ol', { start: '3' }, [
		el('li', {}, ['第一项']),
		el('li', {}, ['第二项', el('ul', {}, [el('li', {}, ['子项'])])]),
	]);
	// 父级 marker 是 "4. "（3 字符），子列表就缩 3 格
	assert.equal(htmlToMarkdown(root), '3. 第一项\n4. 第二项\n   - 子项');
});

test('无序列表嵌套逐层缩 2 格', () => {
	const root = el('ul', {}, [
		el('li', {}, ['一层', el('ul', {}, [el('li', {}, ['二层', el('ul', {}, [el('li', {}, ['三层'])])])])]),
	]);
	assert.equal(htmlToMarkdown(root), '- 一层\n  - 二层\n    - 三层');
});

test('列表内的 li 不会被外层重复收走', () => {
	const root = el('ul', {}, [el('li', {}, ['A', el('ul', {}, [el('li', {}, ['A1'])])])]);
	// A1 只能出现一次，出现两次说明 collect 钻进了子列表
	assert.equal(htmlToMarkdown(root).match(/A1/g).length, 1);
});

test('pre 保留原始换行并带上语言标记', () => {
	const root = el('pre', { class: 'language-python' }, [el('code', {}, ['a = 1\nb = 2\n'])]);
	assert.equal(htmlToMarkdown(root), '```python\na = 1\nb = 2\n```');
});

test('行内 code 里自带反引号时用双反引号包', () => {
	const root = el('p', {}, [el('code', {}, ['a `b` c'])]);
	assert.equal(htmlToMarkdown(root), '`` a `b` c ``');
});

test('引用块每行加 >，空行只留 >', () => {
	const root = el('blockquote', {}, [el('p', {}, ['第一段']), el('p', {}, ['第二段'])]);
	assert.equal(htmlToMarkdown(root), '> 第一段\n>\n> 第二段');
});

test('表格转成管道表，单元格里的竖线转义', () => {
	const root = el('table', {}, [
		el('tbody', {}, [
			el('tr', {}, [el('th', {}, ['列A']), el('th', {}, ['列B'])]),
			el('tr', {}, [el('td', {}, ['a|b']), el('td', {}, ['c'])]),
		]),
	]);
	assert.equal(htmlToMarkdown(root), '| 列A | 列B |\n| --- | --- |\n| a\\|b | c |');
});

test('行数不齐的表格补空单元格', () => {
	const root = el('table', {}, [
		el('tr', {}, [el('th', {}, ['A']), el('th', {}, ['B'])]),
		el('tr', {}, [el('td', {}, ['只有一格'])]),
	]);
	assert.equal(htmlToMarkdown(root), '| A | B |\n| --- | --- |\n| 只有一格 |   |');
});

test('回归：没有 <p> 的 div/section 排版要分段，不能拼成一整行', () => {
	// 公众号、知乎大量用 section 排版，全文一个 <p> 都没有
	const root = el('div', {}, [
		el('section', {}, ['第一段']),
		el('section', {}, ['第二段']),
		el('div', {}, [el('span', {}, ['第三段'])]),
	]);
	assert.equal(htmlToMarkdown(root), '第一段\n\n第二段\n\n第三段');
});

test('还有块级子元素的 div 只当容器透传，不额外制造空行', () => {
	const root = el('div', {}, [el('div', {}, [el('h2', {}, ['标题']), el('p', {}, ['正文'])])]);
	assert.equal(htmlToMarkdown(root), '## 标题\n\n正文');
});

test('div 里混着行内元素时整块算一段', () => {
	const root = el('div', {}, [
		el('div', {}, ['前', el('strong', {}, ['粗']), el('a', { href: 'https://a.b' }, ['链接'])]),
		el('div', {}, ['下一段']),
	]);
	assert.equal(htmlToMarkdown(root), '前**粗**[链接](https://a.b)\n\n下一段');
});

test('script / style / iframe 整棵丢掉', () => {
	const root = el('div', {}, [
		el('script', {}, ['var evil = 1']),
		el('style', {}, ['p{color:red}']),
		el('iframe', { src: 'https://ad' }, ['广告']),
		el('p', {}, ['正文']),
	]);
	assert.equal(htmlToMarkdown(root), '正文');
});

test('文本节点里的连续空白压成一个空格', () => {
	const root = el('p', {}, ['前   \n   后']);
	assert.equal(htmlToMarkdown(root), '前 后');
});

test('normalizeMarkdown 保留硬换行的两个尾空格', () => {
	assert.equal(normalizeMarkdown('a  \nb   \nc \n'), 'a  \nb  \nc');
});

test('空输入不炸', () => {
	assert.equal(htmlToMarkdown(null), '');
	assert.equal(htmlToMarkdown(el('div')), '');
});

test('回归：<br><br> 造出的「只有空格的行」要当空行，收成段落间隔', () => {
	const root = el('div', {}, ['第一段', el('br'), el('br'), '第二段']);
	assert.equal(htmlToMarkdown(root), '第一段\n\n第二段');
});

test('单个 <br> 仍然是 markdown 硬换行', () => {
	const root = el('div', {}, ['上行', el('br'), '下行']);
	assert.equal(htmlToMarkdown(root), '上行  \n下行');
});
