# crisp-cache
A crispy fresh cache that will use updated data where it can, but can use a stale entry if need be - useful for high throughput
applications that want to avoid cache-slams and blocking.

Master Build Status: 
[![Build Status](https://travis-ci.org/four43/node-crisp-cache.svg?branch=master)](https://travis-ci.org/four43/node-crisp-cache)
[![Coverage Status](https://coveralls.io/repos/four43/node-crisp-cache/badge.svg?branch=master&service=github)](https://coveralls.io/github/four43/node-crisp-cache?branch=master)

This cache is for high throughput applications where cache data may become stale before being invalidated. It adds a state
to a cache entry - Valid, [Stale], and Expired. This allows the program to ask for a value before the data is evicted from 
the cache. If the data is stale, the cache will return the stale data, but asynchronously re-fetch data to ensure data stays 
available. A locking mechanism is also provided so when a cache misses, data will only be retrieved once.

## Example
```javascript
var CrispCache = require('crisp-cache');
var data = {
    hello: "world",
    foo: "bar",
    arr: [1, 2, 3],
    hash: {key: "value", nested: [4, 5, 6]}
};
function fetcher(key, callback) {
    return callback(null, data[key]);
}

crispCacheBasic = new CrispCache({
    fetcher: fetcher,
    defaultStaleTtl: 300,
    defaultExpiresTtl: 500,
    staleCheckInterval: 100
});
crispCacheBasic.set('new', 'A new value, not from fetcher', function (err, success) {
    if (success) {
        console.log("Set 'new' to our provided string.");
    }
});

crispCacheBasic.get('foo', function (err, value) {
    if (!err) {
        console.log("Got 'foo', is: " + value);
    }
});
//Wait any amount of time

crispCacheBasic.get('foo', {skipFetch: true}, function (err, value) {
    //We wont have to re-fetch when we call `get`, since it is keeping it up to date for us.
    if (!err) {
        console.log("Got 'foo', is: " + value);
    }
});
```

## Usage

### new CrispCache({options})
Crisp Cache is instantiated because it holds config for many of it's methods.

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `fetcher` | (callable)* | null | A method to call when we need to update a cache entry, should have signature: function(key, callback(err, value, options)) |
| `defaultStaleTtl` | (integer, ms) | `300000` | How long the cache entry is valid before becoming stale. |
| `staleTtlVariance` | (integer, ms) | `0` | How many ms to vary the staleTtl (+/-, to prevent cache slams) |
| `staleCheckInterval` | (integer, ms) | `0` | If >0, how often to check for stale keys and re-fetch |
| `defaultExpiresTtl` | (integer, ms) | `0` | If >0, cache entries that are older than this time will be deleted |
| `expiresTtlVariance` | (integer, ms) | `0` | How many ms to vary the expiresTtl (+/-, to prevent cache slams) |
| `evictCheckInterval` | (integer, ms) | `0` | If >0, will check for expired cache entries and delete them from the cache |
| `ttlVariance` | (integer, ms) | `0` | (Alias for other variance options) How many ms to vary the staleTtl and expiresTtl (+/-, to prevent cache slams) |
| `maxSize` | (integer) | `null` | Adds a max size for the cache, when elements are added a size is needed. When the cache gets too big LRU purging occurs. |

### get(key, [options], callback)
This will try and get `key` (a string) from the cache. By default if the key doesn't exist, the cache will call the configured `fetcher` to get the value. A lock is also set on the key while the value is retrieved. When the value is retrieved it is saved in the cache and used to call callback. Other requests to get this key from the cache are also resolved.

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `skipFetch` | (boolean) | `false` | If true, will not try and fetch value if it doesn't exist in the cache. |
| `forceFetch` | (boolean) | `false` | If true, will always refetch from the configured `fetcher` and not use the cache. |

### set(key, value, [options], callback)
Set a value to the cache. Will call `callback` (an error first callback) with a true/false for success when done.

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `staleTtl` | (integer, ms) | `crispCache.defaultStaleTtl` | How long the cache entry is valid before becoming stale. |
| `expiresTtl` | (integer, ms) | `crispCache.defaultExpiresTtl` | If >0, cache entries that are older than this time will be deleted |
| `size` | (integer) | `null` | Required when `maxSize` is set on the cache, specifies the size for this entry. |

### del(key, [callback])
Removes the provided `key` (a string) from the cache, will call `callback` (an error first callback) when the delete is done.

## Advanced Usage

### Dynamic TTLs 
TTLs can be set on a per-item basis in the fetch() callable provided to Crisp Cache.

Lets say we want to create a for data we know expires every minute (60,000 ms). Our data source will provide how long 
ago each record was created. We can dynamically set our TTL so we are never serving bad data.

```javascript
var CrispCache = require('crisp-cache');

var MAX_AGE = 60000;
var data = {
    a: {
        name: "Aaron",
        createdAgo: 12000
    },
    b: {
        name: "Betsy",
        createdAgo: 24000
    },
    c: {
        name: "Charlie",
        createdAgo: 35000
    }
};
function fetcher(key, callback) {
    var record = data[key];
    if (record) {
        var timeLeft = MAX_AGE - record;
        return callback(null, record, {expiresTtl: timeLeft});
    }
    else {
        return callback(new Error("Record with key: " + key + " wasn't found"));
    }
}

crispCacheBasic = new CrispCache({
    fetcher: fetcher
});

crispCacheBasic.get('a', function (err, value) {
    //CrispCache will keep "a" in the cache for 48 seconds (60 - 12)
});
```

#### What about stale times?
The previous example is great, but can we be smarter about how we fetch data? 

If we want a high throughput application, we can ensure users of the cache are getting fast results by using a stale 
ttl in accordance with expires. 

```javascript
[Same MAX_TIME and data from above example]

function fetcher(key, callback) {
    var record = data[key];
    if (record) {
        var staleTime = MAX_AGE - record;
        var expiresTime = staleTime + 10000
        return callback(null, record, { staleTtl: staleTime, expiresTtl: expiresTime });
    }
    else {
        return callback(new Error("Record with key: " + key + " wasn't found"));
    }
}

crispCacheBasic = new CrispCache({
    fetcher: fetcher,
    staleCheckInterval: 5000 //Check for stale records every 5 seconds
});

crispCacheBasic.get('a', function (err, value) {
    // CrispCache will keep "a" in the cache for 58 seconds max (60 - 12 + our 10 second buffer)
    // NOTE: CrispCache will automatically look for stale records and try to update them in the background.
    // Users will get near immediate response times when looking key 'a', users looking for 'a' around 48 seconds after
    //    it was cached may still see the original value for 'a', but CrispCache is in the background asking for an 
    //    update to the stale data. When new data is available, users requesting 'a' will get the new record instead.
});
```

## Roadmap

* Add different caching backends (memory is the only one supported now)
