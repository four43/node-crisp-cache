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
