export interface IBackend<T> {

	get(key: string): Promise<T|undefined>;

	set(key: string, value: T, size?: number): Promise<T>;

	delete(key: string): Promise<void>;

	clear(): Promise<void>

	/**
	 *
	 * @param key
	 * @param timeout
	 * @return Promise<boolean> A boolean whether the lock acquisition was successful or not.
	 */
	lock(key: string, timeout?: number): Promise<boolean>;

	unlock(key: string): Promise<void>;

	next(cursor?: any): Promise<NextResult<T>|null>;

	getUsage(): Promise<{size:number, maxSize:number}>;
}

export interface NextResult<T> {
	key: string,
	value: T,
	next: () => Promise<NextResult<T>|null>
}