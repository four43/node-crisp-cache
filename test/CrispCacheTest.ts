import * as assert from 'assert';
import * as seed from 'random-seed';
import * as sinon from 'sinon';
import CrispCache from "../src/main";
import {CrispCacheConstructOptions} from "../src/main";
import SinonFakeTimers = Sinon.SinonFakeTimers;
import SinonSpy = Sinon.SinonSpy;
import {ErrorFirstValueCallback} from "../src/main";

const data: ({[id: string]: any}) = {
	hello: "world",
	foo: "bar",
	arr: [1, 2, 3],
	hash: {key: "value", nested: [4, 5, 6]}
};
function fetcher(key: string, callback: {(err: Error|null, value: any): void}) {
	setTimeout(function () {
		return callback(null, data[key]);
	}, 1);
}

describe("CrispCache", function () {
	describe("Setup Sanity", function () {
		it("Should complain if we have no fetcher", function () {
			assert.throws(
				// Explicitly force options to be cast, avoid compile time check
				() => new CrispCache(<CrispCacheConstructOptions<string>>{}),
				"Should complain that we don't have a fetcher!"
			);
		});
	});

	describe("Get - Basic", function () {

		let clock: SinonFakeTimers;
		let crispCacheBasic: CrispCache<any>;
		let fetcherSpy: SinonSpy;

		beforeEach(function () {
			fetcherSpy = sinon.spy(fetcher);
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

		it("Should fetch a key", function (done) {
			crispCacheBasic.get('hello', (err: Error, value: any) => {
				assert.equal(err, null);
				assert.equal(value, 'world');
				done();
			});
		});

		it("Should not fetch a missing key", function (done) {
			crispCacheBasic.get('hello', {skipFetch: true}, function (err, value) {
				assert.equal(err, null);
				assert.equal(value, undefined);
				assert.equal(fetcherSpy.callCount, 0);
				done();
			});
		});

		it("Should fetch a key from cache", function (done) {
			crispCacheBasic.get('hello', function (err, value) {
				assert.equal(err, null);
				assert.equal(value, 'world');
				crispCacheBasic.get('hello', function (err, value) {
					assert.equal(value, 'world');
					assert.ok(fetcherSpy.calledOnce);
					done();
				});
			});
		});

		it("Should fetch a stale key", function (done) {
			clock = sinon.useFakeTimers();
			crispCacheBasic.get('hello', function (err, value) {
				assert.equal(err, null);
				assert.equal(value, 'world');
				clock.tick(301);
				crispCacheBasic.get('hello', function (err, value) {
					assert.equal(err, null);
					assert.equal(value, 'world');
					assert.equal(fetcherSpy.callCount, 1);
					done();
				});
				clock.tick(10);
			});
			clock.tick(10);
		});

		it("Should re-fetch an expired key", function (done) {
			clock = sinon.useFakeTimers();
			crispCacheBasic.get('hello', function (err, value) {
				assert.equal(err, null);
				assert.equal(value, 'world');
				clock.tick(1000);
				crispCacheBasic.get('hello', function (err, value) {
					assert.equal(err, null);
					assert.equal(value, 'world');
					assert.equal(fetcherSpy.callCount, 2);
					done();
				});
				clock.tick(10);
			});
			clock.tick(10);
		});

		it("Should not re-fetch an expired key", function (done) {
			clock = sinon.useFakeTimers();
			crispCacheBasic.get('hello', function (err, value) {
				assert.equal(err, null);
				assert.equal(value, 'world');
				clock.tick(1000);
				crispCacheBasic.get('hello', {skipFetch: true}, function (err, value) {
					assert.equal(err, null);
					assert.equal(value, undefined);
					assert.equal(fetcherSpy.callCount, 1);
					done();
				});
				clock.tick(10);
			});
			clock.tick(10);
		});



	});
});