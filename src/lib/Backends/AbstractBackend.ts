import CacheEntry from "../CacheEntry";

export abstract class AbstractBackend<T> {
	abstract async get(key: string): Promise<CacheEntry<T>>;

	abstract async set(key: string, value:T): Promise<CacheEntry<T>>;

	abstract async del(key: string): Promise<void>;
}