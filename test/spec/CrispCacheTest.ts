import * as assert from 'assert';
import * as seed from 'random-seed';
import * as sinon from 'sinon';
import CrispCache from "../../src/main";
import {CrispCacheConstructOptions} from "../../src/main";
import SinonFakeTimers = Sinon.SinonFakeTimers;
import SinonSpy = Sinon.SinonSpy;

const data: ({[id: string]: any}) = {
	hello: "world",
	foo: "bar",
	arr: [1, 2, 3],
	hash: {key: "value", nested: [4, 5, 6]}
};

function fetcher(key: string): Promise<any> {
	return new Promise((res) => {
		setTimeout(() => {
			return res(data[key]);
		}, 1);
	});
}

function fetcherCb(key: string, callback: {(err: Error|null, value: any): void}) {
	setTimeout(() => {
		return callback(null, data[key]);
	}, 1);
}

describe("CrispCache", function () {
	describe("Setup Sanity", function () {
		it("Should complain if we have no fetcherCb", function () {
			assert.throws(
				// Explicitly force options to be cast, avoid compile time check
				() => new CrispCache(<CrispCacheConstructOptions<string>>{}),
				"Should complain that we don't have a fetcherCb!"
			);
		});
	});

	describe("Get - Basic (Promise based fetcher)", function () {

		let clock: SinonFakeTimers;
		let crispCacheBasic: CrispCache<any>;
		let fetcherSpy: SinonSpy;

		beforeEach(function () {
			fetcherSpy = sinon.spy(fetcher);
			crispCacheBasic = new CrispCache<any>({
				fetcher: fetcherSpy,
				maxSize: Infinity,
				defaultTtls: {
					stale: 3,
					expires: 5
				}
			})
		});

		afterEach(function () {
			if (clock) {
				clock.restore();
			}
		});

		it("Should fetch a key", async(): Promise<void> => {
			const value = await crispCacheBasic.get('hello');
			assert.equal(value, 'world');
		});

		it("Should fetch a key (callback)", (done) => {
			crispCacheBasic.get('hello', (err: Error, value: any) => {
				assert.equal(err, null);
				assert.equal(value, 'world');
				done();
			});
		});

		it("Should not fetch a missing key", async(): Promise<void> => {
			const value = await crispCacheBasic.get('hello', {skipFetch: true});
			assert.equal(value, undefined);
			assert.equal(fetcherSpy.callCount, 0);
		});

		it("Should not fetch a missing key (callback)", (done) => {
			crispCacheBasic.get('hello', {skipFetch: true}, (err: Error, value: any) => {
				assert.equal(err, null);
				assert.equal(value, undefined);
				assert.equal(fetcherSpy.callCount, 0);
				done();
			});
		});

		it("Should fetch a key from cache", async(): Promise<void> => {
			const value = await crispCacheBasic.get('hello');
			assert.equal(value, 'world');
			const value2 = await crispCacheBasic.get('hello');
			assert.equal(value2, 'world');
			assert.ok(fetcherSpy.calledOnce);
		});

		it("Should fetch a key from cache (callback)", (done) => {
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

		it("Should fetch a stale key", async(): Promise<void> => {
			const value = await crispCacheBasic.get('hello');
			assert.equal(value, 'world');
			await new Promise(res => setTimeout(res, 4));
			const value2 = await crispCacheBasic.get('hello');
			assert.equal(value2, 'world');
			assert.equal(fetcherSpy.callCount, 1);
		});

		it("Should re-fetch an expired key", async(): Promise<void> => {
			const value = await crispCacheBasic.get('hello');
			assert.equal(value, 'world');
			await new Promise(res => setTimeout(res, 6));
			const value2 = await crispCacheBasic.get('hello');
			assert.equal(value2, 'world');
			assert.equal(fetcherSpy.callCount, 2);
		});

	});

	describe("Get - Basic (Callback based fetcher)", function () {

		let clock: SinonFakeTimers;
		let crispCacheBasic: CrispCache<any>;
		let fetcherSpy: SinonSpy;

		beforeEach(function () {
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

		afterEach(function () {
			if (clock) {
				clock.restore();
			}
		});

		it("Should fetch a key", async(): Promise<void> => {
			const value = await crispCacheBasic.get('hello');
			assert.equal(value, 'world');
		});

		it("Should fetch a key (callback)", function (done) {
			crispCacheBasic.get('hello', (err: Error, value: any) => {
				assert.equal(err, null);
				assert.equal(value, 'world');
				done();
			});
		});

		it("Should not fetch a missing key", function (done) {
			crispCacheBasic.get('hello', {skipFetch: true}, (err: Error, value: any) => {
				assert.equal(err, null);
				assert.equal(value, undefined);
				assert.equal(fetcherSpy.callCount, 0);
				done();
			});
		});

		it("Should fetch a key from cache", function (done) {
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
	});
})
;