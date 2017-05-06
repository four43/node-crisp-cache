import * as assert from 'assert';
import * as sinon from 'sinon';
import CrispCache from "../../src/main";
import {CrispCacheConstructOptions} from "../../src/main";
import SinonFakeTimers = sinon.SinonFakeTimers;
import SinonSpy = sinon.SinonSpy;
import FetcherError from "../Mock/FetcherError";
import {isNullOrUndefined} from "util";

const data: ({ [id: string]: any }) = {
	hello: "world",
	foo: "bar",
	arr: [1, 2, 3],
	hash: {key: "value", nested: [4, 5, 6]}
};

async function fetcher(key: string): Promise<any> {
	await wait(1);
	return data[key];
}

async function slowFetcher(key: string): Promise<any> {
	await wait(100);
	return data[key];
}

function fetcherCb(key: string, callback: { (err: Error | null, value: any): void }) {
	setTimeout(() => {
		return callback(null, data[key]);
	}, 1);
}

let eventSpies: { [id: string]: SinonSpy };

describe("CrispCache", () => {
	describe("Setup Sanity", () => {
		it("should complain if we have no fetcherCb", () => {
			assert.throws(
				// Explicitly force options to be cast, avoid compile time check
				() => new CrispCache(<CrispCacheConstructOptions<string>>{}),
				"should complain that we don't have a fetcherCb!"
			);
		});
	});

	describe("Get - Basic (Promise based fetcher)", () => {

		let crispCacheBasic: CrispCache<any>;
		let fetcherSpy: SinonSpy;

		beforeEach(() => {
			fetcherSpy = sinon.spy(fetcher);
			crispCacheBasic = new CrispCache<any>({
				fetcher: fetcherSpy,
				maxSize: Infinity,
				defaultTtls: {
					stale: 3,
					expires: 5
				}
			});

			eventSpies = setupEvents(crispCacheBasic);
		});

		it("should fetch a key", async () => {
			const value = await crispCacheBasic.get('hello');
			assert.equal(value, 'world');

			// Event Checking
			eventCheck('hit', 0);
			eventCheck('miss', 1);
			eventCheck('fetch', 1);
		});

		it("should fetch a key (callback)", (done) => {
			crispCacheBasic.get('hello', (err: Error, value: any) => {
				assert.equal(err, null);
				assert.equal(value, 'world');
				done();
			});
		});

		it("should not fetch a missing key", async () => {
			const value = await crispCacheBasic.get('hello', {skipFetch: true});
			assert.equal(value, undefined);
			assert.equal(fetcherSpy.callCount, 0);

			// Event Checking
			eventCheck('hit', 0);
			eventCheck('miss', 1);
			eventCheck('fetch', 0);
		});

		it("should not fetch a missing key (callback)", (done) => {
			crispCacheBasic.get('hello', {skipFetch: true}, (err: Error, value: any) => {
				assert.equal(err, null);
				assert.equal(value, undefined);
				assert.equal(fetcherSpy.callCount, 0);
				done();
			});
		});

		it("should fetch a key from cache", async () => {
			const value = await crispCacheBasic.get('hello');
			assert.equal(value, 'world');
			const value2 = await crispCacheBasic.get('hello');
			assert.equal(value2, 'world');
			assert.ok(fetcherSpy.calledOnce);

			// Event Checking
			eventCheck('hit', 1);
			eventCheck('miss', 1);
			eventCheck('fetch', 1);
		});

		it("should fetch a key from cache (callback)", (done) => {
			crispCacheBasic.get('hello', (err, value) => {
				assert.equal(err, null);
				assert.equal(value, 'world');
				crispCacheBasic.get('hello', (err, value) => {
					assert.equal(value, 'world');
					assert.ok(fetcherSpy.calledOnce);
					done();
				});
			});
		});

		it("should fetch a stale key", async () => {
			const value = await crispCacheBasic.get('hello');
			assert.equal(value, 'world');
			await wait(4);
			const value2 = await crispCacheBasic.get('hello');
			assert.equal(value2, 'world');
			assert.equal(fetcherSpy.callCount, 1);

			// Event Checking
			eventCheck('hit', 1);
			eventCheck('miss', 1);
			eventCheck('fetch', 1);
		});

		it("should re-fetch an expired key", async () => {
			const value = await crispCacheBasic.get('hello');
			assert.equal(value, 'world');
			await wait(6);
			const value2 = await crispCacheBasic.get('hello');
			assert.equal(value2, 'world');
			assert.equal(fetcherSpy.callCount, 2);

			// Event Checking
			eventCheck('hit', 0);
			eventCheck('miss', 2);
			eventCheck('fetch', 2);
		});

		it("should force re-fetch a valid key", async () => {
			const value = await crispCacheBasic.get('hello');
			assert.equal(value, 'world');
			const value2 = await crispCacheBasic.get('hello', {forceFetch: true});
			assert.equal(value2, 'world');
			assert.equal(fetcherSpy.callCount, 2);

			// Event Checking
			eventCheck('hit', 0);
			// Miss was forced by our "forceFetch"
			eventCheck('miss', 2);
			eventCheck('fetch', 2);
		});

		describe("Fetcher Errors", () => {

			let tries: number;
			let badFetcherSpy: SinonSpy;
			let crispCacheBadFetcher: CrispCache<number>;
			beforeEach(() => {
				tries = 0;

				function badFetcher() {
					return new Promise((res, rej) => {
						setTimeout(() => {
							tries++;
							if (tries > 1) {
								return rej(new FetcherError("Our local fetcher error"));
							}
							return res(tries);
						}, 1);
					})
				}

				badFetcherSpy = sinon.spy(badFetcher);
				crispCacheBadFetcher = new CrispCache<any>({
					fetcher: badFetcherSpy,
					maxSize: Infinity,
					defaultTtls: {
						stale: 3,
						expires: 5
					}
				});
			});
			it("should throw fetcher's error when encountered", async () => {
				const value1 = await crispCacheBadFetcher.get('first');
				assert.equal(value1, 1);
				await wait(10);
				try {
					await crispCacheBadFetcher.get('first');
				}
				catch (err) {
					assert.ok(err instanceof Error);
					assert.equal(err.message, 'Our local fetcher error');
					return
				}
				throw new Error("Test should have thrown an error");
			});

			it("should error in callback when fetcher's error encountered", (done) => {
				crispCacheBadFetcher.get('first', (err: Error, value: number) => {
					try {
						assert.ifError(err);
						assert.equal(value, 1);
					}
					catch (err) {
						done(err);
					}

					crispCacheBadFetcher.get('first', {forceFetch: true}, (err: Error, value: number) => {
						try {
							assert.ok(err instanceof FetcherError);
							assert.strictEqual(value, undefined);
						}
						catch (err) {
							done(err);
						}
						done();
					});
				});
			});
		});

		describe("Locking", () => {

			it("should run fetcher for 2 different keys (sanity check)", async () => {
				const req1 = crispCacheBasic.get('hello');
				const req2 = crispCacheBasic.get('foo');
				const values = await Promise.all([req1, req2]);

				assert.equal(values[0], 'world');
				assert.equal(values[1], 'bar');

				assert.equal(fetcherSpy.callCount, 2);
			});

			it("should fetch once for two requests", async () => {
				const req1 = crispCacheBasic.get('hello');
				const req2 = crispCacheBasic.get('hello');
				const values = await Promise.all([req1, req2]);

				assert.equal(values[0], 'world');
				assert.equal(values[1], 'world');

				assert.equal(fetcherSpy.callCount, 1);
			});

			it("should try again with slow fetcher", async () => {
				const slowFetcherSpy = sinon.spy(slowFetcher);
				crispCacheBasic = new CrispCache<any>({
					fetcher: slowFetcherSpy,
					fetchTimeout: 10,
					maxSize: Infinity,
					defaultTtls: {
						stale: 3000,
						expires: 5000
					}
				});

				const req1 = crispCacheBasic.get('hello');
				// Wait for fetcher to timeoutS
				await wait(50);
				const req2 = crispCacheBasic.get('hello');
				const values = await Promise.all([req1, req2]);

				assert.equal(values[0], 'world');
				assert.equal(values[1], 'world');

				assert.equal(slowFetcherSpy.callCount, 2);
			});
		});

	});

	/**
	 * Supplements "Get", just using a callback based fetcher.
	 */
	describe("Get - Basic (Callback based fetcher)", () => {

		let crispCacheBasic: CrispCache<any>;
		let fetcherSpy: SinonSpy;

		beforeEach(() => {
			fetcherSpy = sinon.spy(fetcherCb);
			crispCacheBasic = new CrispCache<any>({
				fetcher: fetcherSpy,
				maxSize: Infinity,
				defaultTtls: {
					stale: 300,
					expires: 500
				}
			})
		});

		it("should fetch a key", async () => {
			const value = await crispCacheBasic.get('hello');
			assert.equal(value, 'world');
		});

		it("should fetch a key (callback)", function (done) {
			crispCacheBasic.get('hello', (err: Error, value: any) => {
				assert.equal(err, null);
				assert.equal(value, 'world');
				done();
			});
		});

		it("should not fetch a missing key", function (done) {
			crispCacheBasic.get('hello', {skipFetch: true}, (err: Error, value: any) => {
				assert.equal(err, null);
				assert.equal(value, undefined);
				assert.equal(fetcherSpy.callCount, 0);
				done();
			});
		});

		it("should fetch a key from cache", function (done) {
			crispCacheBasic.get('hello', (err, value) => {
				assert.equal(err, null);
				assert.equal(value, 'world');
				crispCacheBasic.get('hello', (err, value) => {
					assert.equal(value, 'world');
					assert.ok(fetcherSpy.calledOnce);
					done();
				});
			});
		});

		describe("Fetcher Errors", () => {

			let tries: number;
			let badFetcherSpy: SinonSpy;
			let crispCacheBadFetcher: CrispCache<number>;
			beforeEach(() => {
				tries = 0;

				function badFetcher(key: string, cb: ((err: Error | null, value?: number) => void)) {
					setTimeout(() => {
						tries++;
						if (tries > 1) {
							return cb(new FetcherError("Fetcher error"));
						}
						return cb(null, tries);
					}, 1);
				}

				badFetcherSpy = sinon.spy(badFetcher);
				crispCacheBadFetcher = new CrispCache<any>({
					fetcher: badFetcherSpy,
					maxSize: Infinity,
					defaultTtls: {
						stale: 3,
						expires: 5
					}
				});
			});
			it("should throw fetcher's error when encountered", async () => {
				const value1 = await crispCacheBadFetcher.get('first');
				assert.equal(value1, 1);
				await wait(5);
				try {
					await crispCacheBadFetcher.get('first');
				}
				catch (err) {
					assert.ok(err instanceof FetcherError);
					return;
				}
				throw new Error("Test should have thrown an error");
			});

			it("should error in callback when fetcher's error encountered", (done) => {
				crispCacheBadFetcher.get('first', (err: Error, value: number) => {
					try {
						assert.ifError(err);
						assert.equal(value, 1);
					}
					catch (err) {
						done(err);
					}

					crispCacheBadFetcher.get('first', {forceFetch: true}, (err: Error, value: number) => {
						try {
							assert.ok(err instanceof FetcherError);
						}
						catch (err) {
							done(err);
						}
						done();
					});
				});
			});
		})
	});

	describe("Set", () => {

		let crispCacheBasic: CrispCache<any>;
		let fetcherSpy: SinonSpy;

		beforeEach(() => {
			fetcherSpy = sinon.spy(() => Promise.resolve('fetcher'));
			crispCacheBasic = new CrispCache<any>({
				fetcher: fetcherSpy,
				maxSize: Infinity,
				defaultTtls: {
					stale: 3,
					expires: 5
				}
			});

			eventSpies = setupEvents(crispCacheBasic);
		});

		it("should set a key to the cache (use default TTLs)", async () => {
			await crispCacheBasic.set("testA", "The Value");
			const value = await crispCacheBasic.get('testA');
			assert.equal(value, 'The Value');

			// Event Checking
			eventCheck('hit', 1);
			eventCheck('miss', 0);
			eventCheck('fetch', 0);
		});

		it("should skip cache with TTL of 0", async () => {
			await crispCacheBasic.set("testExpires", "The Value", {ttls: {expires: 0}});
			const value = await crispCacheBasic.get('testExpires');
			assert.equal(value, 'fetcher');

			// Event Checking
			eventCheck('hit', 0);
			eventCheck('miss', 1);
			eventCheck('fetch', 1);
		});

		it("should use stale cache", async () => {
			await crispCacheBasic.set("testExpires", "The Value", {ttls: {expires: 100, stale: 50}});
			const value = await crispCacheBasic.get('testExpires');
			await wait(60);
			const value2 = await crispCacheBasic.get('testExpires');
			assert.equal(value, 'The Value');
			assert.equal(value2, 'The Value');
			// Event Checking
			eventCheck('hit', 2);
			eventCheck('miss', 0);
			eventCheck('fetch', 0);
		});

	})

	describe("Delete", () => {

		let crispCacheBasic: CrispCache<any>;
		let fetcherSpy: SinonSpy;

		beforeEach(() => {
			fetcherSpy = sinon.spy(() => Promise.resolve('fetcher'));
			crispCacheBasic = new CrispCache<any>({
				fetcher: fetcherSpy,
				maxSize: Infinity,
				defaultTtls: {
					stale: 1000,
					expires: 5000
				}
			});

			eventSpies = setupEvents(crispCacheBasic);
		});

		it("should delete an existing key", async () => {
			await crispCacheBasic.set("testA", "Value A");
			await crispCacheBasic.set("testB", "Value B");
			await crispCacheBasic.set("testC", "Value C");

			await crispCacheBasic.delete("testB");

			const valueA = await crispCacheBasic.get('testA');
			const valueB = await crispCacheBasic.get('testB');
			const valueC = await crispCacheBasic.get('testC');

			assert.equal(valueA, 'Value A');
			// Run fetcher to get our value
			assert.equal(valueB, 'fetcher');
			assert.equal(valueC, 'Value C');

			// Event Checking
			eventCheck('hit', 2);
			eventCheck('miss', 1);
			eventCheck('fetch', 1);
		});

		it("should delete a non-existent key", async () => {
			await crispCacheBasic.set("testA", "Value A");

			await crispCacheBasic.delete("testB");

			const valueA = await crispCacheBasic.get('testA');
			const valueB = await crispCacheBasic.get('testB');

			assert.equal(valueA, 'Value A');
			// Run fetcher to get our value
			assert.equal(valueB, 'fetcher');

			// Event Checking
			eventCheck('hit', 1);
			eventCheck('miss', 1);
			eventCheck('fetch', 1);
		});
	});

	describe("Clear", () => {

		let crispCacheBasic: CrispCache<any>;
		let fetcherSpy: SinonSpy;

		beforeEach(() => {
			fetcherSpy = sinon.spy(() => Promise.resolve('fetcher'));
			crispCacheBasic = new CrispCache<any>({
				fetcher: fetcherSpy,
				maxSize: Infinity,
				defaultTtls: {
					stale: 1000,
					expires: 5000
				}
			});

			eventSpies = setupEvents(crispCacheBasic);
		});

		it("should clear all existing keys", async () => {
			await crispCacheBasic.set("testA", "Value A");
			await crispCacheBasic.set("testB", "Value B");
			await crispCacheBasic.set("testC", "Value C");

			await crispCacheBasic.clear();

			const valueA = await crispCacheBasic.get('testA');
			const valueB = await crispCacheBasic.get('testB');
			const valueC = await crispCacheBasic.get('testC');

			assert.equal(valueA, 'fetcher');
			// Run fetcher to get our value
			assert.equal(valueB, 'fetcher');
			assert.equal(valueC, 'fetcher');

			// Event Checking
			eventCheck('hit', 0);
			eventCheck('miss', 3);
			eventCheck('fetch', 3);
		});

		it("should clear empty cache", async () => {
			await crispCacheBasic.clear();

			const valueA = await crispCacheBasic.get('testA');

			assert.equal(valueA, 'fetcher');

			// Event Checking
			eventCheck('hit', 0);
			eventCheck('miss', 1);
			eventCheck('fetch', 1);
		});
	});

	describe("wrapPromise", () => {

		let baseFunction: SinonSpy;
		beforeEach(() => {
			baseFunction = sinon.spy((key:string, id: number) => Promise.resolve(`Fetched ${key} ${id}`));
		});

		it("should create cached version of provided method", async () => {
			const cachedFunc = CrispCache.wrapPromise<{(key:string, id: number):Promise<string>}>(baseFunction);

			const result = await cachedFunc('testA', 1);

			assert.equal(result, 'Fetched testA 1');
		})
	})
});

function wait(time: number): Promise<void> {
	return new Promise<void>(res => setTimeout(res, time));
}

function setupEvents(crispCache: CrispCache<any>): { [id: string]: SinonSpy } {
	const eventSpies: { [id: string]: SinonSpy } = {};
	['hit', 'miss', 'fetch', 'fetch_done', 'stale_check', 'stale_check_done', 'expires_check', 'expires_check_done']
		.map((key: string) => {
			eventSpies[key] = sinon.spy(() => { });
			crispCache.on(key, eventSpies[key]);
		});

	return eventSpies;
}

function eventCheck(event: string, callCount: number) {
	assert.equal(eventSpies[event].callCount, callCount, `Event: ${event} was only called ${eventSpies[event].callCount}, expected ${callCount}`)
}