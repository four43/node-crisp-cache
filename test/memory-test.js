var assert = require('assert'),
	async = require('async'),
	CrispCache = require('../main'),
	sinon = require('sinon'),
	util = require('util');

/**
 * **Notes:**
 *
 * * We need the --expose-gc flag enabled for these tests to get consistent results.
 *
 * * Can't use Buffers for testing, they live outside of the V8 heap.
 */
describe("Memory Test", function () {

	var fetcherSpy,
		crispCacheBasic,
		data = {
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

	beforeEach(function () {
		fetcherSpy = sinon.spy(fetcher);
		crispCacheBasic = new CrispCache({
			fetcher: fetcherSpy,
			defaultStaleTtl: 300,
			defaultExpiresTtl: 500
		})
	});

	it("Should use memory as it expands", function (done) {
		var sets = get100Sets(crispCacheBasic);

		global.gc();
		var startingMemoryInfo = process.memoryUsage();

		async.parallel(sets, function (err, success) {
			crispCacheBasic.get(50, function (err, value) {
				assert.ifError(err);
				assert.ok(value);

				global.gc();
				var fullMemoryInfo = process.memoryUsage();
				console.log("Full - Starting: " + (fullMemoryInfo.heapUsed - startingMemoryInfo.heapUsed) + " (~102400)");
				var memoryIncrease = fullMemoryInfo.heapUsed - startingMemoryInfo.heapUsed;
				assert.ok((memoryIncrease > 80000000), "Didn't increase memory usage like we though. Method to check memory usage may be broken");
				done();
			});
		});
	});

	it("Should free memory on clear", function (done) {
		var sets = get100Sets(crispCacheBasic);

		global.gc();
		var startingMemoryInfo = process.memoryUsage();

		async.parallel(sets, function (err, success) {
				assert.ifError(err);
				assert.ok(success);

				global.gc();
				var fullMemoryInfo = process.memoryUsage();
				console.log("Full - Starting: " + (fullMemoryInfo.heapUsed - startingMemoryInfo.heapUsed) + " (~102400)");
				var memoryIncrease = fullMemoryInfo.heapUsed - startingMemoryInfo.heapUsed;
				assert.ok((memoryIncrease > 80000000), "Didn't increase memory usage like we though. Method to check memory usage may be broken");
				crispCacheBasic.clear(function (err, success) {
					global.gc();
					var clearedMemoryInfo = process.memoryUsage();
					var endDifference = clearedMemoryInfo.heapUsed - startingMemoryInfo.heapUsed;

					console.log("Cleared - Full: " + (clearedMemoryInfo.heapUsed - fullMemoryInfo.heapUsed) + " (<0)");
					console.log("Cleared - Starting: " + (clearedMemoryInfo.heapUsed - startingMemoryInfo.heapUsed) + " (Ideally 0)");
					console.log("Cleared - Starting (%): " + ((clearedMemoryInfo.heapUsed - startingMemoryInfo.heapUsed) / (fullMemoryInfo.heapUsed - startingMemoryInfo.heapUsed)) + " (Ideally 0)");
					assert.ok((endDifference / memoryIncrease) < 0.03, "We leaked more than 3% of memory on clear, was " + (((clearedMemoryInfo.heapUsed / startingMemoryInfo.heapUsed) - 1) * 100) + "%");
					done();
				});
		});
	});

	it("Should clear memory after removing half", function (done) {
		var sets = get100Sets(crispCacheBasic);

		global.gc();
		var startingMemoryInfo = process.memoryUsage();

		async.parallel(sets, function (err, success) {
			assert.ifError(err);
			assert.ok(success);

			global.gc();
			var fullMemoryInfo = process.memoryUsage();
			console.log("Full - Starting: " + (fullMemoryInfo.heapUsed - startingMemoryInfo.heapUsed) + " (~102400)");
			var memoryIncrease = fullMemoryInfo.heapUsed - startingMemoryInfo.heapUsed;
			assert.ok((memoryIncrease > 80000000), "Didn't increase memory usage like we though. Method to check memory usage may be broken");

			var deletes = [];
			for(var i = 0; i < 50; i++) {
				deletes.push(function(key) {
					return function(callback) {
						crispCacheBasic.del(key, callback);
					}
				}(i));
			}

			async.parallel(deletes, function (err, success) {
				global.gc();
				var halfMemoryInfo = process.memoryUsage();
				var endDifference = halfMemoryInfo.heapUsed - startingMemoryInfo.heapUsed;

				console.log("Half - Full: " + (halfMemoryInfo.heapUsed - fullMemoryInfo.heapUsed) + " (<0)");
				console.log("Half - Starting: " + (halfMemoryInfo.heapUsed - startingMemoryInfo.heapUsed) + " (Ideally 0)");
				console.log("Half - Starting (%): " + ((halfMemoryInfo.heapUsed - startingMemoryInfo.heapUsed) / (fullMemoryInfo.heapUsed - startingMemoryInfo.heapUsed)) + " (Ideally 0)");
				assert.ok((endDifference / memoryIncrease) < 0.52, "We used more than ~50% of memory when we cleared half of our entries, was " + (endDifference / memoryIncrease * 100) + "%");
				done();
			});
		});
	});
});

function get100Sets(crispCacheBasic) {
	var sets = [];
	for (var i = 0; i < 100; i++) {
		sets.push(function (key) {
			return function (callback) {
				var data = [];
				for (var j = 0; j < 102400; j++) {
					data.push(i + j);
				}
				crispCacheBasic.set(key, data, callback);
			};
		}(i));
	}
	return sets;
}