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

var crispCacheBasic;
describe("Get - Basic", function() {
    beforeEach(function() {
        crispCacheBasic = new CrispCache({
            fetcher: fetcher
        })
    });

    it("Should fetch a key", function(done) {
        crispCacheBasic.get('hello', function(err, value) {
            assert.equal(value, 'world');
            done();
        });
    });

    it("Should fetch a key from cache", function(done) {
        var fetcherSpy = sinon.spy(fetcher);
        crispCacheBasic = new CrispCache({
            fetcher: fetcherSpy
        });
        crispCacheBasic.get('hello', function(err, value) {
            assert.equal(value, 'world');
            crispCacheBasic.get('hello', function(err, value) {
                assert.equal(value, 'world');
                assert.ok(fetcherSpy.calledOnce);
                done();
            });
        });
    })
});