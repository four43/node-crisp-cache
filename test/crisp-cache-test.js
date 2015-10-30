var assert = require('assert'),
    async = require('async'),
    CacheEntry = require('../lib/CacheEntry'),
    CrispCache = require('../main'),
    seed = require('seed-random'),
    sinon = require('sinon');

var data = {
    hello: "world",
    foo: "bar",
    arr: [1, 2, 3],
    hash: {key: "value", nested: [4, 5, 6]}
};
function fetcher(key, callback) {
    setTimeout(function () {
        return callback(null, data[key]);
    }, 1);
}
function fetcherBad(key, callback) {
    callback(new Error("There was a problem with the fetcher"));
}

describe("CrispCache", function () {
    describe("Setup Sanity", function () {
        it("Should complain if we have no fetcher", function () {
            assert.throws(
                function () {
                    new CrispCache();
                },
                "Should complain that we don't have a fetcher!"
            );
        });

        it("Should not setup LRU", function () {
            var crispCache = new CrispCache({
                fetcher: function (key) {
                }
            });
            assert.equal(crispCache._lru, undefined);
        });
    });

    describe("Get - Basic", function () {

        var clock,
            crispCacheBasic,
            fetcherSpy;

        beforeEach(function () {
            fetcherSpy = sinon.spy(fetcher);
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
        });

        it("Should fetch a key", function (done) {
            crispCacheBasic.get('hello', function (err, value) {
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

    describe("Get - Advanced", function () {

        var clock,
            crispCacheBasic,
            fetcherSpy;

        beforeEach(function () {
            fetcherSpy = sinon.spy(fetcher);
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

        it("Should propagate the error from the fetcher", function (done) {
            crispCacheBasic = new CrispCache({
                fetcher: fetcherBad
            });
            crispCacheBasic.get('hello', function (err, value) {
                assert.ok(err);
                assert.equal(err.message, "There was a problem with the fetcher");
                assert.equal(value, undefined);
                done();
            });
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

    describe("Get - Events", function() {

        var clock,
            crispCache,
            eventHitSpy,
            eventMissSpy,
            eventFetchSpy,
            eventFetchDoneSpy;

        beforeEach(function () {
            var simpleReturn = function(obj) {
                return obj;
            };
            eventHitSpy = sinon.spy(simpleReturn);
            eventMissSpy = sinon.spy(simpleReturn);
            eventFetchSpy = sinon.spy(simpleReturn);
            eventFetchDoneSpy = sinon.spy(simpleReturn);

            crispCache = new CrispCache({
                fetcher: fetcher,
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
                assert.ok(eventMissSpy.returned({ key: 'hello' }));
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
            assert.ok(eventFetchSpy.returned({ key: 'hello' }));
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
                fetcher: fetcher,
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
                    callback(null, 'fetcher value')
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
                    assert.equal(value, 'fetcher value');
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
                    callback(null, 'fetcher', {staleTtl: 123, expiresTtl: 456})
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
                assert.equal(value, 'fetcher');
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
                    assert.equal(value, 'fetcher');
                    assert.equal(crispCacheBasic.cache['testA'].staleTtl, 123);
                    assert.equal(crispCacheBasic.cache['testA'].expiresTtl, 456);
                    done();
                });
            })
        });
    });

    describe("Del - Basic", function () {

        var crispCacheBasic,
            fetcherSpy;

        beforeEach(function () {
            fetcherSpy = sinon.spy(fetcher);
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
    });

    var staleCheckSpy;
    describe("StaleCheck - Auto refresh cache", function () {

        var clock,
            crispCacheBasic,
            fetcherSpy;

        beforeEach(function () {
            clock = sinon.useFakeTimers();

            fetcherSpy = sinon.spy(fetcher);
            if (!CrispCache.prototype._staleCheck_orig) {
                CrispCache.prototype._staleCheck_orig = CrispCache.prototype._staleCheck;
            }
            staleCheckSpy = sinon.spy(CrispCache.prototype._staleCheck_orig);
            CrispCache.prototype._staleCheck = staleCheckSpy;
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
                CrispCache.prototype._staleCheck = CrispCache.prototype._staleCheck_orig;
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
            var simpleReturn = function(arg) {
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
                fetcher: fetcher,
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
            var simpleReturn = function(arg) {
                return arg;
            };
            var evictCheckSpy = sinon.spy(simpleReturn);
            crispCacheBasic.on('evictCheck', evictCheckSpy);
            var evictCheckDoneSpy = sinon.spy(simpleReturn);
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
                    assert.ok(evictCheckDoneSpy.returned({"hello":{"value":"world","staleTtl":300,"expiresTtl":500,"created":1,"size":null}}));
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
                fetcher: fetcher,
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

        it("Should update LRU without size", function (done) {
            crispCacheBasic.set("testA", "The Value A", function (err, result) {
                assert.ok(err);
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

        it('Should auto-evict entries from LRU cache', function(done) {
          crispCacheBasic._lru.del = sinon.spy(crispCacheBasic._lru.del);

          crispCacheBasic.set('foo', 'bar', {size: 1}, function(err) {
            assert.ifError(err);

            clock.tick(101);

            assert(crispCacheBasic._lru.del.calledWith('foo'), 'Should evicted expired entry');
            done();
          });
        });

    });
});