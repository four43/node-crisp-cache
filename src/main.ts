import {EventEmitter} from "events";
import * as _ from "lodash";
import {AbstractBackend} from "./lib/Backends/AbstractBackend";
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
	backend?: AbstractBackend<T>,
	maxSize: number,
	emitEvents?: boolean,
	events?: {[id: CrispCacheEvent]: GeneralErrorFirstCallback}
};
export type CrispCacheOptions<T> = {
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
	emitEvents: boolean
};
export type GeneralErrorFirstCallback = {(error: Error, result: any): void};
export type ErrorFirstValueCallback<T> = {(error: Error, result: T): void};

type GetOptions = {
	forceFetch: boolean,
	skipFetch: boolean
}

export enum CrispCacheEvent {
	HIT,
	MISS,
	FETCH,
	FETCH_DONE,
	STALE_CHECK,
	STALE_CHECK_DONE,
	EXPIRES_CHECK,
	EXPIRES_CHECK_DONE
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
	public backend: AbstractBackend<T>;
	public locks: {(key: string): Promise<T>};

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
		this.backend = opts.backend || new Memory<T>();


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
	get(key: string, options?: GetOptions, callback?: ErrorFirstValueCallback<T>): Promise<T> {
		//Parse Args
		if (typeof options === 'function' && !callback) {
			callback = options;
			options = {};
		}

		const getPromise = this.backend.get(key)
			.then(cacheEntry => {
				if (value === undefined || options.forceFetch) {
					//Cache miss.
					this._emit(CrispCache.EVENT_MISS, {key: key});

					return (options.skipFetch) ? undefined : this._fetch(key);
				}
				else {
					//Cache hit, what is the state?
					if (cacheEntry.isValid()) {
						this._emit(CrispCache.EVENT_HIT, {key: key, entry: cacheEntry});

						if (this._lru) {
							this._lru.put(key, cacheEntry.getSize());
						}
						return cacheEntry.getValue();
					}
					else if (cacheEntry.isStale()) {
						//Stale, try and update the cache but return what we have.
						this._emit(CrispCache.EVENT_HIT, {key: key, entry: cacheEntry});

						if (this._lru) {
							this._lru.put(key, cacheEntry.getSize());
						}
						this._fetch(key, {
							staleTtl: cacheEntry.staleTtl,
							expiresTtl: cacheEntry.expiresTtl
						});
						return cacheEntry.getValue();
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
	 * Stale Check
	 *
	 * Checks for stale keys and will try and update them. Should be called on an interval.
	 * @private
	 */
	private _staleCheck() {
		//This is a little gross for efficiency, this.cache will just have basic keys on it, no need to double check.
		this._emit(CrispCacheEvent.STALE_CHECK);
		var cacheEntry,
			refetchKeys = [];
		for (var key in this.cache) {
			cacheEntry = this.cache[key];
			if (cacheEntry.isStale()) {
				debug("- " + key + " was found to be stale, re-fetching");
				this._fetch(key, {
					staleTtl: cacheEntry.staleTtl,
					expiresTtl: cacheEntry.expiresTtl
				});
				if (this.emitEvents) {
					refetchKeys.push(key);
				}
			}
		}
		this._emit(CrispCacheEvent.STALE_CHECK_DONE, refetchKeys);
	};

	/**
	 * Evict Check
	 *
	 * Evict expired keys, free up some memory. This should be called on an interval.
	 * @private
	 */
	private _expiresCheck() {
		//This is a little gross for efficiency, this.cache will just have basic keys on it, no need to double check.

		this._emit(CrispCacheEvent.EXPIRES_CHECK);

		let cacheEntry: CacheEntry<T>,
			evicted = {};
		for (var key in this.cache) {
			cacheEntry = this.cache[key];
			if (cacheEntry.isExpired()) {
				this.del(key);
				if (this.emitEvents) {
					evicted[key] = cacheEntry;
				}
			}
		}

		this._emit(CrispCacheEvent.EXPIRES_CHECK_DONE, evicted);
	};

	// "private"
	private _emit(name: CrispCacheEvent, options?: any) {
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

/**
 *
 * @param {string} key
 * @param {{skipFetch:boolean}} [options]
 * @param {valueCb} callback
 * @returns {*}
 */
CrispCache.prototype.get = function (key, options, callback) {

};

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
 * Delete
 *
 * Removes and item from the cache, ensures all locks are cleaned up before removing.
 * @param {string} key
 * @param {{}} options
 * @param {valueCb} [callback]
 * @returns {*}
 */
CrispCache.prototype.del = function (key, options, callback) {
	if (typeof options === 'function' && !callback) {
		callback = options;
		options = {};
	}
	if (options === undefined) {
		options = {}
	}

	if (this._lru && !options.skipLruDelete) {
		this._lru.del(key, true);
	}
	delete this.cache[key];
	this._resolveLocks(key, undefined);
	if (callback) {
		return callback(null, true);
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
CrispCache.prototype._fetch = function (key, options, callback) {
	//Parse Args
	if (typeof options === 'function' && !callback) {
		callback = options;
		options = {};
	}

	if (callback === undefined) {
		callback = function (err, value) {
			debug('Fetched ' + key + ': ' + value);
		}
	}
	if (this._lock(key, callback)) {
		this._emit(CrispCache.EVENT_FETCH, {key: key});
		this.fetcher(key, function (err, value, fetcherOptions) {
			this._emit(CrispCache.EVENT_FETCH_DONE, {key: key, value: value, options: fetcherOptions});
			if (err) {
				debug("Issue with fetcher, resolving in error");
				this._resolveLocks(key, undefined, err);
				return;
			}

			debug("Got value: " + value + " from fetcher for key: " + key);

			if (fetcherOptions) {
				var staleTtl = fetcherOptions.staleTtl,
					expiresTtl = fetcherOptions.expiresTtl,
					size = fetcherOptions.size;

				if (staleTtl !== undefined) {
					options.staleTtl = staleTtl;
				}
				if (expiresTtl !== undefined) {
					options.expiresTtl = expiresTtl;
				}
				if (size !== undefined) {
					options.size = size;
				}
			}
			this.set(key, value, options);
		}.bind(this));
	}
};


/**
 * Lock
 *
 * Adds a callback to the locks for this key.
 * @param {string} key
 * @param {valueCb} callbackToAdd
 * @return {bool} Whether we were able to acquire the lock or not.
 * @private
 */
CrispCache.prototype._lock = function (key, callbackToAdd) {
	if (this.locks[key] === undefined) {
		this.locks[key] = [callbackToAdd];
		return true;
	}
	else {
		this.locks[key].push(callbackToAdd);
		return false;
	}
};

/**
 * Resolve Locks
 *
 * Resolves all the locks for a given key with the supplied value.
 * @param {string}key
 * @param value
 * @private
 */
CrispCache.prototype._resolveLocks = function (key, value, err) {
	if (this.locks[key]) {
		//Clear out anyone waiting on this key.
		var locks = this.locks[key];
		delete this.locks[key];
		locks.map(function (lockCb) {
			if (err) {
				return lockCb(err);
			}
			return lockCb(null, value);
		});
	}
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



