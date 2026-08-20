import test from 'node:test';
import assert from 'node:assert/strict';

import { createRequestGate } from '../lib/throttle.js';

test('第一次直接放行', () => {
	const gate = createRequestGate(3000);
	assert.equal(gate.tryAcquire(1000), true);
});

test('请求还在飞的时候连点，多余的点击一律丢掉', () => {
	const gate = createRequestGate(3000);
	assert.equal(gate.tryAcquire(1000), true);
	// 同一毫秒里再点五下，一次都不放行
	for (let i = 0; i < 5; i += 1) assert.equal(gate.tryAcquire(1000), false);
	// 隔了很久但请求没结束，照样不放行
	assert.equal(gate.tryAcquire(999_999), false);
});

test('请求结束后不到间隔时间仍然不放行 —— 光靠禁用按钮挡不住这一段', () => {
	const gate = createRequestGate(3000);
	gate.tryAcquire(1000);
	gate.release(1500);
	assert.equal(gate.tryAcquire(1501), false);
	assert.equal(gate.tryAcquire(4499), false);
});

test('间隔够了就放行', () => {
	const gate = createRequestGate(3000);
	gate.tryAcquire(1000);
	gate.release(1500);
	assert.equal(gate.tryAcquire(4500), true);
});

test('间隔从请求结束算起，不是从发起算起', () => {
	const gate = createRequestGate(3000);
	gate.tryAcquire(0);
	// 一次很慢的请求，跑了 10 秒
	gate.release(10_000);
	assert.equal(gate.tryAcquire(11_000), false, '慢请求刚回来就该压住');
	assert.equal(gate.tryAcquire(13_000), true);
});

test('请求失败也算结束，不会把闸门永久锁死', () => {
	const gate = createRequestGate(3000);
	gate.tryAcquire(1000);
	gate.release(1200); // 调用方在 finally 里 release，成功失败都走这里
	assert.equal(gate.tryAcquire(5000), true);
});

test('waitMs 给出还要等多久，用来提示用户', () => {
	const gate = createRequestGate(3000);
	assert.equal(gate.waitMs(0), 0);
	gate.tryAcquire(1000);
	assert.equal(gate.waitMs(1000), 3000, '请求进行中按完整间隔提示');
	gate.release(1500);
	assert.equal(gate.waitMs(2500), 2000);
	assert.equal(gate.waitMs(9000), 0);
});

test('两个闸门互不影响', () => {
	const a = createRequestGate(3000);
	const b = createRequestGate(3000);
	assert.equal(a.tryAcquire(1000), true);
	assert.equal(b.tryAcquire(1000), true);
});
