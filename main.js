var CacheEntry = require('./lib/CacheEntry'),
    debug = require('debug')('crisp-cache'),
    EventEmitter = require('events'),
    Lru = null,
    util = require('util');

/**
 *
 * @param options
 * @constructor
 */
function CrispCache(options) {
    if (options === undefined) {
        options = {};
    }

    //Fetcher
    if (!options.fetcher) {
        throw new Error("Must pass a fetcher option, a fetcher is a function(key, callback) that can retrieve a key from a repository");
    }
    // Wrap the fetcher with error handling,
    // to catch synchronous errors
    this.fetcher = function(key, cb) {
        try {
            return options.fetcher(key, cb);
        }
        catch (err) { cb(err); }
    };

    // Stale Control
    this.defaultStaleTtl = options.defaultStaleTtl;
    this.staleTtlVariance = options.staleTtlVariance || options.ttlVariance || 0;
    this.staleCheckInterval = options.staleCheckInterval;
    if (this.staleCheckInterval) {
        setInterval(this._staleCheck.bind(this), this.staleCheckInterval);
    }

    // Expires Control
    this.defaultExpiresTtl = options.defaultExpiresTtl || 0;
    this.expiresTtlVariance = options.expiresTtlVariance || options.ttlVariance || 0;
    this.evictCheckInterval = options.evictCheckInterval || 0;
    if (this.evictCheckInterval && this.evictCheckInterval > 0) {
        setInterval(this._evictCheck.bind(this), this.evictCheckInterval);
    }

    this.maxSize = options.maxSize;
    if (this.maxSize) {
        Lru = require('./lib/Lru');
        this._lru = new Lru({
            maxSize: this.maxSize,
            delCallback: this.del.bind(this)
        });
    }

    this.cache = {};
    this.locks = {};

    this.emitEvents = options.emitEvents !== undefined ? options.emitEvents : true;
    //Bind to user supplied events
    if(this.emitEvents && options.events) {
        bindEventMap(options.events, this);
    }
}
util.inherits(CrispCache, EventEmitter);

CrispCache.EVENT_HIT = 'hit';
CrispCache.EVENT_MISS = 'miss';
CrispCache.EVENT_FETCH = 'fetch';
CrispCache.EVENT_FETCH_DONE = 'fetchDone';
CrispCache.EVENT_STALE_CHECK = 'staleCheck';
CrispCache.EVENT_STALE_CHECK_DONE = 'staleCheckDone';
CrispCache.EVENT_EVICT_CHECK = 'evictCheck';
CrispCache.EVENT_EVICT_CHECK_DONE = 'evictCheckDone';

/**
 *
 * @param {string} key
 * @param {{skipFetch:boolean}} [options]
 * @param {valueCb} callback
 * @returns {*}
 */
