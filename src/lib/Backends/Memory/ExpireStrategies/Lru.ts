import {AbstractMemoryExpireStrategy, ExpireOptions, MemoryExpireEvents} from "./MemoryExpireStrategyInterface";


export class Lru extends AbstractMemoryExpireStrategy {

	public head: LruEntry|null = null;
	public tail: LruEntry|null = null;

	public hash: {[id: string]: LruEntry} = {};

	/**
	 * LRU (Least Recently Used)
	 *
	 * Adds keys to a set, calls del when an entry needs to be removed.
	 */
	constructor(options: ExpireOptions) {
		super(options);
	}

	public get(key: string) {
		let entry = this.hash[key];
		if(entry) {
			this._moveToHead(entry);
		}
	}

	/**
	 * Adds an entry to the LRU
	 */
	public set(key: string, size: number): void {
		let entry = new LruEntry(key, size);

		this._moveToHead(entry);

		if (this.tail === null) {
			this.tail = entry;
		}

		// See if size > maxSize
		while (this._size > this._maxSize) {
			this.shift();
		}
	}

	public delete(key: string, skipParentDelete: boolean = false): void {
		let cursor = this.hash[key];
		if (cursor) {
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
			this._size -= cursor.size;
			if (!skipParentDelete) {
				this.emit(MemoryExpireEvents.DELETE, key, {skipExpireStrategyDelete: true});
			}
			delete this.hash[key];
		}
	}


	/**
	 * Removes the last entry from the cache
	 */
	public shift(): void {
		const tailToShift = this.tail;
		if (tailToShift) {
			delete this.hash[tailToShift.key];
			this._size -= tailToShift.size;
			if (this.head) {
				if (tailToShift.key == this.head.key) {
					this.head = null;
				}
			}

			if (this.tail) {
				this.tail = this.tail.newer;
			}
			else {
				this.tail = null;
			}
			this.emit(MemoryExpireEvents.DELETE, tailToShift.key, {skipExpireStrategyDelete: true});
		}
	}

	/**
	 * Removes all entries from the cache.
	 *
	 * @returns {Lru}
	 */
	public clear(): void {
		while (this.tail) {
			this.shift();
		}
	}

	public toString(): string {
		let keys: string[] = [];
		let cursor = this.head;
		while (cursor && cursor.older) {
			keys.push(cursor.key);
			cursor = cursor.older;
		}
		if (cursor) {
			keys.push(cursor.key);
		}
		return "Size: " + this._size + "/" + this._maxSize + ", Head: " + keys.join(' -> ') + " :Tail";
	}

	/**
	 * Moves an entry to the head.
	 * @param entry
	 */
	private _moveToHead(entry: LruEntry): void {
		let key = entry.key;

		// Ensure we don't have the key in the cache already.
		if (this.head !== null) {
			this.delete(key, true);
			if (this.head) {
				this.head.newer = entry;
				entry.older = this.head;
			}
		}

		this.head = entry;
		this._size += entry.size;
		this.hash[key] = entry;
	}
}

export class LruEntry {
	public key: string;
	public size: number;
	public newer: LruEntry|null;
	public older: LruEntry|null;

	constructor(key: string, size: number) {
		this.key = key;
		this.size = size;
	}
}