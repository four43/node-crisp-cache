import {IBackend, NextResult} from "../BackendInterface";
import {AbstractMemoryExpireStrategy, MemoryExpireEvents} from "./ExpireStrategies/MemoryExpireStrategyInterface";

export default class Memory<T> implements IBackend<T> {

	protected entries: Map<string, T>;
	protected locks: {[id: string]: number};
	protected expireStrategy: AbstractMemoryExpireStrategy;

	constructor(opts: {expireStrategy: AbstractMemoryExpireStrategy}) {
		this.entries = new Map<string, T>();
		this.locks = {};
		this.expireStrategy = opts.expireStrategy;
		this.expireStrategy.on(MemoryExpireEvents.DELETE, this.delete.bind(this));
	}

	async get(key: string): Promise<T|undefined> {
		this.expireStrategy.get(key);
		return Promise.resolve(this.entries.get(key));
	}

	async set(key: string, value: T, size: number = 1): Promise<T> {
		this.expireStrategy.set(key, size);
		this.entries.set(key, value);
		return Promise.resolve(value);
	}

	async delete(key: string, options?: {skipExpireStrategyDelete: boolean}): Promise<void> {
		if(!options || options.skipExpireStrategyDelete !== true) {
			this.expireStrategy.delete(key, true);
		}
		this.entries.delete(key);
		return Promise.resolve();
	}

	async clear(): Promise<void> {
		this.entries = new Map<string, T>();
		this.locks = {};
		this.expireStrategy.clear();
		return Promise.resolve();
	}

	async lock(key: string, timeout?: number): Promise<boolean> {
		const lockEntry: number|undefined = this.locks[key];
		if (lockEntry) {
			if (Date.now() < lockEntry) {
				return Promise.resolve(false);
			}
		}
		this.locks[key] = Date.now() + (timeout||0);
		return Promise.resolve(true);
	}

	async unlock(key: string): Promise<void> {
		delete this.locks[key];
		return Promise.resolve();
	}

	async next(cursor?: any): Promise<NextResult<T>|null> {
		let result: {value: [string,T]|undefined, done: boolean};
		if (!cursor) {
			cursor = this.entries[Symbol.iterator]();
			result = cursor.next(cursor);
		}
		else {
			result = cursor.next();
		}

		if (!result.done && result.value) {
			return Promise.resolve({
				key: result.value[0],
				value: result.value[1],
				next: () => this.next(cursor)
			})
		}
		return Promise.resolve(null);
	}

	async getUsage(): Promise<{size:number, maxSize:number}> {
		return Promise.resolve({
			size: this.expireStrategy.size,
			maxSize: this.expireStrategy.maxSize
		});
	}
}