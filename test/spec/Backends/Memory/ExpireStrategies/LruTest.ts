import * as assert from 'assert';
import {Lru} from  '../../../../../src/lib/Backends/Memory/ExpireStrategies/Lru';
import * as sinon from 'sinon';
import {MemoryExpireEvents} from "../../../../../src/lib/Backends/Memory/ExpireStrategies/MemoryExpireStrategyInterface";

describe("LRU", function () {

	let delSpy:sinon.SinonSpy,
		lru:Lru;

	beforeEach(function () {
		lru = new Lru({
			maxSize: 10
		});
		delSpy = sinon.spy((key:string) => {});
		lru.on(MemoryExpireEvents.DELETE, delSpy);
	});

	describe("Put", function () {

		describe("Head ops", function () {
			it("Should set the head", function () {
				lru.set('a', 1);
				assert.equal(lru.head.key, 'a');
			});

			it("Should replace the head", function () {
				lru.set('a', 1);
				lru.set('a', 2);
				assert.equal(lru.head.key, 'a');
			});

			it("Should set the head after multiple adds", function () {
				lru.set('a', 1);
				lru.set('b', 2);
				lru.set('c', 3);
				assert.equal(lru.head.key, 'c');
			});

			it("Should set the head after multiple adds, mixed order", function () {
				lru.set('a', 1);
				lru.set('b', 3);
				lru.set('c', 2);
				lru.set('b', 1);
				assert.equal(lru.head.key, 'b');
			});

			it("Should set the head after multiple adds, mixed order", function () {
				lru.set('a', 1);
				lru.set('b', 3);
				lru.set('c', 2);
				lru.set('b', 1);
				assert.equal(lru.head.key, 'b');
			});
		});

		describe("Tail ops", function () {
			it("Should set the tail", function () {
				lru.set('a', 1);
				assert.equal(lru.tail.key, 'a');
			});

			it("Should set the tail after multiple adds", function () {
				lru.set('a', 1);
				lru.set('b', 1);
				lru.set('c', 1);
				assert.equal(lru.tail.key, 'a');
			});

			it("Should set the tail after multiple adds, mixed order", function () {
				lru.set('a', 1);
				lru.set('b', 1);
				lru.set('c', 1);
				lru.set('b', 1);
				assert.equal(lru.tail.key, 'a');
			});

			it("Should set the tail after multiple adds, last", function () {
				lru.set('a', 1);
				lru.set('b', 1);
				lru.set('c', 1);
				lru.set('a', 1);
				assert.equal(lru.tail.key, 'b');
			});
		});

		describe("Size changes", function () {
			it("Should set size", function () {
				lru.set('a', 1);
				assert.equal(lru.size, 1);
			});

			it("Should set the size after multiple adds", function () {
				lru.set('a', 1);
				lru.set('b', 2);
				lru.set('c', 3);
				assert.equal(lru.size, 6);
			});

			it("Should set the size after multiple adds, repeat", function () {
				lru.set('a', 1);
				lru.set('b', 2);
				lru.set('c', 3);
				lru.set('b', 2);
				assert.equal(lru.size, 6);
			});

			it("Should set the tail after multiple adds, update", function () {
				lru.set('a', 1);
				lru.set('b', 2);
				lru.set('c', 3);
				lru.set('a', 4);
				assert.equal(lru.size, 9);
			});

			it("Should update the head", function () {
				lru.set('a', 1);
				lru.set('b', 2);
				lru.set('c', 3);
				lru.set('c', 4);
				assert.equal(lru.size, 7);
			});

			it("Should update the tail", function () {
				lru.set('a', 1);
				lru.set('b', 2);
				lru.set('c', 3);
				lru.set('a', 4);
				assert.equal(lru.size, 9);
			});
		});

		describe("Hash size changes", function () {
			it("Should set an entry", function () {
				lru.set('a', 1);
				assert.equal(Object.keys(lru.hash).length, 1);
			});

			it("Should set the size after multiple adds", function () {
				lru.set('a', 1);
				lru.set('b', 2);
				lru.set('c', 3);
				assert.equal(Object.keys(lru.hash).length, 3);
			});

			it("Should set the size after multiple adds, repeat", function () {
				lru.set('a', 1);
				lru.set('b', 2);
				lru.set('c', 3);
				lru.set('b', 2);
				assert.equal(Object.keys(lru.hash).length, 3);
			});

			it("Should remove an element and hash entry", function () {
				lru.set('a', 5);
				lru.set('b', 5);
				lru.set('c', 5);
				assert.equal(Object.keys(lru.hash).length, 2);
			});
		});

		describe("Over maxSize", function () {
			it("Should remove an element", function () {
				lru.set('a', 5);
				lru.set('b', 5);
				lru.set('c', 5);
				assert.equal(delSpy.callCount, 1);
				assert.equal(lru.head.key, 'c');
				assert.equal(lru.tail.key, 'b');
				assert.equal(lru.size, 10);
			});

			it("Shouldn't remove any", function () {
				lru.set('a', 1);
				lru.set('b', 2);
				lru.set('c', 3);
				assert.equal(delSpy.callCount, 0);
				assert.equal(lru.head.key, 'c');
				assert.equal(lru.tail.key, 'a');
				assert.equal(lru.size, 6);
			});

			it("Should remove 2 elements", function () {
				lru.set('a', 2);
				lru.set('b', 5);
				lru.set('c', 10);
				assert.equal(delSpy.callCount, 2);
				assert.equal(lru.head.key, 'c');
				assert.equal(lru.tail.key, 'c');
				assert.equal(lru.size, 10);
			});

			it("Should remove multiple elements", function () {
				lru.set('a', 2);
				lru.set('b', 8);
				lru.set('c', 5);
				assert.equal(delSpy.callCount, 2);
				assert.equal(lru.head.key, 'c');
				assert.equal(lru.tail.key, 'c');
				assert.equal(lru.size, 5);
			});
		})
	});

	describe("Del", function () {
		it("Should remove an entry", function () {
			lru.set('a', 1);
			lru.set('b', 1);
			lru.set('c', 1);
			lru.delete('b');
			assert.equal(lru.head.key, 'c');
			assert.equal(delSpy.callCount, 1);
		});

		it("Should remove the head entry", function () {
			lru.set('a', 1);
			lru.set('b', 1);
			lru.set('c', 1);
			lru.delete('c');
			assert.equal(lru.head.key, 'b');
			assert.equal(delSpy.callCount, 1);
		});

		it("Should remove the tail entry", function () {
			lru.set('a', 1);
			lru.set('b', 1);
			lru.set('c', 1);
			lru.delete('a');
			assert.equal(lru.tail.key, 'b');
			assert.equal(delSpy.callCount, 1);
		});
	});

	describe("Shift", function () {
		it("Should remove the tail", function () {
			lru.set('a', 1);
			lru.set('b', 2);
			lru.shift();
			assert.equal(delSpy.callCount, 1);
			assert.equal(lru.head.key, 'b');
			assert.equal(lru.tail.key, 'b');
			assert.equal(lru.size, 2);
		});

		it("Should remove the only entry", function () {
			lru.set('a', 1);
			lru.shift();
			assert.equal(delSpy.callCount, 1);
			assert.equal(lru.head, null);
			assert.equal(lru.tail, null);
			assert.equal(lru.size, 0);
		});

		it("Should remove the only entry", function () {
			lru.set('a', 1);
			lru.set('b', 2);
			lru.set('c', 3);
			lru.shift();
			assert.equal(delSpy.callCount, 1);
			assert.equal(lru.head.key, 'c');
			assert.equal(lru.tail.key, 'b');
			assert.equal(lru.size, 5);
		});
	});

	describe("clear", function () {
		it("Should remove an entry", function () {
			lru.set('a', 1);
			lru.set('b', 1);
			lru.set('c', 1);
			lru.clear();
			assert.equal(lru.head, null);
			assert.equal(lru.tail, null);
			assert.equal(lru.size, 0);
			assert.equal(Object.keys(lru.hash).length, 0);
		});
	});

	describe("toString", function () {
		it("Should outset the state", function () {
			lru.set('a', 1);
			lru.set('b', 2);
			lru.set('c', 3);
			assert.equal("" + lru, "Size: 6/10, Head: c -> b -> a :Tail");
		});
	})
});