import {EventEmitter} from "events";
import * as _ from "lodash";
import {IBackend, NextResult} from "./lib/Backends/BackendInterface";
import CacheEntry from "./lib/CacheEntry";
import {Lru} from "./lib/Backends/Memory/ExpireStrategies/Lru";
import Memory from "./lib/Backends/Memory/Memory";

export type CrispCacheConstructOptions<T> = {
	fetcher: { (key: string, cb: ErrorFirstValueCallback<T>): void } | {(...args:any[]):Promise<any>},
	fetchTimeout?: number,
	maxSize: number,
	defaultTtls?: {
		stale?: number,
		staleVariance?: number,
		expires?: number,
		expiresVariance?: number
	},
	checkIntervals?: {
		stale?: number,
		expires?: number
	},
	backend?: IBackend<CacheEntry<T>>,
	events?: { [id: string]: GeneralErrorFirstCallback }
};
export type CrispCacheOptions<T> = {
	fetchTimeout: number,
	defaultTtls: {
		stale: number,
		staleVariance: number,
		expires: number,
		expiresVariance: number
	},
	checkIntervals: {
		stale: number,
		expires: number
	}
};
export type GeneralErrorFirstCallback = { (error: Error | null, result: any): void };
export type ErrorFirstBooleanCallback = { (error: Error | null, result: boolean): void };
export type ErrorFirstValueCallback<T> = { (error: Error | null, result?: T | undefined): void };

const SECOND = 1000;
const MINUTE = 60 * SECOND;

type GetOptions = {
	forceFetch?: boolean,
	skipFetch?: boolean
}

type WrapCallOptions<T> = Partial<CrispCacheConstructOptions<T>> & {
	createKey?: { (...args: any[]): string },
	parseKey?: { (key: string): any[] }
}

type WrapOptions<T> = Partial<CrispCacheConstructOptions<T>> & {
	maxSize: number,
	createKey: { (...args: any[]): string },
	parseKey: { (key: string): any[] }
}

export type CrispCacheEvents =
	'hit'
	| 'miss'
	| 'fetch'
	| 'fetch_done'
	| 'stale_check'
	| 'stale_check_done'
	| 'expires_check'
	| 'expires_check_done';

/**
 * @param {{}} opts
 * @param {{}} opts.defaultTtls The default TTL settings for the cache
 * @param {Number} [opts.defaultTtls.stale=300] The default stale setting (in ms) when the cache should start auto-refetching.
 * @param {Number} [opts.maxSize] Maximum size of the cache (arbitrary size, relates to user specified size on fetch/set) via LRU
 * @constructor
 */
export default class CrispCache<T> extends EventEmitter {

	public options: CrispCacheOptions<T>;
	public fetcher: { (key: string): Promise<T> };
	public backend: IBackend<CacheEntry<T>>;
	public locks: { [id: string]: Deferred<T>[] } = {};

	public static keyIdCounter: number = 0;

	constructor(opts: CrispCacheConstructOptions<T>) {
		super();

		this.options = {
			fetchTimeout: 3 * SECOND,
			...opts,
			defaultTtls: {
				stale: 5 * MINUTE,
				staleVariance: 50 * SECOND,
				expires: 10 * MINUTE,
				expiresVariance: 0,
				...opts.defaultTtls
			},
			checkIntervals: {
				stale: 10 * SECOND,
				expires: 10 * MINUTE,
				...opts.checkIntervals
			}
		};
		if (opts.backend) {
			this.backend = opts.backend;
		}
		else {
			// Default to an in-memory cache with LRU expiration strategy
			this.backend = new Memory<CacheEntry<T>>({
				expireStrategy: new Lru({
					maxSize: opts.maxSize
				})
			});
		}


		//Fetcher
		if (!opts.fetcher) {
			throw new Error("Must pass a fetcherCb option, a fetcherCb is a function(key, callback) that can retrieve a key from a repository");
		}

		// Wrap the fetcherCb with error handling, and convert to a promise if it isn't already.
		// Additional care to catch synchronous errors
		this.fetcher = function (key: string) {
			return new Promise((res, rej) => {
				const cb = (err: Error, result: T) => {
					if (err) return rej(err);
					res(result);
				};
				try {
					const fetcherResult = this.options.fetcher(key, cb);
					if (fetcherResult instanceof Promise) {
						fetcherResult.then(res).catch(rej);
					}
				}
				catch (err) {
					rej(err);
				}
			});
		};

		// Initialize Intervals
		if (this.options.checkIntervals && this.options.checkIntervals.stale > 0) {
			setInterval(this.staleCheck.bind(this), this.options.checkIntervals.stale);
		}

		// Expires Control
		if (this.options.checkIntervals && this.options.checkIntervals.expires > 0) {
			setInterval(this.expiresCheck.bind(this), this.options.checkIntervals.expires);
		}

		//Bind to user supplied events
		if (opts.events) {
			bindEventMap(opts.events, this);
		}
	}

