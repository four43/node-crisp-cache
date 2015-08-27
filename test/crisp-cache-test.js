var assert = require('assert'),
    CrispCache = require('../index'),
    sinon = require('sinon');

var data = {
    hello: "world",
    foo: "bar",
    arr: [1, 2, 3],
    hash: {key: "value", nested: [4, 5, 6]}
};
function fetcher(key, callback) {
    callback(null, data[key]);
}
function fetcherBad(key, callback) {
    callback(new Error("There was a problem with the fetcher"));
}

var clock,
    crispCacheBasic,
    fetcherSpy;

describe("Get - Basic", function () {
    before(function () {
        clock = sinon.useFakeTimers();
    });

    beforeEach(function () {
        fetcherSpy = sinon.spy(fetcher);
        crispCacheBasic = new CrispCache({
            fetcher: fetcherSpy,
            defaultStaleTtl: 300,
            defaultExpiresTtl: 500
        })
    });

    after(function () {
        clock.restore();
    });

    it("Should fetch a key", function (done) {
        crispCacheBasic.get('hello', function (err, value) {
            assert.equal(value, 'world');
            done();
        });
    });

    it("Should not fetch a missing key", function (done) {
        crispCacheBasic.get('hello', {skipFetch: true}, function (err, value) {
            assert.equal(value, undefined);
            assert.equal(0, fetcherSpy.callCount);
            done();
        });
    });

    it("Should fetch a key from cache", function (done) {
        crispCacheBasic.get('hello', function (err, value) {
            assert.equal(value, 'world');
            crispCacheBasic.get('hello', function (err, value) {
                assert.equal(value, 'world');
                assert.ok(fetcherSpy.calledOnce);
                done();
            });
        });
    });

    it("Should fetch a stale key", function(done) {
        crispCacheBasic.get('hello', function (err, value) {
            assert.equal(value, 'world');
            clock.tick(301);
            crispCacheBasic.get('hello', function (err, value) {
                assert.equal(value, 'world');
                assert.equal(1, fetcherSpy.callCount);
                done();
            });
        });
    });

    it("Should re-fetch an expired key", function(done) {
        crispCacheBasic.get('hello', function (err, value) {
            assert.equal(value, 'world');
            clock.tick(1000);
            crispCacheBasic.get('hello', function (err, value) {
                assert.equal(value, 'world');
                assert.equal(2, fetcherSpy.callCount);
                done();
            });
        });
    });

    it("Should not re-fetch an expired key", function(done) {
        crispCacheBasic.get('hello', function (err, value) {
            assert.equal(value, 'world');
            clock.tick(1000);
            crispCacheBasic.get('hello', {skipFetch: true}, function (err, value) {
                assert.equal(value, undefined);
                assert.equal(1, fetcherSpy.callCount);
                done();
            });
        });
    });

});

describe("Set - Basic", function () {
    fetcherSpy = sinon.spy(fetcher);
    crispCacheBasic = new CrispCache({
        fetcher: fetcherSpy
    });

    it("Should set a key to the cache", function (done) {
        crispCacheBasic.set("testA", "The Value", function (err, success) {
            crispCacheBasic.get('testA', function (err, value) {
                assert.equal(value, 'The Value');
                done();
            });
        })
    })
});