import {EventEmitter} from "events";

export interface IExpireStrategy {
	get(key: string): void;
	set(key: string, size: number): void;
	delete(key: string, skipDelCallback: boolean): void;
	clear(): void;
}

export class MemoryExpireEvents {
	static readonly DELETE = 'delete';
}

export abstract class AbstractMemoryExpireStrategy extends EventEmitter implements IExpireStrategy {

	protected _size: number = 0;
	protected _maxSize: number;

	constructor(options: ExpireOptions) {
		super();
		this._maxSize = options.maxSize;
	};

	get size():number {
		return this._size;
	}

	get maxSize():number {
		return this._maxSize;
	}

	abstract get(key: string): void;

	abstract set(key: string, size: number): void;

	abstract delete(key: string, skipDelCallback?: boolean): void;

	abstract clear(): void;
}

export type ExpireOptions = {
	maxSize: number
}