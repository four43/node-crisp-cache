export class LinkedHashMap<T> {

	public head: Entry<T>|null = null;
	public tail: Entry<T>|null = null;

	public hash: {[id: string]: Entry<T>} = {};

	constructor() {
	}

	add(key: string, value: T) {
		const newEntry = new Entry<T>(key, value);
		if (this.tail) {
			this.tail.next = newEntry;
			newEntry.previous = this.tail;
			this.tail = newEntry;
		}
		else {
			this.tail = newEntry;
			this.head = newEntry;
		}
		this.hash[key] = newEntry;
	}

	get(key: string): T {
		return this.hash[key].value;
	}

	del(key: string) {
		const entry = this.hash[key];
		if (entry.previous) {
			entry.previous.next = entry.next;
		}
		else {
			// entry was the head
			this.head = entry.next;
		}
		if (entry.next) {
			entry.next.previous = entry.previous;
		}
		else {
			// entry was the tail
			this.tail = entry.previous;
		}
	}

	next(cursor?: Entry<T>|null): NextResult<T> {
		if (cursor) {
			const nextEntry = this.hash[cursor.key];
			return {
				value: nextEntry.value,
				next: () => this.next(nextEntry)
			}
		}
		else {
			return {
				value: (this.head) ? this.head.value : null,
				next: () => this.next(this.head)
			}
		}
	}
}

interface NextResult<T> {
	value: T|null,
	next: () => NextResult<T>
}

export class Entry<T> {
	public key: string;
	public value: T;
	public meta: any;
	public next: Entry<T>|null;
	public previous: Entry<T>|null;

	constructor(key: string, value: T, meta?: any) {
		this.key = key;
		this.value = value;
		if (meta) {
			this.meta = meta;
		}
	}
}