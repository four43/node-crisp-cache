import * as assert from 'assert';
import Memory from '../../../../src/lib/Backends/Memory/Memory';
import {NextResult} from "../../../../src/lib/Backends/BackendInterface";
import * as sinon from 'sinon';
import {Lru} from "../../../../src/lib/Backends/Memory/ExpireStrategies/Lru";

describe("Backend - Memory", () => {

	let backend: Memory<string>;
	let clock:sinon.SinonFakeTimers;
	beforeEach(() => {
		backend = new Memory<string>({
			expireStrategy: new Lru({
				maxSize: Infinity
			})
		});
		clock = sinon.useFakeTimers();
	});

	afterEach(() => {
		clock.restore();
	});

	describe("Basic Get/Set/Del", () => {

		it("should set a key", async(): Promise<void> => {
			await backend.set("a", "hello world");
			const value = await backend.get("a");
			assert.equal(value, "hello world");
		});

		it("should get/delete multiple keys", async(): Promise<void> => {
			await backend.set("a", "hello world");
			await backend.set("b", "foo");
			await backend.set("c", "bar");

			let valB = await backend.get("b");
			assert.equal(valB, "foo");

			let valC = await backend.get("c");
			assert.equal(valC, "bar");

			await backend.delete("b");
			valB = await backend.get("b");
			assert.equal(valB, undefined);
		});
	});

	describe("Iteration", () => {

		it("should iterate through keys", async(): Promise<void> => {
			await backend.set("a", "hello world");
			await backend.set("b", "foo");
			await backend.set("c", "bar");


			let next = backend.next.bind(backend);
			let result: NextResult<string>|null;

			let iterations = 0;
			let results: {key: string, value: string}[] = [];

			while (result = await next()) {
				results.push({key: result.key, value: result.value});
				iterations++;
				next = result.next.bind(backend);
			}

			assert.deepEqual(results, [
				{
					key: "a",
					value: "hello world"
				},
				{
					key: "b",
					value: "foo"
				},
				{
					key: "c",
					value: "bar"
				}
			]);
			assert.equal(iterations, 3);
		});

		it("should iterate through keys with delete", async(): Promise<void> => {
			await backend.set("a", "hello world");
			await backend.set("b", "foo");
			await backend.set("c", "bar");


			let next = backend.next.bind(backend);
			let result: NextResult<string>|null;

			let iterations = 0;
			let results: {key: string, value: string}[] = [];

			while (result = await next()) {
				results.push({key: result.key, value: result.value});
				if(iterations === 1) {
					await backend.delete("c");
				}
				iterations++;
				next = result.next.bind(backend);
			}

			assert.deepEqual(results, [
				{
					key: "a",
					value: "hello world"
				},
				{
					key: "b",
					value: "foo"
				}
			]);
			assert.equal(iterations, 2);
		});

	});

	describe("Locking", () => {

		it("should lock for a duration", async(): Promise<void> => {
			await backend.lock("a", 1000);
			clock.tick(100);
			assert.equal(await backend.lock("a"), false);
			clock.tick(1000);
			assert.equal(await backend.lock("a"), true);
		});

		it("should be able to lock again once unlocked", async(): Promise<void> => {
			await backend.lock("a", 1000);
			clock.tick(100);
			await backend.unlock("a");
			assert.equal(await backend.lock("a"), true);
		});
	});

	describe("Expiration Integration", () => {
		beforeEach(() => {
			backend = new Memory<string>({
				expireStrategy: new Lru({
					maxSize: 5
				})
			});
		});

		it("should keep all values when below maxSize", async(): Promise<void> => {
			await backend.set("a", "hello world", 1);
			await backend.set("b", "foo", 1);
			await backend.set("c", "bar", 1);

			let valA = await backend.get("a");
			assert.equal(valA, "hello world");

			let valB = await backend.get("b");
			assert.equal(valB, "foo");

			let valC = await backend.get("c");
			assert.equal(valC, "bar");
		});

		it("should delete the least recently set", async(): Promise<void> => {
			await backend.set("a", "hello world", 2);
			await backend.set("b", "foo", 2);
			await backend.set("c", "bar", 2);

			let valA = await backend.get("a");
			assert.equal(valA, undefined);
		});

		it("should delete the least recently used", async(): Promise<void> => {
			await backend.set("a", "hello world", 2);
			await backend.set("b", "foo", 2);
			await backend.get("a");
			await backend.set("c", "bar", 2);

			let valA = await backend.get("a");
			assert.equal(valA, "hello world");

			let valB = await backend.get("b");
			assert.equal(valB, undefined);
		});

	})
});