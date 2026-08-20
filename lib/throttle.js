// 请求节流。纯逻辑，不碰 DOM，node --test 可直接跑。
//
// 只靠「请求进行中禁用按钮」挡不住连点：请求一返回按钮立刻又能按，
// 几下就撞上服务端限流。这里同时管两件事 —— 有请求在飞就不放行，
// 上一次请求结束不到间隔时间也不放行。

/**
 * @param {number} minIntervalMs 两次请求之间的最小间隔
 */
export function createRequestGate(minIntervalMs) {
	let inFlight = false;
	let lastFinishedAt = -Infinity;

	return {
		/** 能不能发这次请求。返回 true 表示已占住闸门，调用方必须配对调用 release()。 */
		tryAcquire(now = Date.now()) {
			if (inFlight) return false;
			if (now - lastFinishedAt < minIntervalMs) return false;
			inFlight = true;
			return true;
		},

		/** 请求结束（成功失败都算），从这一刻开始计间隔。 */
		release(now = Date.now()) {
			inFlight = false;
			lastFinishedAt = now;
		},

		/** 还要等多少毫秒才能再发。用于给出「稍等」提示。 */
		waitMs(now = Date.now()) {
			if (inFlight) return minIntervalMs;
			return Math.max(0, minIntervalMs - (now - lastFinishedAt));
		},
	};
}