CrispCache.prototype.get = function (key, options, callback) {
    //Parse Args
    debug("Get " + key + "...");
    if (typeof options === 'function' && !callback) {
        callback = options;
        options = {};
    }
    if (!callback) {
        throw new Error('Unable to retrieve "' + key + '" from cache: no callback provided');
    }

    if (this.cache[key] === undefined || options.forceFetch) {
        //Cache miss.
        debug("- MISS");

		this._emit(CrispCache.EVENT_MISS, { key: key });

        if (options.skipFetch) {
            debug(" - Skipping fetch, returning undefined");
            return callback(null, undefined);
        }
        else {
            //Fetch this key
            debug(" - Fetching, calling back when done");
            return this._fetch(key, callback);
        }
    }
    else {
        //Cache hit, what is the state?
        var cacheEntry = this.cache[key];

        if (cacheEntry.isValid()) {
            debug("- Hit");
            this._emit(CrispCache.EVENT_HIT, { key: key, entry: cacheEntry });

            if (this._lru) {
                this._lru.put(key, cacheEntry.size);
            }
            return callback(null, cacheEntry.getValue());
        }
        else if (cacheEntry.isStale()) {
            //Stale, try and update the cache but return what we have.
            debug("- Hit, Stale");
            this._emit(CrispCache.EVENT_HIT, { key: key, entry: cacheEntry });

            debug("- Stale, returning current value but re-fetching");
            if (this._lru) {
                this._lru.put(key, cacheEntry.size);
            }
            callback(null, cacheEntry.getValue());
            this._fetch(key, {
                staleTtl: cacheEntry.staleTtl,
                expiresTtl: cacheEntry.expiresTtl
            });
        }
        else if (cacheEntry.isExpired()) {
            debug("- Hit, but expired");
            this._emit(CrispCache.EVENT_MISS, { key: key, entry: cacheEntry });
            if (options.skipFetch) {
                //Don't re-fetch
                debug(" - Skipping fetch, deleting and returning undefined");
                this.del(key);
                return callback(null, undefined);
            }
            else {
                //Fetch this key
                debug(" - Fetching, will callback when we have it");
                this.del(key, function (err, success) {
                    this._fetch(key, {
                        staleTtl: cacheEntry.staleTtl,
                        expiresTtl: cacheEntry.expiresTtl
                    }, callback);
                }.bind(this));
            }
        }
    }
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

    var staleTtl = options.staleTtl,
        expiresTtl = options.expiresTtl;

    if (staleTtl === undefined) {
        staleTtl = this._getDefaultStaleTtl();
    }
    if (expiresTtl === undefined) {
        expiresTtl = this._getDefaultExpiresTtl();
    }

    if (this._lru && options.size === undefined) {
        var errStr = 'Cache entry set without size and maxSize is enabled, key was: ' + key;
        debug(errStr);
        return callback(new Error(errStr));
    }

    if (expiresTtl > 0) {
        var cacheEntry = new CacheEntry({
            value: value,
            staleTtl: staleTtl,
            expiresTtl: expiresTtl,
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
    if (options === undefined) { options = {} }

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
CrispCache.prototype.clear = function(callback) {
    this.cache = {};
    if(this._lru) {
        this._lru.clear();
    }
    return callback(null, true);
};

CrispCache.prototype.getUsage = function() {
    if(this._lru) {
        return {
            size:    this._lru.size,
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
        this._emit(CrispCache.EVENT_FETCH, { key: key });
        this.fetcher(key, function (err, value, fetcherOptions) {
            this._emit(CrispCache.EVENT_FETCH_DONE, { key: key, value: value, options: fetcherOptions });
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
 * Stale Check
 *
 * Checks for stale keys and will try and update them. Should be called on an interval.
 * @private
 */
CrispCache.prototype._staleCheck = function () {
    //This is a little gross for efficiency, this.cache will just have basic keys on it, no need to double check.
    debug("Checking for stale cache entries...");
    this._emit(CrispCache.EVENT_STALE_CHECK);
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
            if(this.emitEvents) {
                refetchKeys.push(key);
            }
        }
    }
    this._emit(CrispCache.EVENT_STALE_CHECK_DONE, refetchKeys);
};

/**
 * Evict Check
 *
 * Evict expired keys, free up some memory. This should be called on an interval.
 * @private
 */
CrispCache.prototype._evictCheck = function () {
    //This is a little gross for efficiency, this.cache will just have basic keys on it, no need to double check.

    this._emit(CrispCache.EVENT_EVICT_CHECK);

    var cacheEntry,
        evicted = {};
    for (var key in this.cache) {
        cacheEntry = this.cache[key];
        if (cacheEntry.isExpired()) {
            this.del(key);
            if(this.emitEvents) {
                evicted[key] = cacheEntry;
            }
        }
    }

    this._emit(CrispCache.EVENT_EVICT_CHECK_DONE, evicted);
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

CrispCache.prototype._emit = function(name, options) {
	if(this.emitEvents) {
		this.emit(name, options);
	}
};

// Unique id for key-less CrispCache.wrap
var keyIdCounter = 0;
/**
 * Create a cached version of an asynchronous function.
 *
 * @param {valueCb} origFn
 * @param {Object} options
 * @param {function(any*):string?} options.createKey
 * @param {function(string):any[]} options.parseKey
 * @returns {valueCb}
 */
CrispCache.wrap = function(origFn, options) {
    var cache;
    options || (options = {});

    // Use a static key, eg. for cached functions
    // which receive no arguments
    if (!options.createKey) {
        keyIdCounter++;
        var key = 'CRISP_CACHE_KEY_' + keyIdCounter;
        // Cache has a single entry, with a single constant key
        options.createKey = function() { return key; }
        // OrigFn receives no arguments (besides cb)
        options.parseKey = function(key) { return []; }
    }

    options.fetcher = function(key, cb) {
        var args, wrapperCb;
        try {
            args = options.parseKey(key);
        }
        catch (err) { cb(new Error('Failed to parse cache key: ' + key)); }

        if (!Array.isArray(args)) {
            return cb(new Error('CrispCache.wrap `parseKey` must return an array of arguments'));
        }

        // Wrap the original fn's callback,
        // to send back cacheOptions along with the resolved value
        wrapperCb = function(err, val) {
            if (err) { return cb(err); }

            try {
                var cacheOptions = options.getOptions ? options.getOptions(val, args) : {};
            }
            catch (err) { return cb(err); }

            cb(null, val, cacheOptions);
        };

        origFn.apply(null, args.concat(wrapperCb));
    };

    cache = new CrispCache(options);

    return function() {
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
 * @param {{}} eventMap
 * @param {EventEmitter} eventEmitter
 */
function bindEventMap(eventMap, eventEmitter) {
    var eventNames = Object.keys(eventMap);
    eventNames.map(function(eventName) {
        eventEmitter.on(eventName, eventMap[eventName]);
    });
}

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


module.exports = CrispCache;