	// @todo figure out function overloading
	async get(key: string, options?: GetOptions | ErrorFirstValueCallback<T>, callback?: ErrorFirstValueCallback<T>): Promise<T | undefined> {

		if (isValueCallback<T, GetOptions>(options)) {
			callback = options;
			options = {};
		}
		if (options === undefined) {
			options = {};
		}

		try {
			const cacheEntry = await this.backend.get(key);
			let value: T | undefined;
			if (cacheEntry === undefined || (options && options.forceFetch)) {
				//Cache miss.
				this._emit('miss', {key: key});
				if (options && options.skipFetch) {
					value = undefined;
				}
				else {
					value = await this.fetch(key);
				}
			}
			else {
				//Cache hit, what is the state?
				if (cacheEntry.isValid()) {
					this._emit('hit', {key: key, entry: cacheEntry});
					value = cacheEntry.value;
				}
				else if (cacheEntry.isStale()) {
					//Stale, try and update the cache but return what we have.
					this._emit('hit', {key: key, entry: cacheEntry});

					this.fetch(key, {
						ttls: cacheEntry.ttls,
						size: cacheEntry.size || 1
					});
					value = cacheEntry.value;
				}
				else if (cacheEntry.isExpired()) {
					this._emit('miss', {key: key, entry: cacheEntry});
					if (options && options.skipFetch) {
						//Don't re-fetch
						this.delete(key);
						value = undefined;
					}
					else {
						//Fetch this key
						value = await this.fetch(key, {
							ttls: cacheEntry.ttls
						});
					}
				}
			}
			if (callback) {
				callback(null, value);
			}
			return value;
		}
		catch (err) {
			if (callback) {
				callback(err);
			}
			throw err;
		}
	}

	async set(key: string, value: T, options: { ttls: { stale?: number, expires?: number }, size?: number } = {
		ttls: {
			stale: undefined,
			expires: undefined
		}, size: 1
	}, callback?: ErrorFirstValueCallback<T>): Promise<void> {

		// Set default options
		if (options.ttls.stale === undefined) {
			options.ttls.stale = this.getDefaultStaleTtl();
		}
		if (options.ttls.expires === undefined) {
			options.ttls.expires = this.getDefaultExpiresTtl();
		}
		if (options.size === undefined) {
			options.size = 1;
		}

		const cacheEntry = new CacheEntry<T>({
			ttls: {
				stale: options.ttls.stale,
				expires: options.ttls.expires
			},
			size: options.size,
			value
		});

		if (options.ttls.expires > 0) {
			await this.backend.set(key, cacheEntry, cacheEntry.size);
		}
		this.resolveLocks(key, cacheEntry.value);
		if (callback) {
			callback(null, value);
		}
	};

	/**
	 * Delete
	 *
	 * Removes and item from the cache, ensures all locks are cleaned up before removing.
	 * @param {string} key
	 * @param {{}} options
	 * @param {valueCb} [callback]
	 * @returns {*}
	 */
	async delete(key: string): Promise<void>;
	async delete(key: string, callback?: ErrorFirstBooleanCallback): Promise<void> {
		await this.backend.delete(key);
		this.resolveLocks(key, undefined);
		if (callback) {
			return callback(null, true);
		}
	};

