export interface ExpireStrategyInterface {
	set(key:string, size:number):void;
	delete(key:string, skipDelCallback:boolean):void;
	clear():ExpireStrategyInterface;
}

export abstract class AbstractExpireStrategy implements ExpireStrategyInterface {

	public size:number = 0;
	public maxSize:number;
	public delCallback:DeleteCallback|null;

	constructor(options:ExpireOptions) {
		this.maxSize = options.maxSize;
		this.delCallback = (options.delCallback ? options.delCallback : null);
	};

	abstract set(key:string, size:number):void;
	abstract delete(key:string, skipDelCallback:boolean):void;
	abstract clear():AbstractExpireStrategy;
}

export type ExpireOptions = {
	maxSize:number,
	delCallback?:{():void}
}

export type DeleteCallback = {(key:string, options: {skipLruDelete:boolean}):void}