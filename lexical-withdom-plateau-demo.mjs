/* eslint-disable no-console, no-undef, jsdoc/require-returns, jsdoc/require-param-type, jsdoc/require-param-description */
/**
 * Demonstrates that lexical's withDOM() pattern does NOT leak JS objects
 * from happy-dom, provided the Window is properly closed.
 *
 * The current withDOM() calls window.close() which is a no-op for directly
 * constructed Windows. The correct cleanup is window.happyDOM.close().
 *
 * Run with: node --expose-gc lexical-withdom-plateau-demo.mjs
 */
import { Window } from './packages/happy-dom/lib/index.js';
import { createHeadlessEditor } from '@lexical/headless';
import { $getRoot, $createParagraphNode, $createTextNode } from 'lexical';

const BATCH_SIZE = 200;
const BATCHES = 15;

async function gc() {
	global.gc();
	await new Promise((r) => setTimeout(r, 100));
	global.gc();
}

/**
 * Reimplementation of withDOM that properly closes the Window.
 * @param f
 */
function withDOMFixed(f) {
	const prevWindow = globalThis.window;
	if (prevWindow) {
		return f(globalThis.window);
	}
	const prevComputedStyle = globalThis.getComputedStyle;
	const prevDOMParser = globalThis.DOMParser;
	const prevMutationObserver = globalThis.MutationObserver;
	const prevDocument = globalThis.document;
	const newWindow = new Window();
	globalThis.window = newWindow;
	globalThis.document = newWindow.document;
	globalThis.MutationObserver = newWindow.MutationObserver;
	globalThis.DOMParser = newWindow.DOMParser;
	globalThis.getComputedStyle = newWindow.getComputedStyle;
	try {
		return f(newWindow);
	} finally {
		globalThis.getComputedStyle = prevComputedStyle;
		globalThis.DOMParser = prevDOMParser;
		globalThis.MutationObserver = prevMutationObserver;
		globalThis.document = prevDocument;
		globalThis.window = prevWindow;
		// window.close() is a no-op for directly constructed Windows.
		// happyDOM.close() is the proper destructor, but it is async.
		// For a synchronous API like withDOM, we can call abort() + close()
		// to trigger synchronous cleanup via the destroy() path.
		newWindow.happyDOM.close();
	}
}

/**
 * Broken version (current withDOM behavior) — calls window.close() which is a no-op.
 * @param f
 */
function withDOMBroken(f) {
	const prevWindow = globalThis.window;
	if (prevWindow) {
		return f(globalThis.window);
	}
	const prevComputedStyle = globalThis.getComputedStyle;
	const prevDOMParser = globalThis.DOMParser;
	const prevMutationObserver = globalThis.MutationObserver;
	const prevDocument = globalThis.document;
	const newWindow = new Window();
	globalThis.window = newWindow;
	globalThis.document = newWindow.document;
	globalThis.MutationObserver = newWindow.MutationObserver;
	globalThis.DOMParser = newWindow.DOMParser;
	globalThis.getComputedStyle = newWindow.getComputedStyle;
	try {
		return f(newWindow);
	} finally {
		globalThis.getComputedStyle = prevComputedStyle;
		globalThis.DOMParser = prevDOMParser;
		globalThis.MutationObserver = prevMutationObserver;
		globalThis.document = prevDocument;
		globalThis.window = prevWindow;
		newWindow.close(); // <-- no-op for directly constructed Windows!
	}
}

function doWork(withDOMFn, weakRefs, registry) {
	withDOMFn((window) => {
		weakRefs.push(new WeakRef(window));
		registry.register(window, null);

		const editor = createHeadlessEditor({
			onError: (e) => {
				throw e;
			}
		});

		editor.update(
			() => {
				const root = $getRoot();
				const paragraph = $createParagraphNode();
				paragraph.append($createTextNode('Hello from SSR'));
				root.append(paragraph);
			},
			{ discrete: true }
		);

		let html = '';
		editor.read(() => {
			html = $getRoot().getTextContent();
		});
		return html;
	});
}

async function runTest(label, withDOMFn) {
	const weakRefs = [];
	let collected = 0;
	const registry = new FinalizationRegistry(() => collected++);

	// Warmup
	doWork(withDOMFn, [], new FinalizationRegistry(() => {}));
	await gc();

	console.log(`\n=== ${label} ===`);
	console.log(
		`${'Batch'.padEnd(8)} ${'Calls'.padEnd(10)} ${'RSS (MB)'.padEnd(12)} ${'Heap (MB)'.padEnd(12)} ${"GC'd".padEnd(8)} Alive`
	);
	console.log('-'.repeat(62));

	const baseline = process.memoryUsage();
	let totalCalls = 0;

	for (let batch = 0; batch < BATCHES; batch++) {
		for (let i = 0; i < BATCH_SIZE; i++) {
			doWork(withDOMFn, weakRefs, registry);
		}
		totalCalls += BATCH_SIZE;

		await gc();

		const alive = weakRefs.filter((r) => r.deref() !== undefined).length;
		const mem = process.memoryUsage();

		console.log(
			`${String(batch + 1).padEnd(8)} ${String(totalCalls).padEnd(10)} ${((mem.rss - baseline.rss) / 1024 / 1024).toFixed(1).padEnd(12)} ${((mem.heapUsed - baseline.heapUsed) / 1024 / 1024).toFixed(1).padEnd(12)} ${String(collected).padEnd(8)} ${alive}`
		);
	}

	console.log(`\nTotal calls: ${totalCalls}`);
	console.log(`GC'd: ${collected}/${totalCalls}`);
	console.log(`Alive: ${weakRefs.filter((r) => r.deref() !== undefined).length}`);
}

async function run() {
	await runTest('withDOM using happyDOM.close() (fixed)', withDOMFixed);
	await runTest('withDOM using window.close() (broken — current lexical behavior)', withDOMBroken);
}

run().catch(console.error);
