import {EventEmitter} from "events";
import * as _ from "lodash";
import {AbstractBackend, NextResult} from "./lib/Backends/AbstractBackend";
import {Memory} from "./lib/Backends/Memory";
import CacheEntry from "./lib/CacheEntry";

export type CrispCacheConstructOptions<T> = {
	fetcher: {(key: string, cb?: ErrorFirstValueCallback<T>): Promise<T>},
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
	backend?: AbstractBackend<CacheEntry<T>>,
	maxSize: number,
	emitEvents?: boolean,
	events?: {[id: string]: GeneralErrorFirstCallback}
};
export type CrispCacheOptions<T> = {
	defaultTtls: {
		stale: number,
		staleVariance: number,
		expires: number,
		expiresVariance: number
	},
	checkIntervals: {
		stale: number,
		expires: number
	},
	emitEvents: boolean
};
export type GeneralErrorFirstCallback = {(error: Error, result: any): void};
export type ErrorFirstValueCallback<T> = {(error: Error, result: T): void};

type GetOptions = {
	forceFetch: boolean,
	skipFetch: boolean
}

export class CrispCacheEvents {
	static readonly HIT = 'hit';
	static readonly MISS = 'miss';
	static readonly FETCH = 'fetch';
	static readonly FETCH_DONE = 'fetch_done';
	static readonly STALE_CHECK = 'stale_check';
	static readonly STALE_CHECK_DONE = 'stale_check_done';
	static readonly EXPIRES_CHECK = 'expires_check';
	static readonly EXPIRES_CHECK_DONE = 'expires_check_done';
}

/**
 * @param {{}} opts
 * @param {{}} opts.defaultTtls The default TTL settings for the cache
 * @param {Number} [opts.defaultTtls.stale=300] The default stale setting (in ms) when the cache should start auto-refetching.
 * @param {Number} [opts.maxSize] Maximum size of the cache (arbitrary size, relates to user specified size on fetch/set) via LRU
 * @constructor
 */
export default class CrispCache<T> extends EventEmitter {

	public options: CrispCacheOptions<T>;
	public fetcher: {(key: string): Promise<T>};
	public backend: AbstractBackend<CacheEntry<T>>;
	public locks: {[id: string]: Deferred<T>[]} = {};

	public static EVENTS = CrispCacheEvents;

	constructor(opts: CrispCacheConstructOptions<T>) {
		super();
		this.options = _.defaultsDeep<CrispCacheConstructOptions<T>,CrispCacheOptions<T>>(opts, {
			defaultTtls: {
				stale: 300000,
				staleVariance: 50000,
				expires: 500000,
				expiresVariance: 0
			},
			checkIntervals: {
				stale: 100000,
				expires: 1000000
			},
			emitEvents: false
		});
		this.backend = opts.backend || new Memory<CacheEntry<T>>();


		//Fetcher
		if (!opts.fetcher) {
			throw new Error("Must pass a fetcher option, a fetcher is a function(key, callback) that can retrieve a key from a repository");
		}

		// Wrap the fetcher with error handling, and convert to a promise if it isn't already.
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
			setInterval(this._staleCheck.bind(this), this.options.checkIntervals.stale);
		}

		// Expires Control
		if (this.options.checkIntervals && this.options.checkIntervals.expires > 0) {
			setInterval(this._expiresCheck.bind(this), this.options.checkIntervals.expires);
		}

		if (opts.maxSize) {
			var Lru = require('./lib/ExpireStrategies/Lru');
			this._lru = new Lru({
				maxSize: opts.maxSize,
				delCallback: this.del.bind(this)
			});
		}