	public static wrapPromise<T>(origFn: T, options: WrapCallOptions<T> = {}): T {
		const cacheOptions = setDefaultWrapOptions<T>(options);

		// @todo Fix this type hack
		const origFetcher = origFn as any as {(...args:any[]):Promise<any>};

		cacheOptions.fetcher = (key:string) => {
			let args;
			try {
				args = cacheOptions.parseKey(key);
			}
			catch (err) {
				throw new Error('Failed to parse cache key: ' + key);
			}

			if (!Array.isArray(args)) {
				throw new Error('CrispCache.wrap `parseKey` must return an array of arguments');
			}
			return origFetcher.apply(null, args);
		};

		const cache = new CrispCache(<CrispCacheConstructOptions<T>>options);

		return ((...args: any[]) => {
			let key = cacheOptions.createKey.apply(null, args);

			if (Object.prototype.toString.call(key) !== '[object String]') {
				throw new Error('Failed to create cache key');
			}

			return cache.get(key);
		}) as any as T
	}

	// public wrap(origFn: ErrorFirstValueCallback<T>|FetcherProimse<T>, options: WrapCallOptions<T> = {}) {
	//
	// 	options = setDefaultWrapOptions<T>(options);
	//
	// 	const fetcherCb = (key: string): Promise<T> => {
	// 		let args, wrapperCb;
	// 		try {
	// 			args = options.parseKey(key);
	// 		}
	// 		catch (err) {
	// 			throw new Error('Failed to parse cache key: ' + key);
	// 		}
	//
	// 		if (!Array.isArray(args)) {
	// 			throw new Error('CrispCache.wrap `parseKey` must return an array of arguments');
	// 		}
	//
	// 		const result = new Deferred<T>();
	//
	// 		// Wrap the original fn's callback,
	// 		// to send back cacheOptions along with the resolved value
	// 		wrapperCb = function (err: Error, val: T) {
	// 			if (err) {
	// 				return result.reject(err);
	// 			}
	//
	// 			try {
	// 				let cacheOptions = options.getOptions ? options.getOptions(val, args) : {};
	// 			}
	// 			catch (err) {
	// 				return result.reject(err);
	// 			}
	//
	// 			result.resolve(val);
	// 		};
	// 		origFn.apply(null, args.concat(wrapperCb));
	//
	// 		return result.promise;
	// 	};
	//
	// 	const cacheOptions: {
	// 		createKey: {(...args: any[]): string},
	// 		parseKey: {(key: string): any[]},
	// 		fetcherCb?: Promise<T>
	// 	} = {
	// 		createKey: options.createKey,
	// 		parseKey: options.parseKey
	// 	};
	//
	// 	const cache = new CrispCache(options);
	//
	// 	return function () {
	// 		var args = Array.prototype.slice.call(arguments, 0);
	// 		var cb = args.pop();
	// 		var key = options.createKey.apply(null, args);
	//
	// 		if (Object.prototype.toString.call(key) !== '[object String]') {
	// 			return cb(new Error('Failed to create cache key'));
	// 		}
	//
	// 		cache.get(key, cb);
	// 	}
	// };

	async clear(): Promise<void> {
		await this.backend.clear();
	}

	async getUsage(): Promise<{ size: number, maxSize: number }> {
		return await this.backend.getUsage();
	}

	/**
	 * Fetch
	 *
	 * Fetches a key from the data provider, the via the provided fetch callable when this object was created.
	 *
	 * @private
	 */
	private async fetch(key: string,
	                    options: { ttls: { stale: number, expires: number }, size?: number } = {
		                    ttls: {
			                    stale: 0,
			                    expires: 0
		                    }, size: 1
	                    }): Promise<T> {

		const doneFetching = new Deferred<T>();

		if (await this.lock(key, doneFetching)) {
			this._emit('fetch', {key: key});
			try {
				const value = await this.fetcher(key);
				this._emit('fetch_done', {key: key, value: value});
				// Set resolves locks for us
				this.set(key, value, {
					ttls: {
						stale: options.ttls.stale || this.options.defaultTtls.stale,
						expires: options.ttls.expires || this.options.defaultTtls.expires
					}
				});
			} catch (err) {
				// @todo do more with the fetcherCb error
				this.resolveLocks(key, undefined, err);
			}
		}
		return doneFetching.promise;
	};


	/**
	 * Lock
	 *
	 * Adds a reference to a promise to the locks for this key.
	 * @param {string} key
	 * @param {Promise} resultDeferred
	 * @return {bool} Whether we were able to acquire the lock or not.
	 * @private
	 */
	private async lock(key: string, resultDeferred: Deferred<T>): Promise<boolean> {
		if (this.locks[key]) {
			this.locks[key].push(resultDeferred);
		}
		else {
			this.locks[key] = [resultDeferred];
		}
		return await this.backend.lock(key, this.options.fetchTimeout);
	};

