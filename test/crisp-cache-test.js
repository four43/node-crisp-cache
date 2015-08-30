var assert = require('assert'),
    async = require('async'),
    CrispCache = require('../index'),
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

var clock,
    crispCacheBasic,
    fetcherSpy;

describe("Setup Sanity", function () {
    it("Should complain if we have no fetcher", function () {
        try {
            var crispCache = new CrispCache();
            assert.ok(false, "Should complain that we don't have a fetcher!");
        }
        catch (err) {
            assert.ok(true);
        }
    });
});

describe("Get - Basic", function () {
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
    beforeEach(function () {
        fetcherSpy = sinon.spy(fetcher);
        crispCacheBasic = new CrispCache({
            fetcher: fetcherSpy,
            defaultStaleTtl: 300,
            defaultExpiresTtl: 500
        })
    });

    it("Should only fetch once for 2 cache misses", function (done) {
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
    })
});

describe("Set - Basic", function () {
    it("Should set a key to the cache", function (done) {
        crispCacheBasic.set("testA", "The Value", function (err, success) {
            crispCacheBasic.get('testA', function (err, value) {
                assert.equal(value, 'The Value');
                done();
            });
        })
    });
});

describe("Del - Basic", function () {
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
    beforeEach(function () {
        clock = sinon.useFakeTimers();

        fetcherSpy = sinon.spy(fetcher);
        if(!CrispCache.prototype._staleCheck_orig) {
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
    });

    it("Should update the cache without asking", function (done) {
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
                function(callback) {
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
});

describe("ExpiresCheck - Auto clean cache", function () {

});