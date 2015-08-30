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
  return data[key];
}

crispCacheBasic = new CrispCache({
    fetcher: fetcher,
    defaultStaleTtl: 300,
    defaultExpiresTtl: 500,
    staleCheckInterval: 100
});
crispCacheBasic.set('new', 'A new value, not from fetcher', function(err, success) {
  if(success) {
    console.log("Set 'new' to our provided string.");
  }
});

crispCacheBasic.get('foo', function(err, value) {
  if(!err) {
    console.log("Got 'foo', is: " + value);
  }
});
//Wait any amount of time

crispCacheBasic.get('foo', {skipFetch: true}, function(err, value) {
  //We wont have to re-fetch when we call `get`, since it is keeping it up to date for us.
  if(!err) {
    console.log("Got 'foo', is: " + value);
  }
});
```

## Usage

### new CrispCache({options})
Crisp Cache is instantiated because it holds config for many of it's methods.

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `fetcher` | (callable)* | null | A method to call when we need to update a cache entry, should have signature: function(key, callback(err, value)) |
| `defaultStaleTtl` | (integer, ms) | `300000` | How long the cache entry is valid before becoming stale. |
| `staleCheckInterval` | (integer, ms) | `0` | If >0, how often to check for stale keys and re-fetch |
| `defaultExpiresTtl` | (integer, ms) | `0` | If >0, cache entries that are older than this time will be deleted |
| `evictCheckInterval` | (integer, ms) | `0` | If >0, will check for expired cache entries and delete them from the cache |

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


### del(key, [callback])
Removes the provided `key` (a string) from the cache, will call `callback` (an error first callback) when the delete is done.

## Roadmap

* Add different caching backends (memory is the only one supported now)