	/**
	 * Resolve Locks
	 *
	 * Resolves all the locks for a given key with the supplied value.
	 * @private
	 */
	private async resolveLocks(key: string, value: T | undefined, err?: Error) {
		if (this.locks[key]) {
			//Clear out anyone waiting on this key.
			if (err) {
				this.locks[key].map(deferred => deferred.reject(err));
			}
			else {
				this.locks[key].map(deferred => deferred.resolve(value));
			}
			delete this.locks[key];
		}
		return this.backend.unlock(key);
	};

	/**
	 * Stale Check
	 *
	 * Checks for stale keys and will try and update them. Should be called on an interval.
	 * @private
	 */
	private async staleCheck() {
		this._emit('stale_check');

		const refetchKeys: string[] = [];
		let cursorResult: NextResult<CacheEntry<T>> | null = await this.backend.next();
		if (cursorResult) {
			const cacheEntry = cursorResult.value;
			if (cacheEntry.isStale()) {
				const ttls = cacheEntry.ttls;
				this.fetch(cursorResult.key, {ttls});
				refetchKeys.push(cursorResult.key);
			}
		}

		this._emit('stale_check_done', refetchKeys);
	};

	/**
	 * Evict Check
	 *
	 * Evict expired keys, free up some memory. This should be called on an interval.
	 * @private
	 */
	private async expiresCheck() {
		this._emit('expires_check');

		const expiredKeys: string[] = [];
		let cursorResult: NextResult<CacheEntry<T>> | null = await this.backend.next();
		if (cursorResult) {
			const cacheEntry = cursorResult.value;
			if (cacheEntry.isExpired()) {
				this.delete(cursorResult.key);
				expiredKeys.push(cursorResult.key);
			}
		}

		this._emit('expires_check_done', expiredKeys);
	};

	private _emit(name: CrispCacheEvents, options?: any) {
		this.emit(name, options);
	};

	private getDefaultStaleTtl(): number {
		if (this.options.defaultTtls.staleVariance) {
			return Math.round(this.options.defaultTtls.stale + (Math.random() * this.options.defaultTtls.staleVariance) - (this.options.defaultTtls.staleVariance / 2));
		}
		else {
			return this.options.defaultTtls.stale;
		}
	}

	private getDefaultExpiresTtl(): number {
		if (this.options.defaultTtls.expiresVariance) {
			return Math.round(this.options.defaultTtls.expires + (Math.random() * this.options.defaultTtls.expiresVariance) - (this.options.defaultTtls.expiresVariance / 2));
		}
		else {
			return this.options.defaultTtls.expires;
		}
	}
}

class Deferred<T> {

	public promise: Promise<T>;
	public resolve: (value: T | PromiseLike<T> | undefined) => void;
	public reject: (reason?: any) => void;

	constructor() {
		this.promise = new Promise<T>((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
	}
}


/**
 * Bind to user supplied event map, where key is event name
 */
function bindEventMap(eventMap: { [id: string]: GeneralErrorFirstCallback }, eventEmitter: EventEmitter): void {
	Object.keys(eventMap)
		.map(function (eventName) {
			eventEmitter.on(eventName, eventMap[eventName]);
		});
}

function setDefaultWrapOptions<T>(options: WrapCallOptions<T>): WrapOptions<T> {
	if (!options.createKey) {
		// Cache has a single entry, with a single constant key
		options.createKey = function (...args: any[]) {
			return args.map(arg => arg.toString()).join('!!CRISPCACHE!!');
		};
	}
	if (!options.parseKey) {
		// OrigFn receives no arguments (besides cb)
		options.parseKey = function (key) {
			return key.split('!!CRISPCACHE!!');
		};
	}
	if (options.maxSize === undefined) {
		options.maxSize = Infinity;
	}
	return Object.assign(options,
		{
			maxSize: options.maxSize,
			createKey: options.createKey,
			parseKey: options.parseKey
		});
}

function isValueCallback<T, Other>(cb: Other | ErrorFirstValueCallback<T> | undefined): cb is ErrorFirstValueCallback<T> {
	return (typeof cb === 'function');
}