		//Bind to user supplied events
		if (this.options.emitEvents && opts.events) {
			bindEventMap(opts.events, this);
		}
	}

	/**
	 *
	 * @param {String} key
	 * @param {{}} options
	 * @param {Boolean} [options.forceFetch=false] Force the fetcher to re-fetch this result
	 * @param {Boolean} [options.skipFetch=false] Skip the fetcher and only use the cache (overrides forceFetch)
	 * @param callback
	 * @returns {Promise.<TResult>|*}
	 */
	async get(key: string): Promise<T|undefined>;
	async get(key: string, options: GetOptions): Promise<T|undefined>;
	async get(key: string, options?: GetOptions, callback?: ErrorFirstValueCallback<T>): Promise<T|undefined> {

		const getPromise = this.backend.get(key)
			.then(cacheEntry => {
				if (cacheEntry === null || (options && options.forceFetch)) {
					//Cache miss.
					this._emit(CrispCache.EVENTS.MISS, {key: key});

					return (options && options.skipFetch) ? null : this.fetch(key);
				}
				else {
					//Cache hit, what is the state?
					if (cacheEntry.isValid()) {
						this._emit(CrispCache.EVENTS.HIT, {key: key, entry: cacheEntry});

						if (this._lru) {
							this._lru.put(key, cacheEntry.getSize());
						}
						return cacheEntry.value;
					}
					else if (cacheEntry.isStale()) {
						//Stale, try and update the cache but return what we have.
						this._emit(CrispCache.EVENTS.HIT, {key: key, entry: cacheEntry});

						if (this._lru) {
							this._lru.put(key, cacheEntry.getSize());
						}
						this.fetch(key, {
							ttls: cacheEntry.ttls,
							size: cacheEntry.size || 1
						});
						return cacheEntry.value;
					}
					else if (cacheEntry.isExpired()) {
						this._emit(CrispCache.EVENT_MISS, {key: key, entry: cacheEntry});
						if (options.skipFetch) {
							//Don't re-fetch
							this.del(key);
							return undefined;
						}
						else {
							//Fetch this key
							return this._fetch(key, {
								staleTtl: cacheEntry.staleTtl,
								expiresTtl: cacheEntry.expiresTtl
							});
						}
					}
				}
			});
		return callbackify(getPromise, callback);

	}

	/**
	 * Delete
	 *
	 * Removes and item from the cache, ensures all locks are cleaned up before removing.
	 * @param {string} key
	 * @param {{}} options
	 * @param {valueCb} [callback]
	 * @returns {*}
	 */
	async del(key: string): Promise<void>;
	async del(key: string, options?: {skipLruDelete?: boolean}): Promise<void>;
	async del(key: string, callback?: ErrorFirstValueCallback<T>): Promise<void>;
	async del(key: string, options?: {skipLruDelete?: boolean}, callback?: ErrorFirstValueCallback<T>): Promise<void> {

		if (this._lru && !options.skipLruDelete) {
			this._lru.del(key, true);
		}
		await this.backend.del(key);
		this._resolveLocks(key, undefined);
		if (callback) {
			return callback(null, true);
		}
	};

	/**
	 * Fetch
	 *
	 * Fetches a key from the data provider, the via the provided fetch callable when this object was created.
	 *
	 * @param {string} key
	 * @param {{}|function} options - An options object or a callback
	 * @param {valueCb} [callback] - If options, an error first callback
	 * @returns {Number|*}
	 * @private
	 */
	private async fetch(key: string): Promise<CacheEntry<T>>
	private async fetch(key: string,
	                     options: {ttls: {stale: number, expires: number}, size?: number} = {ttls: {stale: 0, expires: 0}, size: 1}): Promise<CacheEntry<T>> {
		const doneFetching = new Deferred();

		this.lock(key, doneFetching)
			.then(() => {
				this._emit(CrispCache.EVENTS.FETCH, {key: key});
				this.fetcher(key)
					.then(value => {
						this._emit(CrispCache.EVENTS.FETCH_DONE, {key: key, value: value});
						this.set(key, value, {
							ttls: {
								stale: options.ttls.stale || this.options.defaultTtls.stale,
								expires: options.ttls.expires || this.options.defaultTtls.expires
							}
						});
					})
					.catch(err => {
						this.resolveLocks(key, undefined, err);
						return;
					});
			});
		return doneFetching;
	};


	/**
	 * Lock
	 *
	 * Adds a callback to the locks for this key.
	 * @param {string} key
	 * @param {Promise} resultPromise
	 * @return {bool} Whether we were able to acquire the lock or not.
	 * @private
	 */
	private async lock(key: string, resultPromise: Deferred<T>):Promise<boolean> {
		if (await this.backend.lock) {
			this.locks[key] = [resultPromise];
			return true;
		}
		else {
			this.locks[key].push(resultPromise);
			return false;
		}
	};

	/**
	 * Resolve Locks
	 *
	 * Resolves all the locks for a given key with the supplied value.
	 * @private
	 */
	private async resolveLocks(key: string, value: T|undefined, err?: Error) {
		if (this.locks[key]) {
			//Clear out anyone waiting on this key.
			if(err) {
				this.locks[key].map(promise => promise.reject(value));
			}
			else {
				this.locks[key].map(promise => promise.resolve(value));
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
	private async _staleCheck() {
		this._emit(CrispCacheEvents.STALE_CHECK);

		const refetchKeys: string[] = [];
		let cursorResult: NextResult<CacheEntry<T>>|false = await this.backend.next();
		if (cursorResult) {
			const cacheEntry = cursorResult.value;
			if (cacheEntry.isStale()) {
				const ttls = cacheEntry.ttls();
				this._fetch(cursorResult.key, {
					staleTtl: ttls.stale,
					expiresTtl: ttls.expiresTtl
				});
				refetchKeys.push(cursorResult.key);
			}
		}

		this._emit(CrispCacheEvents.STALE_CHECK_DONE, refetchKeys);
	};

	/**
	 * Evict Check
	 *
	 * Evict expired keys, free up some memory. This should be called on an interval.
	 * @private
	 */
	private async _expiresCheck() {
		this._emit(CrispCacheEvents.EXPIRES_CHECK);

		const expiredKeys: string[] = [];
		let cursorResult: NextResult<CacheEntry<T>>|false = await this.backend.next();
		if (cursorResult) {
			const cacheEntry = cursorResult.value;
			if (cacheEntry.isExpired()) {
				this.del(cursorResult.key);
				expiredKeys.push(cursorResult.key);
			}
		}

		this._emit(CrispCacheEvents.EXPIRES_CHECK_DONE, expiredKeys);
	};

	private _emit(name: CrispCacheEvents, options?: any) {
		if (this.options.emitEvents) {
			this.emit(name.toString(), options);
		}
	};

}

function callbackify(promise, callback) {
	if (typeof callback === 'function') {
		return promise
			.then(value => {
				return callback(null, value);
			})
			.catch(err => {
				return callback(err);
			});
	}
	return promise;
}

class Deferred<T> implements Promise<T> {

	private promise:Promise<T>;
	public resolve:(value: T | PromiseLike<T> | undefined) => void;
	public reject:(reason?: any) => void;

	public then:(result:T) => Promise<T>;
	public catch: (onrejected: (reason: any) => T | PromiseLike<T>) => Promise<T>;
	public [Symbol.toStringTag]: "Promise";

	constructor() {
		this.promise = new Promise<T>((resolve, reject)=> {
			this.resolve = resolve;
			this.reject = reject;
		});

		this.then = this.promise.then;
		this.catch = this.promise.catch;
	}
}

/**
 * Set
 *
 * Sets a value to a key.
 * @param {string} key
 * @param value
 * @param {{staleTtl:Number, expiresTtl:Number}}options
 * @param {valueCb} [callback]
 */
CrispCache.prototype.set = function (key, value, options, callback) {
	//Parse Args
	debug("Set " + key + ": ", value);
	if (typeof options === 'function' && !callback) {
		callback = options;
		options = {};
	}
	// Set default options
	'staleTtl' in options || (options.staleTtl = this._getDefaultStaleTtl());
	'expiresTtl' in options || (options.expiresTtl = this._getDefaultExpiresTtl());
	'size' in options || (options.size = 1);

	if (options.expiresTtl > 0) {
		var cacheEntry = new CacheEntry({
			value: value,
			staleTtl: options.staleTtl,
			expiresTtl: options.expiresTtl,
			size: options.size
		});
		this.cache[key] = cacheEntry;
		if (this._lru) {
			this._lru.put(key, cacheEntry.size);
		}
	}
	this._resolveLocks(key, value);
	if (callback) {
		callback(null, true);
	}
};

/**
 * Clears the cache of all entries.
 *
 * @todo Should probably have an event on this.
 * @param callback
 * @returns {*}
 */
CrispCache.prototype.clear = function (callback) {
	this.cache = {};
	if (this._lru) {
		this._lru.clear();
	}
	return callback(null, true);
};

CrispCache.prototype.getUsage = function () {
	if (this._lru) {
		return {
			size: this._lru.size,
			maxSize: this._lru.maxSize
		}
	}
	return {};
};


/**
 * @returns {Number}
 * @private
 */
CrispCache.prototype._getDefaultStaleTtl = function () {
	if (this.staleTtlVariance) {
		return Math.round(this.defaultStaleTtl + (Math.random() * this.staleTtlVariance) - (this.staleTtlVariance / 2));
	}
	else {
		return this.defaultStaleTtl
	}
};

/**
 *
 * @returns {Number}
 * @private
 */
CrispCache.prototype._getDefaultExpiresTtl = function () {
	if (this.expiresTtlVariance) {
		return Math.round(this.defaultExpiresTtl + (Math.random() * this.expiresTtlVariance) - (this.expiresTtlVariance / 2));
	}
	else {
		return this.defaultExpiresTtl
	}
};

CrispCache.prototype.// Unique id for key-less CrispCache.wrap
	var
keyIdCounter = 0;
/**
 * Create a cached version of an asynchronous function.
 *
 * @param {valueCb} origFn
 * @param {Object} options
 * @param {function(any*):string?} options.createKey
 * @param {function(string):any[]} options.parseKey
 * @returns {valueCb}
 */
CrispCache.wrap = function (origFn, options) {
	var cache;
	options || (options = {});

	// Use a static key, eg. for cached functions
	// which receive no arguments
	if (!options.createKey) {
		keyIdCounter++;
		var key = 'CRISP_CACHE_KEY_' + keyIdCounter;
		// Cache has a single entry, with a single constant key
		options.createKey = function () {
			return key;
		}
		// OrigFn receives no arguments (besides cb)
		options.parseKey = function (key) {
			return [];
		}
	}

	options.fetcher = function (key, cb) {
		var args, wrapperCb;
		try {
			args = options.parseKey(key);
		}
		catch (err) {
			cb(new Error('Failed to parse cache key: ' + key));
		}

		if (!Array.isArray(args)) {
			return cb(new Error('CrispCache.wrap `parseKey` must return an array of arguments'));
		}

		// Wrap the original fn's callback,
		// to send back cacheOptions along with the resolved value
		wrapperCb = function (err, val) {
			if (err) {
				return cb(err);
			}

			try {
				var cacheOptions = options.getOptions ? options.getOptions(val, args) : {};
			}
			catch (err) {
				return cb(err);
			}

			cb(null, val, cacheOptions);
		};

		origFn.apply(null, args.concat(wrapperCb));
	};

	cache = new CrispCache(options);

	return function () {
		var args = Array.prototype.slice.call(arguments, 0);
		var cb = args.pop();
		var key = options.createKey.apply(null, args);

		if (Object.prototype.toString.call(key) !== '[object String]') {
			return cb(new Error('Failed to create cache key'));
		}

		cache.get(key, cb);
	}
};


/**
 * Bind to user supplied event map, where key is event name
 */
function bindEventMap(eventMap: {[id: string]: GeneralErrorFirstCallback}, eventEmitter: EventEmitter): void {
	Object.keys(eventMap)
		.map(function (eventName) {
			eventEmitter.on(eventName, eventMap[eventName]);
		});
};

/**
 * @callback valueCb
 * @param {Error|null} error
 * @param [value] - Any result value, could be undefined if there is an error.
 */

/**
 * @callback successCb
 * @param {Error|null} error
 * @param {boolean} [success] - The success value, could be undefined if there is an error.
 */



