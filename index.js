var CacheEntry = require('./lib/CacheEntry'),
    debug = require('debug')('crisp-cache');
/**
 *
 * @param options
 * @constructor
 */
function CrispCache(options) {
    if (options === undefined) {
        options = {};
    }
    this.defaultStaleTtl = options.defaultStaleTtl;
    this.staleCheckInterval = options.staleCheckInterval;

    this.defaultExpiresTtl = options.defaultExpiresTtl;
    this.evictCheckInterval = options.evictCheckInterval || 0;

    if (!options.fetcher) {
        throw new Error("Must pass a fetcher option, a fetcher is a function(key, callback) that can retrieve a key from a repository");
    }
    this.fetcher = options.fetcher;
    this.cache = {};
    this.locks = {};

    if (this.staleCheckInterval) {
        setInterval(this._staleCheck.bind(this), this.staleCheckInterval);
    }

    if (this.evictCheckInterval && this.evictCheckInterval > 0) {
        setInterval(this._evictCheck.bind(this), this.evictCheckInterval);
    }
}

/**
 *
 * @param {string} key
 * @param {{skipFetch:boolean}} options
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

    if (this.cache[key] === undefined) {
        //Cache miss.
        debug("- MISS");
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
        debug("- Hit");
        var cacheEntry = this.cache[key];

        if (cacheEntry.isValid()) {
            return callback(null, cacheEntry.getValue());
        }
        else if (cacheEntry.isStale()) {
            //Stale, try and update the cache but return what we have.
            debug("- Stale, returning current value but re-fetching");
            callback(null, cacheEntry.getValue());
            this._fetch(key, {
                staleTtl: cacheEntry.staleTtl,
                expiresTtl: cacheEntry.expiresTtl
            });
        }
        else if (cacheEntry.isExpired()) {
            debug("- Expired");
            if (options.skipFetch) {
                //Don't re-fetch
                debug(" - Skipping fetch, deleting and returning undefined");
                this.del(key);
                return callback(null, undefined);
            }
            else {
                //Fetch this key
                debug(" - Fetching, will callback when we have it");
                this.del(key, function(err, success) {
                    if(err) {
                        throw new Error("Couldn't remove an expired key: " + key);
                    }
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

    var staleTtl,
        expiresTtl;
    if (options.staleTtl === undefined) {
        staleTtl = this.defaultStaleTtl;
    }
    if (expiresTtl === undefined) {
        expiresTtl = this.defaultExpiresTtl;
    }

    this.cache[key] = new CacheEntry({
        value: value,
        staleTtl: staleTtl,
        expiresTtl: expiresTtl
    });
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
 * @param {valueCb} [callback]
 * @returns {*}
 */
CrispCache.prototype.del = function (key, callback) {
    delete this.cache[key];
    this._resolveLocks(key, undefined);
    if (callback) {
        return callback(null, true);
    }
};

/**
 * Fetch
 *
 * Fetches a key from the data provider
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
    if (this.locks[key]) {
        //We are locked (already fetching) currently.
        return this.locks[key].push(callback);
    }
    //Not locked, lock and fetch
    this._lock(key, callback);

    this.fetcher(key, function (err, value) {
        if (err) {
            debug("Issue with fetcher, resolving in error");
            this._resolveLocks(key, undefined, err);
        }
        debug("Got value: " + value + " from fetcher for key: " + key);
        this.set(key, value, options);
    }.bind(this));
};

/**
 * Stale Check
 *
 * Checks for stale keys and will try and update them. Should be called on an interval.
 * @private
 */
CrispCache.prototype._staleCheck = function () {
    //This is a little gross for efficiency, this.cache will just have basic keys on it, no need to double check.
    var cacheEntry;
    for (var key in this.cache) {
        cacheEntry = this.cache[key];
        if (cacheEntry.isStale()) {
            this._fetch(key, {
                staleTtl: cacheEntry.staleTtl,
                expiresTtl: cacheEntry.expiresTtl
            });
        }
    }
};

/**
 * Evict Check
 *
 * Evict expired keys, free up some memory. This should be called on an interval.
 * @private
 */
CrispCache.prototype._evictCheck = function () {
    //This is a little gross for efficiency, this.cache will just have basic keys on it, no need to double check.
    var cacheEntry;
    for (var key in this.cache) {
        cacheEntry = this.cache[key];
        if (cacheEntry.isExpired()) {
            this.del(key);
        }
    }
};

/**
 * Lock
 *
 * Adds a callback to the locks for this key.
 * @param {string} key
 * @param {valueCb} callbackToAdd
 * @private
 */
CrispCache.prototype._lock = function (key, callbackToAdd) {
    if (this.locks[key] === undefined) {
        this.locks[key] = [callbackToAdd];
    }
    else {
        this.locks[key].push(callbackToAdd);
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