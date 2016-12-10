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

	describe("Get - Basic", function () {

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

		it("Should propagate fetcherCb errors, if the cache is empty", function (done) {
			let cache = new CrispCache({
				fetcher: function (key, cb) {
					cb(new Error('fetcherCb error'));
				}
			});

			cache.get('key', function (err, value) {
				try {
					assert(err, 'cache should throw an error');
					assert.strictEqual(err.message, 'fetcherCb error', 'error message');
					done();
				}
				catch (err) {
					done(err);
				}
			});
		});

		it("Should propagate fetcherCb errors (thrown), if the cache is empty", function (done) {
			clock = sinon.useFakeTimers();
			var cache = new CrispCache({
				fetcher: function () {
					throw new Error('fetcherCb error')
				}
			});

			cache.get('key', function (err, value) {
				try {
					assert(err, 'cache should throw an error');
					assert.strictEqual(err.message, 'fetcherCb error', 'error message');
					done();
				}
				catch (err) {
					done(err);
				}
			})
		});

		it("Should propagate fetcherCb errors, if the cache is expired", function (done) {
			clock = sinon.useFakeTimers();
			var fetcher = function (key, cb) {
				cb(null, 'fetcherCb init value');
			}
			var cache = new CrispCache({
				fetcher: function (key, cb) {
					fetcher(key, cb);
				},
				defaultExpiresTtl: 100
			});

			// Grab the initial value
			cache.get('key', function (err, value) {
				try {
					assert.strictEqual(value, 'fetcherCb init value');

					// Expire the cache, then have the fetcher return an error
					clock.tick(101);
					fetcher = function (key, cb) {
						cb(new Error('fetcherCb error'));
					}

					cache.get('key', function (err, value) {
						try {
							assert.strictEqual(err && err.message, 'fetcherCb error');
							done();
						}
						catch (err) {
							done(err);
						}
					});
				}
				catch (err) {
					done(err);
				}
			});
		});

		it("Should propagate fetcherCb errors (thrown), if the cache is expired", function (done) {
			clock = sinon.useFakeTimers();
			var fetcher = function (key, cb) {
				cb(null, 'fetcherCb init value');
			}
			var cache = new CrispCache({
				fetcher: function (key, cb) {
					fetcher(key, cb);
				},
				defaultExpiresTtl: 100
			});

			// Grab the initial value
			cache.get('key', function (err, value) {
				try {
					assert.strictEqual(value, 'fetcherCb init value');

					// Expire the cache, then have the fetcher throw an error
					clock.tick(101);
					fetcher = function (key, cb) {
						throw new Error('fetcherCb error');
					}

					cache.get('key', function (err, value) {
						try {
							assert.strictEqual(err && err.message, 'fetcherCb error');
							done();
						}
						catch (err) {
							done(err);
						}
					});
				}
				catch (err) {
					done(err);
				}
			});
		});

		it("Should ignore fetcherCb errors, if the cache is stale", function (done) {
			clock = sinon.useFakeTimers();
			var fetcher = function (key, cb) {
				cb(null, 'fetcherCb init value');
			}
			var cache = new CrispCache({
				fetcher: function (key, cb) {
					fetcher(key, cb);
				},
				defaultStaleTtl: 100,
				defaultExpiresTtl: 500
			});

			// Grab the initial value
			cache.get('key', function (err, value) {
				try {
					assert.strictEqual(value, 'fetcherCb init value');

					// Expire the cache, then have the fetcher return an error
					clock.tick(101);
					fetcher = function (key, cb) {
						cb(new Error('fetcherCb error'));
					}

					cache.get('key', function (err, value) {
						try {
							assert.strictEqual(value, 'fetcherCb init value', 'should return last valid value');
							done();
						}
						catch (err) {
							done(err);
						}
					});
				}
				catch (err) {
					done(err);
				}
			});
		});

		it("Should ignore fetcherCb errors (thrown), if the cache is stale", function (done) {
			clock = sinon.useFakeTimers();
			var fetcher = function (key, cb) {
				cb(null, 'fetcherCb init value');
			}
			var cache = new CrispCache({
				fetcher: function (key, cb) {
					fetcher(key, cb);
				},
				defaultStaleTtl: 100,
				defaultExpiresTtl: 500
			});

			// Grab the initial value
			cache.get('key', function (err, value) {
				try {
					assert.strictEqual(value, 'fetcherCb init value');

					// Expire the cache, then have the fetcher return an error
					clock.tick(101);
					fetcher = function (key, cb) {
						throw new Error('fetcherCb error');
					}

					cache.get('key', function (err, value) {
						try {
							assert.strictEqual(value, 'fetcherCb init value', 'should return last valid value');
							done();
						}
						catch (err) {
							done(err);
						}
					});
				}
				catch (err) {
					done(err);
				}
			});
		});

	});

	describe("Get - Advanced", function () {

		var clock,
			crispCacheBasic,
			fetcherSpy;

		beforeEach(function () {
			fetcherSpy = sinon.spy(fetcherCb);
			crispCacheBasic = new CrispCache({
				fetcher: fetcherSpy,
				defaultStaleTtl: 300,
				defaultExpiresTtl: 500
			})
		});

		afterEach(function () {
			if (clock) {
				clock.restore();
			}
			seed.resetGlobal();
		});

		it("Should fetch a key - force fetch", function (done) {
			crispCacheBasic.get('hello', function (err, value) {
				assert.equal(err, null);
				assert.equal(value, 'world');
				crispCacheBasic.get('hello', {forceFetch: true}, function (err, value) {
					assert.equal(fetcherSpy.callCount, 2);
					assert.equal(err, null);
					assert.equal(value, 'world');
					done();
				});
			});
		});

		it("Should fetch with a bad fetcherCb", function (done) {
			var tries = 0;
			clock = sinon.useFakeTimers();

			function badFetcher(key, callback) {
				setTimeout(function () {
					tries++;
					if (tries > 1) {
						return callback(new Error("Fetcher error"));
					}
					return callback(null, tries);
				}, 1);
			}

			var badFetcherSpy = sinon.spy(badFetcher);
			var crispCacheBadFetcher = new CrispCache({
				fetcher: badFetcherSpy,
				defaultStaleTtl: 300,
				defaultExpiresTtl: 500
			});

			crispCacheBadFetcher.get('hello', function (err, value) {
				assert.equal(err, null);
				assert.equal(value, 1);
				clock.tick(400);
				crispCacheBadFetcher.get('hello', function (err, value) {
					assert.ifError(err);
					process.nextTick(function () {
						assert.equal(badFetcherSpy.callCount, 2);
						assert.equal(value, 1);
						clock.tick(50);
						crispCacheBadFetcher.get('hello', function (err, value) {
							assert.ifError(err);
							process.nextTick(function () {
								assert.equal(badFetcherSpy.callCount, 3);
								assert.equal(value, 1);
								done();
							});
						});
					});
				});
			});
			clock.tick(10);
		});

		it("Should only fetch once for 2 cache misses (locking)", function (done) {
			clock = sinon.useFakeTimers();
			async.parallel([
					function (callback) {
						crispCacheBasic.get('hello', callback);
					},
					function (callback) {
						crispCacheBasic.get('hello', callback);
					}
				],
				function (err, results) {
					assert.equal(err, null);
					assert.equal(results[0], 'world');
					assert.equal(results[1], 'world');
					assert.equal(fetcherSpy.callCount, 1);
					done();
				});
			clock.tick(10);
		});

		it("Should assign varying staleTTLs based on variance", function (done) {
			seed('foo', {global: true});
			crispCacheBasic = new CrispCache({
				fetcher: function () {
				},
				defaultStaleTtl: 300,
				staleTtlVariance: 50,
				defaultExpiresTtl: 500
			});

			crispCacheBasic.set('a', 'hello', function (err, result) {
				assert.ok(crispCacheBasic.cache['a'].staleTtl >= 250 && crispCacheBasic.cache['a'].staleTtl <= 350);
				assert.equal(crispCacheBasic.cache['a'].expiresTtl, 500);
				crispCacheBasic.set('b', 'world', function (err, result) {
					assert.ok(crispCacheBasic.cache['b'].staleTtl >= 250 && crispCacheBasic.cache['b'].staleTtl <= 350);
					assert.equal(crispCacheBasic.cache['b'].expiresTtl, 500);
					assert.notEqual(crispCacheBasic.cache['a'].staleTtl, crispCacheBasic.cache['b'].staleTtl);
					done();
				});
			});
		});

		it("Should assign varying expireTTLs based on variance", function (done) {
			seed('foo', {global: true});
			crispCacheBasic = new CrispCache({
				fetcher: function () {
				},
				defaultStaleTtl: 300,
				defaultExpiresTtl: 500,
				expiresTtlVariance: 100
			});

			crispCacheBasic.set('a', 'hello', function (err, result) {
				assert.ok(crispCacheBasic.cache['a'].expiresTtl >= 400 && crispCacheBasic.cache['a'].expiresTtl <= 600);
				assert.equal(crispCacheBasic.cache['a'].staleTtl, 300);
				crispCacheBasic.set('b', 'world', function (err, result) {
					assert.ok(crispCacheBasic.cache['b'].expiresTtl >= 400 && crispCacheBasic.cache['b'].expiresTtl <= 600);
					assert.equal(crispCacheBasic.cache['b'].staleTtl, 300);
					assert.notEqual(crispCacheBasic.cache['a'].expiresTtl, crispCacheBasic.cache['b'].expiresTtl);
					done();
				});
			});
		});

		it("Should assign varying expireTTLs and staleTTLs based on variance", function (done) {
			seed('foo', {global: true});
			crispCacheBasic = new CrispCache({
				fetcher: function () {
				},
				defaultStaleTtl: 300,
				defaultExpiresTtl: 500,
				ttlVariance: 100
			});

			crispCacheBasic.set('a', 'hello', function (err, result) {
				assert.ok(crispCacheBasic.cache['a'].staleTtl >= 200 && crispCacheBasic.cache['a'].staleTtl <= 400);
				assert.ok(crispCacheBasic.cache['a'].expiresTtl >= 400 && crispCacheBasic.cache['a'].expiresTtl <= 600);
				crispCacheBasic.set('b', 'world', function (err, result) {
					assert.ok(crispCacheBasic.cache['b'].staleTtl >= 200 && crispCacheBasic.cache['b'].staleTtl <= 400);
					assert.ok(crispCacheBasic.cache['a'].expiresTtl >= 400 && crispCacheBasic.cache['a'].expiresTtl <= 600);
					assert.notEqual(crispCacheBasic.cache['a'].staleTtl, crispCacheBasic.cache['b'].staleTtl);
					assert.notEqual(crispCacheBasic.cache['a'].expiresTtl, crispCacheBasic.cache['b'].expiresTtl);
					done();
				});
			});
		});
	});

	describe("Get - Events", function () {

		var clock,
			crispCache,
			eventHitSpy,
			eventMissSpy,
			eventFetchSpy,
			eventFetchDoneSpy;

		beforeEach(function () {
			var simpleReturn = function (obj) {
				return obj;
			};
			eventHitSpy = sinon.spy(simpleReturn);
			eventMissSpy = sinon.spy(simpleReturn);
			eventFetchSpy = sinon.spy(simpleReturn);
			eventFetchDoneSpy = sinon.spy(simpleReturn);

			crispCache = new CrispCache({
				fetcher: fetcherCb,
				defaultStaleTtl: 300,
				defaultExpiresTtl: 500
			});
			crispCache.on('hit', eventHitSpy);
			crispCache.on('miss', eventMissSpy);
			crispCache.on('fetch', eventFetchSpy);
			crispCache.on('fetchDone', eventFetchDoneSpy);
		});

		afterEach(function () {
			if (clock) {
				clock.restore();
			}
		});

		it("Should emit hit when getting from cache", function (done) {
			crispCache.get('hello', function (err, value) {
				assert.equal(eventMissSpy.callCount, 1);
				assert.equal(eventHitSpy.callCount, 0);
				crispCache.get('hello', function (err, value) {
					assert.equal(eventMissSpy.callCount, 1);
					assert.equal(eventHitSpy.callCount, 1);
					done();
				});
			});
		});

		it("Should emit events with correct values", function (done) {
			crispCache.get('hello', function (err, value) {
				assert.equal(eventMissSpy.callCount, 1);
				assert.ok(eventMissSpy.returned({key: 'hello'}));
				assert.equal(eventHitSpy.callCount, 0);
				crispCache.get('hello', function (err, value) {
					assert.equal(eventMissSpy.callCount, 1);
					assert.equal(eventHitSpy.callCount, 1);
					assert.ok(eventHitSpy.lastCall.returnValue.entry instanceof CacheEntry);
					assert.equal(eventHitSpy.lastCall.returnValue.entry.value, 'world');
					done();
				});
			});
		});

		it("Should emit fetch events", function (done) {
			clock = sinon.useFakeTimers();
			crispCache.get('hello', function (err, value) {
				assert.equal(eventFetchSpy.callCount, 1);
				assert.equal(eventFetchDoneSpy.callCount, 1);
				assert.equal(eventFetchDoneSpy.lastCall.returnValue.key, 'hello');
				assert.equal(eventFetchDoneSpy.lastCall.returnValue.value, 'world');
				done();
			});
			assert.equal(eventMissSpy.callCount, 1);
			assert.equal(eventFetchSpy.callCount, 1);
			assert.ok(eventFetchSpy.returned({key: 'hello'}));
			assert.equal(eventFetchDoneSpy.callCount, 0);
			clock.tick(10);
		});

		it("Should emit miss twice on force fetch", function (done) {
			crispCache.get('hello', function (err, value) {
				assert.equal(eventMissSpy.callCount, 1);
				assert.equal(eventHitSpy.callCount, 0);
				crispCache.get('hello', {forceFetch: true}, function (err, value) {
					assert.equal(eventMissSpy.callCount, 2);
					assert.equal(eventHitSpy.callCount, 0);
					done();
				});
			});
		});

		it("Should not emit with events turned off", function (done) {
			crispCache = new CrispCache({
				fetcher: fetcherCb,
				defaultStaleTtl: 300,
				defaultExpiresTtl: 500,
				emitEvents: false
			});
			crispCache.on('hit', eventHitSpy);
			crispCache.on('miss', eventMissSpy);

			crispCache.get('hello', function (err, value) {
				assert.equal(eventMissSpy.callCount, 0);
				assert.equal(eventHitSpy.callCount, 0);
				crispCache.get('hello', function (err, value) {
					assert.equal(eventMissSpy.callCount, 0);
					assert.equal(eventHitSpy.callCount, 0);
					done();
				});
			});
		});
	});

	describe("Set - Basic", function () {

		var crispCacheBasic;

		beforeEach(function () {
			crispCacheBasic = new CrispCache({
				fetcher: function (key, callback) {
					callback(null, 'fetcherCb value')
				},
				defaultStaleTtl: 300,
				defaultExpiresTtl: 500
			})
		});

		it("Should set a key to the cache", function (done) {
			crispCacheBasic.set("testA", "The Value", function (err, success) {
				crispCacheBasic.get('testA', function (err, value) {
					assert.equal(value, 'The Value');
					done();
				});
			})
		});

		it("Should skip cache with TTL of 0", function (done) {
			crispCacheBasic.set("testExpires", "The Value", {expiresTtl: 0}, function (err, success) {
				//This isn't great but the only way to really make sure it wasn't set to the cache at all.
				assert.equal(crispCacheBasic.cache['testA'], undefined);
				crispCacheBasic.get('testA', function (err, value) {
					assert.equal(value, 'fetcherCb value');
					done();
				});
			})
		});
	});

	describe("Set - Advanced", function () {

		var clock,
			crispCacheBasic;

		beforeEach(function () {
			crispCacheBasic = new CrispCache({
				fetcher: function (key, callback) {
					callback(null, 'fetcherCb', {staleTtl: 123, expiresTtl: 456})
				},
				defaultStaleTtl: 300,
				defaultExpiresTtl: 500
			})
		});

		afterEach(function () {
			if (clock) {
				clock.restore();
			}
		});

		it("Should set with different TTL", function (done) {
			clock = sinon.useFakeTimers();
			crispCacheBasic.get('testA', function (err, value) {
				assert.equal(err, null);
				assert.equal(value, 'fetcherCb');
				assert.equal(crispCacheBasic.cache['testA'].staleTtl, 123);
				assert.equal(crispCacheBasic.cache['testA'].expiresTtl, 456);
				done();
			});
		});

		it("Should set with different TTL for existing entry", function (done) {
			clock = sinon.useFakeTimers();
			crispCacheBasic.set('testA', 'hello', {staleTtl: 200, expiresTtl: 300}, function (err, value) {
				clock.tick(301);
				crispCacheBasic.get('testA', function (err, value) {
					assert.equal(err, null);
					assert.equal(value, 'fetcherCb');
					assert.equal(crispCacheBasic.cache['testA'].staleTtl, 123);
					assert.equal(crispCacheBasic.cache['testA'].expiresTtl, 456);
					done();
				});
			})
		});

		// PASSES
		it("Should expire cached value with a TTL of 0", function (done) {
			var fetcher;
			var cache = new CrispCache({
				fetcher: fetcher = sinon.spy(function (key, cb) {
					cb(null, 'cached value', {
						expiresTtl: 0
					});
				}),
				defaultExpiresTtl: 1000
			});

			cache.get('foo', function (err, val) {
				assert.ifError(err);
				assert.deepEqual(fetcher.callCount, 1, 'Should have hit cache for first request');

				cache.get('foo', function (err, val) {
					assert.ifError(err);
					assert.deepEqual(fetcher.callCount, 2, 'Should have hit cache again, because ttl was set to 0');
					done();
				});
			});
		});

		// FAILS
		it("Should expire cached value with a negative TTL", function (done) {
			var fetcher;
			var cache = new CrispCache({
				fetcher: fetcher = sinon.spy(function (key, cb) {
					cb(null, 'cached value', {
						expiresTtl: -100
					});
				}),
				defaultExpiresTtl: 1000
			});

			cache.get('foo', function (err, val) {
				assert.ifError(err);
				assert.deepEqual(fetcher.callCount, 1, 'Should have hit cache for first request');

				cache.get('foo', function (err, val) {
					assert.ifError(err);
					assert.deepEqual(fetcher.callCount, 2, 'Should have hit cache again, because ttl was set to negative');
					done();
				});
			});
		});
	});

	describe("Del - Basic", function () {

		var crispCacheBasic,
			fetcherSpy;

		beforeEach(function () {
			fetcherSpy = sinon.spy(fetcherCb);
			crispCacheBasic = new CrispCache({
				fetcher: fetcherSpy,
				defaultStaleTtl: 300,
				defaultExpiresTtl: 500
			})
		});

		it("Should delete a key", function (done) {
			async.waterfall([
				function (callback) {
					return crispCacheBasic.get('hello', callback);
				},
				function (value, callback) {
					assert.equal(value, 'world');
					return crispCacheBasic.del('hello', callback);
				},
				function (value, callback) {
					assert.equal(true, value);
					crispCacheBasic.get('hello', {skipFetch: true}, callback);
				}
			], function (err, value) {
				assert.equal(err, null);
				assert.equal(value, undefined);
				assert.equal(fetcherSpy.callCount, 1);
				done();
			});
		});

		it("Should clear all entries", function (done) {
			async.waterfall([
				function (callback) {
					return crispCacheBasic.get('hello', callback);
				},
				function (value, callback) {
					assert.equal(value, 'world');
					return crispCacheBasic.get('foo', callback);
				},
				function (value, callback) {
					assert.equal(value, "bar");
					crispCacheBasic.clear(callback);
				},
				function (clearResult, callback) {
					assert.equal(clearResult, true);
					return crispCacheBasic.get('hello', callback);
				},
				function (value, callback) {
					assert.equal(value, "world");
					callback(null, true);
				}
			], function (err, value) {
				assert.equal(err, null);
				assert.equal(value, true);
				assert.equal(fetcherSpy.callCount, 3);
				assert.equal(Object.keys(crispCacheBasic.cache).length, 1);
				done();
			});
		});
	});

	var staleCheckSpy;
	describe("StaleCheck - Auto refresh cache", function () {

		var clock,
			crispCacheBasic,
			fetcherSpy;

		beforeEach(function () {
			clock = sinon.useFakeTimers();

			fetcherSpy = sinon.spy(fetcherCb);
			if (!CrispCache.prototype._staleCheck_orig) {
				CrispCache.prototype._staleCheck_orig = CrispCache.prototype.staleCheck;
			}
			staleCheckSpy = sinon.spy(CrispCache.prototype._staleCheck_orig);
			CrispCache.prototype.staleCheck = staleCheckSpy;
			crispCacheBasic = new CrispCache({
				fetcher: fetcherSpy,
				defaultStaleTtl: 300,
				defaultExpiresTtl: 500,
				staleCheckInterval: 100
			});
		});

		afterEach(function () {
			if (clock) {
				clock.restore();
			}
			if (CrispCache.prototype._staleCheck_orig) {
				CrispCache.prototype.staleCheck = CrispCache.prototype._staleCheck_orig;
			}
		});

		it("Should update the cache without get", function (done) {
			async.waterfall([
					function (callback) {
						crispCacheBasic.get('hello', callback);
						clock.tick(10);
					},
					function (value, callback) {
						assert.equal(value, 'world');
						clock.tick(401);
						callback();
					},
					function (callback) {
						assert.equal(staleCheckSpy.callCount, 4);
						clock.tick(10);
						assert.equal(fetcherSpy.callCount, 2);
						crispCacheBasic.get('hello', callback);
						clock.tick(10);
					}
				],
				function (err, value) {
					assert.equal(err, null);
					assert.equal(value, 'world');
					done();
				});
		});

		it("Should emit events with stale check", function (done) {
			var simpleReturn = function (arg) {
				return arg;
			};
			var staleCheckSpy = sinon.spy(simpleReturn);
			crispCacheBasic.on('staleCheck', staleCheckSpy);
			var staleCheckDoneSpy = sinon.spy(simpleReturn);
			crispCacheBasic.on('staleCheckDone', staleCheckDoneSpy);

			async.waterfall([
					function (callback) {
						crispCacheBasic.get('hello', callback);
						clock.tick(10);
					},
					function (value, callback) {
						assert.equal(value, 'world');
						clock.tick(401);
						callback();
					}
				],
				function (err, value) {
					assert.equal(staleCheckSpy.callCount, 4);
					assert.equal(staleCheckDoneSpy.callCount, 4);
					assert.ok(staleCheckDoneSpy.returned(['hello']))
					done();
				});
		});
	});

	var delSpy;
	describe("ExpiresCheck - Auto clean cache", function () {

		var clock,
			crispCacheBasic,
			fetcherSpy;

		beforeEach(function () {
			clock = sinon.useFakeTimers();
			if (!CrispCache.prototype._del_orig) {
				CrispCache.prototype._del_orig = CrispCache.prototype.del;
			}
			delSpy = sinon.spy(CrispCache.prototype._del_orig);
			CrispCache.prototype.del = delSpy;
			crispCacheBasic = new CrispCache({
				fetcher: fetcherCb,
				defaultStaleTtl: 300,
				defaultExpiresTtl: 500,
				evictCheckInterval: 100
			});
		});

		afterEach(function () {
			if (clock) {
				clock.restore();
			}
		});

		it("Should expire the cache without asking", function (done) {
			async.waterfall([
					function (callback) {
						crispCacheBasic.get('hello', callback);
						clock.tick(10);
					},
					function (value, callback) {
						assert.equal(value, 'world');
						clock.tick(600);
						callback();
					},
					function (callback) {
						assert.equal(delSpy.callCount, 1);
						assert.equal(Object.keys(crispCacheBasic.cache).length, 0);
						clock.tick(10);
						crispCacheBasic.get('hello', {skipFetch: true}, callback);
					}
				],
				function (err, value) {
					assert.equal(err, null);
					assert.equal(value, undefined);
					done();
				});
		});

		it("Should emit expire events with evict check", function (done) {
			var evictCheckSpy = sinon.spy();
			crispCacheBasic.on('evictCheck', evictCheckSpy);
			var evictCheckDoneSpy = sinon.spy();
			crispCacheBasic.on('evictCheckDone', evictCheckDoneSpy);
			async.waterfall([
					function (callback) {
						crispCacheBasic.get('hello', callback);
						clock.tick(10);
					},
					function (value, callback) {
						assert.equal(value, 'world');
						clock.tick(601);
						callback();
					}
				],
				function (err, value) {
					assert.equal(evictCheckSpy.callCount, 6);
					assert.equal(evictCheckDoneSpy.callCount, 6);
					assert.deepEqual(evictCheckDoneSpy.args[5][0], {
						hello: {
							value: 'world',
							staleTtl: 300,
							expiresTtl: 500,
							created: 1,
							size: 1
						}
					});
					done();
				});
		});
	});

	describe("LRU Integration", function () {

		var clock,
			crispCacheBasic,
			fetcherSpy;

		beforeEach(function () {
			clock = sinon.useFakeTimers();
			crispCacheBasic = new CrispCache({
				fetcher: fetcherCb,
				maxSize: 10,
				defaultExpiresTtl: 50,
				evictCheckInterval: 100
			});
		});

		it("Should increase LRU size", function (done) {
			crispCacheBasic.set("testA", "The Value", {size: 3}, function (err, success) {
				assert.equal(crispCacheBasic._lru.size, 3);
				done();
			})
		});

		it("Should increase LRU size, multiple", function (done) {
			crispCacheBasic.set("testA", "The Value", {size: 3}, function (err, success) {
				crispCacheBasic.set("testB", "The Value B", {size: 2}, function (err, success) {
					assert.equal(crispCacheBasic._lru.size, 5);
					done();
				});
			})
		});

		it("Should increase LRU size, replace", function (done) {
			crispCacheBasic.set("testA", "The Value", {size: 3}, function (err, success) {
				crispCacheBasic.set("testA", "The Value B", {size: 4}, function (err, success) {
					assert.equal(crispCacheBasic._lru.size, 4);
					done();
				});
			})
		});

		it("Should update LRU", function (done) {
			async.waterfall([
					function (callback) {
						crispCacheBasic.set("testA", "The Value A", {size: 2}, callback);
					},
					function (result, callback) {
						crispCacheBasic.set("testB", "The Value B", {size: 8}, callback);
					},
					function (result, callback) {
						crispCacheBasic.get("testA", callback);
					}
				],
				function (err, result) {
					assert.equal(result, "The Value A");
					assert.equal(crispCacheBasic._lru.head.key, 'testA');
					done();
				});
		});

		it("Should remove LRU via crispCache", function (done) {
			async.waterfall([
					function (callback) {
						crispCacheBasic.set("testA", "The Value A", {size: 2}, callback);
					},
					function (result, callback) {
						crispCacheBasic.del("testA", callback);
					}
				],
				function (err, result) {
					assert.equal(crispCacheBasic._lru.size, 0);
					done();
				});
		});

		it("Should remove LRU", function (done) {
			async.waterfall([
					function (callback) {
						crispCacheBasic.set("testA", "The Value A", {size: 2}, callback);
					},
					function (result, callback) {
						crispCacheBasic.set("testB", "The Value B", {size: 8}, callback);
					},
					function (result, callback) {
						crispCacheBasic.set("testC", "The Value C", {size: 5}, callback);
					},
					function (result, callback) {
						assert.equal(crispCacheBasic._lru.size, 5);
						callback();
					},
					function (callback) {
						crispCacheBasic.get("testA", {skipFetch: true}, callback);
					},
					function (result, callback) {
						assert.equal(result, null);
						callback();
					},
					function (callback) {
						crispCacheBasic.get("testB", {skipFetch: true}, callback);
					}
				],
				function (err, result) {
					assert.equal(result, null);
					done();
				});
		});

		it('Should auto-evict entries from LRU cache', function (done) {
			crispCacheBasic._lru.del = sinon.spy(crispCacheBasic._lru.del);

			crispCacheBasic.set('foo', 'bar', {size: 1}, function (err) {
				assert.ifError(err);

				clock.tick(101);

				assert(crispCacheBasic._lru.del.calledWith('foo'), 'Should evicted expired entry');
				done();
			});
		});

		it("Should clear LRU too", function (done) {
			async.waterfall([
				function (callback) {
					crispCacheBasic.set("testA", "The Value", {size: 3}, callback);
				},
				function (success, callback) {
					assert.equal(success, true);
					crispCacheBasic.set("testB", "The Value B", {size: 2}, callback);
				},
				function (success, callback) {
					assert.equal(success, true);
					assert.equal(crispCacheBasic._lru.size, 5);
					crispCacheBasic.clear(callback);
				}
			], function (err, success) {
				done();
			});
		});

		it("Should update usage", function (done) {
			async.waterfall([
					function (callback) {
						crispCacheBasic.set("testA", "The Value A", {size: 2}, callback);
					},
					function (result, callback) {
						crispCacheBasic.set("testB", "The Value B", {size: 4}, callback);
					},
					function (result, callback) {
						crispCacheBasic.get("testA", callback);
					}
				],
				function (err, result) {
					var usage = crispCacheBasic.getUsage();
					assert.equal(usage.size, 6);
					assert.equal(usage.maxSize, 10);
					done();
				});
		});

		it("Should default to size=1", function (done) {
			var cache = new CrispCache({
				fetcher: function (key, cb) {
					cb(null, 'fetcherCb value');
				},
				defaultExpiresTtl: 100,
				maxSize: 100
			});

			cache.get('key', function (err, value) {
				try {
					assert.ifError(err);
					assert.strictEqual(value, 'fetcherCb value');

					var usage = cache.getUsage();
					assert.strictEqual(usage.size, 1);
					done();
				}
				catch (err) {
					done(err);
				}
			});
		});

		it("Should allow size=0", function (done) {
			var cache = new CrispCache({
				fetcher: function (key, cb) {
					cb(null, 'fetcherCb value', {size: 0});
				},
				defaultExpiresTtl: 100,
				maxSize: 100
			});

			cache.get('key', function (err, value) {
				try {
					assert.ifError(err);
					assert.strictEqual(value, 'fetcherCb value');

					var usage = cache.getUsage();
					assert.strictEqual(usage.size, 0);
					done();
				}
				catch (err) {
					done(err);
				}
			});
		});
	});

	describe('Events - General', function () {
		it('should fire events that are passed via the constructor', function () {
			var orig = function (a, cb) {
				cb(null, 'RETURN VAL');
			};
			var fetchCb = sinon.spy(function (fetchInfo) {
				return "Fetching key: " + fetchInfo.key;
			});
			var hitCb = sinon.spy(function (fetchInfo) {
				return "Hit key: " + fetchInfo.key;
			});
			var missCb = sinon.spy(function (fetchInfo) {
				return "Miss key: " + fetchInfo.key;
			});
			var crispCache = new CrispCache({
				fetcher: orig,
				defaultExpiresTtl: 1000,
				events: {
					fetch: fetchCb,
					hit: hitCb,
					miss: missCb
				}
			});
			var cb = sinon.spy(function (err, res) {
				assert.ifError(err);
				assert.deepEqual(res, 'RETURN VAL', 'Cached function should resolve the same as underlying function');
			});

			// Should hit orig
			crispCache.get('a', cb);
			// Should hit cache
			crispCache.get('a', cb);

			assert.equal(fetchCb.callCount, 1, 'Should only call the fetch cb once, but should call it');
			assert.equal(fetchCb.lastCall.returnValue, 'Fetching key: a');
			assert.equal(hitCb.callCount, 1, 'Should only call the hit cb once, but should call it');
			assert.equal(hitCb.lastCall.returnValue, 'Hit key: a');
			assert.equal(missCb.callCount, 1, 'Should only call the miss cb once, but should call it');
			assert.equal(missCb.lastCall.returnValue, 'Miss key: a');
		});
	});

	describe('wrap', function () {

		it('should wrap a function in cache, with user-defined cache keys', function () {
			var orig = sinon.spy(function (a, b, c, cb) {
				cb(null, 'RETURN VAL');
			});
			var cached = CrispCache.wrap(orig, {
				createKey: function (a, b, c) {
					return [a, b, c].join('__');
				},
				parseKey: function (key) {
					return key.split('__');
				},
				defaultExpiresTtl: 1000
			});
			var cb = sinon.spy(function (err, res) {
				assert.ifError(err);
				assert.deepEqual(res, 'RETURN VAL', 'Cached function should resolve the same as underlying function');
			});

			// Should hit orig
			cached('a', 'b', 'c', cb);
			// Should hit cache
			cached('a', 'b', 'c', cb);
			// Should hit orig again
			cached('x', 'y', 'z', cb);

			assert.equal(orig.callCount, 2, 'Cached entry should invoke the original function once for each unique key');
			assert(orig.calledWith('a', 'b', 'c'), 'Should call orig with parsed key (call 1)');
			assert(orig.calledWith('x', 'y', 'z'), 'Should call orig with parsed key (call 2)');
			assert.equal(cb.callCount, 3, 'Should invoke callback passed to the cached function');
		});

		it('should wrap a function and bind events', function () {
			var orig = function (a, cb) {
				cb(null, 'RETURN VAL');
			};
			var fetchCb = sinon.spy(function (fetchInfo) {
				return "Fetching key: " + fetchInfo.key;
			});
			var hitCb = sinon.spy(function (fetchInfo) {
				return "Hit key: " + fetchInfo.key;
			});
			var missCb = sinon.spy(function (fetchInfo) {
				return "Miss key: " + fetchInfo.key;
			});
			var cached = CrispCache.wrap(orig, {
				createKey: function (a) {
					return a;
				},
				parseKey: function (key) {
					return [key];
				},
				defaultExpiresTtl: 1000,
				events: {
					fetch: fetchCb,
					hit: hitCb,
					miss: missCb
				}
			});
			var cb = sinon.spy(function (err, res) {
				assert.ifError(err);
				assert.deepEqual(res, 'RETURN VAL', 'Cached function should resolve the same as underlying function');
			});

			// Should hit orig
			cached('a', cb);
			// Should hit cache
			cached('a', cb);

			assert.equal(fetchCb.callCount, 1, 'Should only call the fetch cb once, but should call it');
			assert.equal(fetchCb.lastCall.returnValue, 'Fetching key: a');
			assert.equal(hitCb.callCount, 1, 'Should only call the hit cb once, but should call it');
			assert.equal(hitCb.lastCall.returnValue, 'Hit key: a');
			assert.equal(missCb.callCount, 1, 'Should only call the miss cb once, but should call it');
			assert.equal(missCb.lastCall.returnValue, 'Miss key: a');
		});

		it('should complain if createKey does not return a string', function (done) {
			var orig = sinon.spy(function (a, b, c, cb) {
				cb(null, 'RETURN VAL');
			});
			var cached = CrispCache.wrap(orig, {
				createKey: function (opts) {
					return opts;
				},
				parseKey: function (key) {
					return key.split('__');
				}
			});

			cached({foo: 'bar'}, function (err, val) {
				assert(err instanceof Error, 'should throw an error');
				done();
			});
		});

		it('should complain if parseKey does not return an array', function (done) {
			var orig = sinon.spy(function (a, b, c, cb) {
				cb(null, 'RETURN VAL');
			});
			var cached = CrispCache.wrap(orig, {
				createKey: function (x) {
					return x;
				},
				parseKey: function (key) {
					return key;
				}
			});

			cached('foo', function (err, val) {
				assert(err instanceof Error, 'should throw an error');
				done();
			});
		});

		it('should complain if parseKey throws an error', function (done) {
			var orig = sinon.spy(function (a, b, c, cb) {
				cb(null, 'RETURN VAL');
			});
			var cached = CrispCache.wrap(orig, {
				createKey: function (x) {
					return x;
				},
				parseKey: function (key) {
					throw new Error();
				}
			});

			cached('foo', function (err, val) {
				assert(err instanceof Error, 'should throw an error');
				done();
			});
		});

		it('should work with functions with no args', function () {
			var orig = sinon.spy(function (cb) {
				cb(null, 'RETURN VAL');
			}), getOptions;
			var cached = CrispCache.wrap(orig, {
				defaultExpiresTtl: 1000
			});
			var cb = sinon.spy(function (err, res) {
				assert.ifError(err);
				assert.deepEqual(res, 'RETURN VAL', 'Cached function should resolve the same as underlying function');
			});

			// Should hit orig
			cached(cb);
			// Should hit cache
			cached(cb);

			assert.equal(orig.callCount, 1, 'Cached entry should invoke the original function only once');
			assert.equal(cb.callCount, 2, 'Should invoke callback passed to the cached function');
		});

		it('should accept CrispCache options', function () {
			clock = sinon.useFakeTimers();
			var orig = sinon.spy(function (x, cb) {
				cb(null, 'RETURN VAL');
			});
			var cached = CrispCache.wrap(orig, {
				createKey: function (x) {
					return x;
				},
				parseKey: function (x) {
					return [x];
				},
				defaultExpiresTtl: 100
			});

			// Should accept all CrispCache options,
			// but I don't want to re-test basic caching behavior,
			// so I'm just testing expiresTtl
			cached('foo', assert.ifError);
			assert.deepEqual(orig.callCount, 1, 'Should invoke orig on first call')

			clock.tick(50);
			cached('foo', assert.ifError);
			assert.deepEqual(orig.callCount, 1, 'Should not invoke orig before expiresTtl is up')

			clock.tick(51);
			cached('foo', assert.ifError);
			assert.deepEqual(orig.callCount, 2, 'Should invoke orig after expiresTtl is up');
		});

		it('should set cache entry options', function () {
			clock = sinon.useFakeTimers();
			var orig = sinon.spy(function (x, cb) {
				cb(null, 'RETURN VAL');
			}), getOptions;
			var cached = CrispCache.wrap(orig, {
				createKey: function (x) {
					return x;
				},
				parseKey: function (x) {
					return [x];
				},
				getOptions: getOptions = sinon.spy(function (res, args) {
					assert.deepEqual(res, 'RETURN VAL', 'getOptions should receive the resolved value');
					assert.deepEqual(args[0], 'foo', 'getOptions should receive array of call arguments');
					assert.deepEqual(args.length, 1, 'getOptions should receive array of call arguments (correct length)');

					return {
						expiresTtl: 100
					};
				})
			});

			// Should accept all CrispCache options,
			// but I don't want to re-test basic caching behavior,
			// so I'm just testing expiresTtl
			cached('foo', assert.ifError);
			assert.deepEqual(orig.callCount, 1, 'Should invoke orig on first call')

			clock.tick(50);
			cached('foo', assert.ifError);
			assert.deepEqual(orig.callCount, 1, 'Should not invoke orig before expiresTtl is up')

			clock.tick(51);
			cached('foo', assert.ifError);
			assert.deepEqual(orig.callCount, 2, 'Should invoke orig after expiresTtl is up');

			assert.deepEqual(getOptions.callCount, 2, 'getOptions should be called once for every result');
		});

		it('should complain if `getOptions` throws an error', function (done) {
			var cached = CrispCache.wrap(function (x, cb) {
				cb(null, 'foo')
			}, {
				createKey: function (x) {
					return x;
				},
				parseKey: function (x) {
					return [x];
				},
				getOptions: function (res, args) {
					throw new Error();
				}
			});

			cached('foo', function (err, val) {
				assert(err instanceof Error);
				done();
			});
		});

		it('should complain if a wrapped function is called without a callback', function (done) {
			const cached = CrispCache.wrap(function () {
			});

			assert.throws(function () {
				cached()
			}, /callback/);

			done();
		});

	});
});