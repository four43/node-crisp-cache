/**
 * LRU (Least Recently Used)
 *
 * Adds keys to a set, calls del when an entry needs to be removed.
 *
 * @param {Number} maxSize
 * @param {function} del
 * @constructor
 */
function Lru(maxSize, del) {

    this.size = 0;
    this.maxSize = maxSize;
    this.delCallback = del;

    // Add to head
    this.head = null;
    // Remove from tail
    this.tail = null;
}

Lru.prototype.put = function (key, size) {
    var entry = new Entry(key, size);

    this._moveToHead(entry);

    if (this.tail === null) {
        this.tail = entry;
    }

    // See if size > maxSize
    while (this.size > this.maxSize) {
        this.shift();
    }
};

Lru.prototype._moveToHead = function (entry) {
    var key = entry.key;

    // Ensure we don't have the key in the cache already.
    if (this.head !== null) {
        this.del(key);
        this.head.newer = entry;
        entry.older = this.head;
    }

    this.head = entry;
    this.size += entry.size;
};

Lru.prototype.del = function (key) {
    if (this.head !== null) {
        var cursor = this.head;
        while (cursor) {
            if (cursor.key === key) {
                if (cursor.newer) {
                    cursor.newer.older = cursor.older;
                    if (cursor.newer.older === null) {
                        // We just removed the tail
                        this.tail = cursor.newer;
                    }
                }
                else {
                    // This was the head
                    this.head = cursor.older;
                }
                if (cursor.older) {
                    cursor.older.newer = cursor.newer;
                    if (cursor.older.newer === null) {
                        // We just removed the head
                        this.head = cursor.older;
                    }
                }
                else {
                    // This was the tail
                    this.tail = cursor.newer;
                }
                this.size -= cursor.size;
                cursor = cursor.older;
                break;
            }
            cursor = cursor.older;
        }
    }
};

/**
 * Removes the last entry from the cache
 */
Lru.prototype.shift = function () {
    var lastEntry = this.tail;
    if (this.tail.key == this.head.key) {
        this.head = null;
    }
    this.tail = this.tail.newer;
    this.size -= lastEntry.size;
    if (typeof this.delCallback === "function") {
        this.delCallback(lastEntry.key);
    }
};

Lru.prototype.toString = function () {
    var keys = [];
    var cursor = this.head;
    while (cursor.older) {
        keys.push(cursor.key);
        cursor = cursor.older;
    }
    keys.push(cursor.key);
    return "Size: " + this.size + "/" + this.maxSize + ", Head: " + keys.join(' -> ') + " :Tail";
};


module.exports = Lru;

function Entry(key, size) {
    this.key = key;
    this.size = size;
    this.newer = null;
    this.older = null;
}