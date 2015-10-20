var assert = require('assert'),
    Lru = require('../lib/Lru'),
    sinon = require('sinon');

describe("LRU", function () {

    var delSpy = null,
        lru = null;

    beforeEach(function () {
        delSpy = sinon.spy(function(key) {});
        lru = new Lru(10, delSpy);
    });

    describe("Put", function () {

        describe("Head ops", function () {
            it("Should set the head", function () {
                lru.put('a', 1);
                assert.equal(lru.head.key, 'a');
            });

            it("Should set the head after multiple adds", function () {
                lru.put('a', 1);
                lru.put('b', 2);
                lru.put('c', 3);
                assert.equal(lru.head.key, 'c');
            });

            it("Should set the head after multiple adds, mixed order", function () {
                lru.put('a', 1);
                lru.put('b', 3);
                lru.put('c', 2);
                lru.put('b', 1);
                assert.equal(lru.head.key, 'b');
            });
        });

        describe("Tail ops", function () {
            it("Should set the tail", function () {
                lru.put('a', 1);
                assert.equal(lru.tail.key, 'a');
            });

            it("Should set the tail after multiple adds", function () {
                lru.put('a', 1);
                lru.put('b', 1);
                lru.put('c', 1);
                assert.equal(lru.tail.key, 'a');
            });

            it("Should set the tail after multiple adds, mixed order", function () {
                lru.put('a', 1);
                lru.put('b', 1);
                lru.put('c', 1);
                lru.put('b', 1);
                assert.equal(lru.tail.key, 'a');
            });

            it("Should set the tail after multiple adds, last", function () {
                lru.put('a', 1);
                lru.put('b', 1);
                lru.put('c', 1);
                lru.put('a', 1);
                assert.equal(lru.tail.key, 'b');
            });
        });

        describe("Size changes", function () {
            it("Should set size", function () {
                lru.put('a', 1);
                assert.equal(lru.size, 1);
            });

            it("Should set the size after multiple adds", function () {
                lru.put('a', 1);
                lru.put('b', 2);
                lru.put('c', 3);
                assert.equal(lru.size, 6);
            });

            it("Should set the size after multiple adds, repeat", function () {
                lru.put('a', 1);
                lru.put('b', 2);
                lru.put('c', 3);
                lru.put('b', 2);
                assert.equal(lru.size, 6);
            });

            it("Should set the tail after multiple adds, update", function () {
                lru.put('a', 1);
                lru.put('b', 2);
                lru.put('c', 3);
                lru.put('a', 4);
                assert.equal(lru.size, 9);
            });
        });

        describe("Over maxSize", function() {
            it("Should remove an element", function() {
                lru.put('a', 5);
                lru.put('b', 5);
                lru.put('c', 5);
                assert.equal(delSpy.callCount, 1);
                assert.equal(lru.head.key, 'c');
                assert.equal(lru.tail.key, 'b');
                assert.equal(lru.size, 10);
            });

            it("Shouldn't remove any", function() {
                lru.put('a', 1);
                lru.put('b', 2);
                lru.put('c', 3);
                assert.equal(delSpy.callCount, 0);
                assert.equal(lru.head.key, 'c');
                assert.equal(lru.tail.key, 'a');
                assert.equal(lru.size, 6);
            });

            it("Should remove 2 elements", function() {
                lru.put('a', 2);
                lru.put('b', 5);
                lru.put('c', 10);
                assert.equal(delSpy.callCount, 2);
                assert.equal(lru.head.key, 'c');
                assert.equal(lru.tail.key, 'c');
                assert.equal(lru.size, 10);
            });
        })
    });

    describe("Shift", function () {
        it("Should remove the tail", function () {
            lru.put('a', 1);
            lru.put('b', 2);
            lru.shift();
            assert.equal(delSpy.callCount, 1);
            assert.equal(lru.head.key, 'b');
            assert.equal(lru.tail.key, 'b');
            assert.equal(lru.size, 2);
        });

        it("Should remove the only entry", function () {
            lru.put('a', 1);
            lru.shift();
            assert.equal(delSpy.callCount, 1);
            assert.equal(lru.head, null);
            assert.equal(lru.tail, null);
            assert.equal(lru.size, 0);
        });

        it("Should remove the only entry", function () {
            lru.put('a', 1);
            lru.put('b', 2);
            lru.put('c', 3);
            lru.shift();
            assert.equal(delSpy.callCount, 1);
            assert.equal(lru.head.key, 'c');
            assert.equal(lru.tail.key, 'b');
            assert.equal(lru.size, 5);
        });
    });
});