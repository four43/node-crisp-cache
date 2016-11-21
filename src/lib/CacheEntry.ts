/**
 * Main data structure used for caching, keeps meta information about a cache entry
 */
export default class CacheEntry<T> {

	public static STATE = STATE;

	public options: CacheEntryOpts<T>;
	protected _value: T;
	protected _size: number;
	protected _created: number;

	/**
	 * @param {{}} options
	 * @param {{}} [options.ttls={}] Configuration for Time To Live (TTL) settings
	 * @param {Number} [options.ttls.stale=300000] The ms until this cache entry should be stale after it's created. -1 = never
	 * @param {Number} [options.ttls.expires=0] The ms until this cache entry should expire after it's created. -1 = never.
	 * @param {Number} [options.size=0] How large this entry is, in relation to cache's maxSize only.
	 * @param {{}} options.value The value that should be cached
	 */
	constructor(options: CacheEntryOpts<T>) {
		this.options = Object.assign({
			ttls: {
				stale: 300000,
				expires: -1
			},
			size: 0
		}, options);
		this._value = options.value;
		this._created = Date.now();
	}

	get state(): STATE {
		const now = Date.now();
		const staleTtl = this.options.ttls.stale;
		const exipresTtl = this.options.ttls.expires;
		if ((exipresTtl >= 0) && (now > this._created + exipresTtl)) {
			return STATE.EXPIRED;
		}
		else if ((staleTtl >= 0) && now > this._created + staleTtl) {
			return STATE.STALE;
		}
		return STATE.VALID;
	}

	get value(): T {
		return this._value;
	}

	get size(): number {
		return this._size;
	}

	get ttls(): {stale: number,expires: number} {
		return this.options.ttls;
	}

	isValid(): boolean {
		return this.state === STATE.VALID;
	}

	isStale(): boolean {
		return this.state === STATE.STALE;
	}

	isExpired(): boolean {
		return this.state === STATE.EXPIRED;
	}
}

export interface CacheEntryOpts<T> {
	value: T,
	size: number,
	ttls: {
		stale: number,
		expires: number
	}
}

export enum STATE {
	VALID,
	STALE,
	EXPIRED
}