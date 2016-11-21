import {AbstractBackend, NextResult} from "./AbstractBackend";
import * as Backend from "../Util/LinkedHashMap";

export class Memory<T> implements AbstractBackend<T> {

	protected entries: Backend.LinkedHashMap<T>;
	protected locks: {[id:string]: number};

	constructor(opts?: any) {
		this.entries = new Backend.LinkedHashMap<T>();
		this.locks = {};
	}

	async get(key: string): Promise<T|undefined> {
		return Promise.resolve(this.entries.get(key));
	}

	async set(key: string, value: T): Promise<T> {
		this.entries.add(key, value);
		return Promise.resolve(value);
	}

	async del(key: string): Promise<void> {
		this.entries.del(key);
		return Promise.resolve();
	}

	async lock(key: string, timeout?:number): Promise<boolean> {
		const lockEntry:number|undefined = this.locks[key];
		if(lockEntry) {
			if(Date.now() < lockEntry) {
				return Promise.resolve(false);
			}
		}
		this.locks[key] = Date.now() + timeout;
		return Promise.resolve(true);
	}

	async unlock(key:string) :Promise<void> {
		delete this.locks[key];
		return Promise.resolve();
	}

	async next(cursor?:any): Promise<NextResult<T>|false> {
		if(cursor) {
			return Promise.resolve(cursor());
		}
		const result = this.entries.next(cursor);
		if(result) {
			return Promise.resolve({
				key: result.key,
				value: result.value,
				next: () => this.next(result.next)
			})
		}
		return false;
	}
}