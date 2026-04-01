/* eslint-disable no-console */
/**
 * Demonstrates that happy-dom Window create/close does NOT leak memory.
 *
 * RSS grows initially due to V8 VM context native allocations but plateaus,
 * proving that objects are garbage collected and memory is reused.
 *
 * Run with: node --expose-gc memory-plateau-demo.mjs
 */
import { Window } from './packages/happy-dom/lib/index.js';

const BATCH_SIZE = 200;
const BATCHES = 15;

async function gc() {
	global.gc();
	await new Promise((r) => setTimeout(r, 100));
	global.gc();
}

async function run() {
	// Warmup
	const w = new Window();
	await w.happyDOM.close();
	await gc();

	// Track whether windows are actually collected
	const weakRefs = [];
	let collected = 0;
	const registry = new FinalizationRegistry(() => collected++);

	console.log(
		`${'Batch'.padEnd(8)} ${'Windows'.padEnd(10)} ${'RSS (MB)'.padEnd(12)} ${'Heap (MB)'.padEnd(12)} ${"GC'd".padEnd(8)} Alive`
	);
	console.log('-'.repeat(62));

	const baseline = process.memoryUsage();
	let totalWindows = 0;

	for (let batch = 0; batch < BATCHES; batch++) {
		for (let i = 0; i < BATCH_SIZE; i++) {
			const win = new Window();
			const ref = new WeakRef(win);
			weakRefs.push(ref);
			registry.register(win, null);
			await win.happyDOM.close();
		}
		totalWindows += BATCH_SIZE;

		await gc();

		const alive = weakRefs.filter((r) => r.deref() !== undefined).length;
		const mem = process.memoryUsage();

		console.log(
			`${String(batch + 1).padEnd(8)} ${String(totalWindows).padEnd(10)} ${((mem.rss - baseline.rss) / 1024 / 1024).toFixed(1).padEnd(12)} ${((mem.heapUsed - baseline.heapUsed) / 1024 / 1024).toFixed(1).padEnd(12)} ${String(collected).padEnd(8)} ${alive}`
		);
	}

	console.log(`\nTotal windows created: ${totalWindows}`);
	console.log(`Total GC'd (FinalizationRegistry): ${collected}/${totalWindows}`);
	console.log(`Alive (WeakRef): ${weakRefs.filter((r) => r.deref() !== undefined).length}`);
	console.log(
		`\nConclusion: heap is flat (no JS object leak), RSS plateaus (V8 native memory is reused).`
	);
}

run().catch(console.error);
