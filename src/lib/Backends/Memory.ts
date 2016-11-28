import {AbstractBackend, NextResult} from "./AbstractBackend";

export default class Memory<T> implements AbstractBackend<T> {

	protected entries: Map<string, T>;
	protected locks: {[id: string]: number};

	constructor(opts?: any) {
		this.entries = new Map<string, T>();
		this.locks = {};
	}

	async get(key: string): Promise<T|undefined> {
		return Promise.resolve(this.entries.get(key));
	}

	async set(key: string, value: T): Promise<T> {
		this.entries.set(key, value);
		return Promise.resolve(value);
	}

	async delete(key: string): Promise<void> {
		this.entries.delete(key);
		return Promise.resolve();
	}

	async lock(key: string, timeout?: number): Promise<boolean> {
		const lockEntry: number|undefined = this.locks[key];
		if (lockEntry) {
			if (Date.now() < lockEntry) {
				return Promise.resolve(false);
			}
		}
		this.locks[key] = Date.now() + timeout;
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
}