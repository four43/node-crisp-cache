export interface ExpireStrategyInterface {
	put(key:string, size:number):void;
	del(key:string, skipDelCallback:boolean):void;
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

	abstract put(key:string, size:number):void;
	abstract del(key:string, skipDelCallback:boolean):void;
	abstract clear():AbstractExpireStrategy;
}

export type ExpireOptions = {
	maxSize:number,
	delCallback?:{():void}
}

export type DeleteCallback = {(key:string, options: {skipLruDelete:boolean}):void}