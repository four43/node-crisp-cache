import {AbstractBackend} from "./AbstractBackend";
import * as Backend from "../Util/LinkedHashMap";

export class Memory<T> implements AbstractBackend<T> {

	entries: Backend.LinkedHashMap<T>;

	constructor(opts?: any) {
		this.entries = new Backend.LinkedHashMap<T>();
	}

	async get(key: string): Promise<T> {
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

	async next(cursor?: Backend.Entry<T>): Promise<{value:T|null, next:() => any}> {
		const {value, next} = this.entries.next(cursor);
		return Promise.resolve({value, next});
	}
}