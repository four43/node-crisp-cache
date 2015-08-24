# crisp-cache
A crispy fresh cache that will try and use updated data where it can, but can use a stale entry if need be.

This cache is for high throughput applications where cache data may become stale before being invalidated. This allows
the program to ask for updated data before the data is evicted from the cache. A locking mechanism is also provided so 
when a cache misses, data will only be retrieved once.