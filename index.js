var CacheEntry = require('./lib/CacheEntry');

function CrispCache(options, fetcher) {
    this.defaultStaleTtl = options.defaultStaleTtl;
    this.staleCheckInterval = options.staleCheckInterval;

    this.defaultExpiresTtl = options.defaultExpiresTtl;
    this.evictCheckInterval = options.evictCheckInterval || 0;

    this.fetcher = fetcher;
    this.cache = {};
    this.locks = {};

    if(this.staleCheckInterval) {
        setInterval(this._staleCheck.bind(this), this.staleCheckInterval);
    }

    if(this.evictCheckInterval) {
        setInterval(this._evictCheck.bind(this), this.evictCheckInterval);
    }
}

CrispCache.prototype.get = function (key, callback) {
    if (this.locks[key]) {
        //We are locked currently.
        this.locks.push(callback);
    }
    else {
        if (this.cache[key] === undefined) {
            //Total cache miss.
            callback(null, undefined);
        }
        else {
            //Found, what is the state?
            var cacheEntry = this.cache[key];

            if (cacheEntry.isValid()) {
                return callback(null, cacheEntry.getValue());
            }
            else if (cacheEntry.isStale()) {
                this._updateCache(cacheEntry);
                callback(null, cacheEntry.getValue());
            }
            else if (cacheEntry.isExpired()) {
                this.del(key);
                return callback(null, undefined);
            }
        }
    }
};

/**
 * Set
 *
 * Sets a value to a key.
 * @param key
 * @param value
 * @param options
 * @param callback
 */
CrispCache.prototype.set = function (key, value, options, callback) {
    //Parse Args
    if (typeof options === 'function' && !callback) {
        callback = options;
        options = {};
    }

    var staleTtl,
        expiresTtl;
    if(options.staleTtl === undefined) {
        staleTtl = this.defaultStaleTtl;
    }
    if(expiresTtl === undefined) {
        expiresTtl = this.defaultExpiresTtl;
    }

    this.cache[key] = new CacheEntry({
        value: value,
        staleTtl: staleTtl,
        expiresTtl: expiresTtl
    });
    this._resolveLocks(key, value);
    if(callback) {
        callback(null, true);
    }
};

/**
 * Delete
 *
 * Removes and item from the cache, ensures all locks are cleaned up before removing.
 * @param {string} key
 * @param {function} [callback]
 * @returns {*}
 */
CrispCache.prototype.del = function (key, callback) {
    delete this.cache[key];
    this._resolveLocks(key, undefined);
    if(callback) {
        return callback(null, true);
    }
};

CrispCache.prototype._staleCheck = function() {
    //This is a little gross for efficiency, this.cache will just have basic keys on it, no need to double check.
    var cacheEntry;
    for(var key in this.cache) {
        cacheEntry = this.cache[key];
        if(cacheEntry.isStale()) {
            this._updateCache(cacheEntry);
        }
    }
};

CrispCache.prototype._evictCheck = function() {
    //This is a little gross for efficiency, this.cache will just have basic keys on it, no need to double check.
    var cacheEntry;
    for(var key in this.cache) {
        cacheEntry = this.cache[key];
        if(cacheEntry.isExpired()) {
            this.del(key);
        }
    }
};

CrispCache.prototype._updateCache = function () {
    if(options.lock !== false) {
        this._lock(key, callback);
    }
};


CrispCache.prototype._lock = function(key, callbackToAdd) {
    if(this.locks[key] === undefined) {
        this.locks[key] = [callbackToAdd];
    }
    else {
        this.locks[key].push(callbackToAdd);
    }
};

CrispCache.prototype._resolveLocks = function(key, value) {
    if(this.locks[key]) {
        //Clear out anyone waiting on this key.
        this.locks[key].map(function(lockCb) {
            return lockCb(null, value);
        });
        delete this.locks[key];
    }
};




module.exports = CrispCache;