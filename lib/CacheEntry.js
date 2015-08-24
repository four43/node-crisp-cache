function CacheEntry(options) {
    this.value = options.value;
    this.staleTtl = options.staleTtl || 300000;
    this.expiresTtl = options.expiresTtl || 0;
    this.created = Date.now();
}

CacheEntry.prototype.getState = function() {
    var now = Date.now();
    if(now > this.created + this.staleTtl) {
        return CacheEntry.STATE_STALE;
    }
    else if((this.expiresTtl > 0) && (now > this.created + this.expiresTtl)) {
        return CacheEntry.STATE_EXPIRED;
    }
    return CacheEntry.STATE_VALID;
};

CacheEntry.prototype.getValue = function() {
    return this.value;
};

CacheEntry.prototype.isValid = function() {
    return this.getState() === CacheEntry.STATE_VALID;
};

CacheEntry.prototype.isStale = function() {
    return this.getState() === CacheEntry.STATE_STALE;
};

CacheEntry.prototype.isExpired = function() {
    return this.getState() === CacheEntry.STATE_EXPIRED;
};

CacheEntry.STATE_VALID = 'valid';
CacheEntry.STATE_STALE = 'stale';
CacheEntry.STATE_EXPIRED = 'expired';

module.exports = CacheEntry;