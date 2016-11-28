export abstract class AbstractBackend<T> {
	abstract async get(key: string): Promise<T>;

	abstract async set(key: string, value: T): Promise<T>;

	abstract async delete(key: string): Promise<void>;

	/**
	 *
	 * @param key
	 * @param timeout
	 * @return Promise<boolean> A boolean whether the lock acquisition was successful or not.
	 */
	abstract async lock(key: string, timeout?: number): Promise<boolean>;

	abstract async unlock(key: string): Promise<void>;

	abstract async next(cursor?: any): Promise<NextResult<T>|null>;
}

export interface NextResult<T> {
	key: string,
	value: T,
	next: () => Promise<NextResult<T>|null>
}