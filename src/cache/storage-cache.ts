import { Contact, ContactCache } from "../models";
import { StorageAdapter } from "../models/storage-adapter.model";
import { anonymizeKey } from "../util/anonymize-key";

const CACHE_REFRESH_INTERVAL_MS_DEFAULT: number = 10 * 60 * 1000; // 10 minutes

const { CACHE_REFRESH_INTERVAL } = process.env;
const CACHE_REFRESH_INTERVAL_MS: number = CACHE_REFRESH_INTERVAL
	? Math.max(Number(CACHE_REFRESH_INTERVAL), 1) * 1000
	: CACHE_REFRESH_INTERVAL_MS_DEFAULT;

enum CacheItemStateType {
	CACHED = "CACHED",
	FETCHING = "FETCHING"
}

interface CacheItemStateCached {
	state: CacheItemStateType.CACHED;
	updated: number;
}

interface CacheItemStateFetching {
	state: CacheItemStateType.FETCHING;
}

type CacheItemState = CacheItemStateCached | CacheItemStateFetching;

export class StorageCache implements ContactCache {
	private storage: StorageAdapter<Contact[]>;
	private cacheItemStates: Map<string, CacheItemState>;

	constructor(storageAdapter: StorageAdapter<Contact[]>) {
		this.storage = storageAdapter;
		this.cacheItemStates = new Map<string, CacheItemState>();
		console.log(`Initialized storage cache with maximum refresh interval of ${CACHE_REFRESH_INTERVAL_MS / 1000}s.`);
	}

	public async get(
		key: string,
		getFreshValue: (key: string) => Promise<Contact[] | null> = null
	): Promise<Contact[] | null> {
		let value: Contact[];
		try {
			value = await this.storage.get(key);
			if (value) {
				console.log(`Found match for key "${anonymizeKey(key)}" in cache.`);

				const cacheItemState: CacheItemState = this.cacheItemStates.get(key);

				const now: number = new Date().getTime();

				const isValueStale: boolean =
					cacheItemState.state === CacheItemStateType.CACHED &&
					now > cacheItemState.updated + CACHE_REFRESH_INTERVAL_MS;
				const isValueNotCached: boolean = !cacheItemState;

				if (isValueNotCached || isValueStale) {
					this.getRefreshed(key, getFreshValue);
				}

				return value;
			}
		} catch (e) {
			console.warn(`Unable to get cache for key "${anonymizeKey(key)}".`, e);
		}

		if (!getFreshValue) {
			return null;
		}

		console.log(`Found no match for key "${anonymizeKey(key)}" in cache. Getting fresh value.`);
		return this.getRefreshed(key, getFreshValue);
	}

	public async set(key: string, value: Contact[]): Promise<void> {
		console.log(`Saving contacts for key "${anonymizeKey(key)}" to cache.`);
		try {
			await this.storage.set(key, value);
		} catch (e) {
			console.warn(`Unable to set cache for key "${anonymizeKey(key)}".`, e);
		}
	}

	public async delete(key: string): Promise<void> {
		console.log(`Removing contacts for key "${anonymizeKey(key)}" from cache.`);
		try {
			await this.storage.delete(key);
		} catch (e) {
			console.warn(`Unable to delete cache for key "${anonymizeKey(key)}".`, e);
		}
	}

	private async getRefreshed(
		key: string,
		getFreshValue: (key: string) => Promise<Contact[] | null>
	): Promise<Contact[] | null> {
		const itemState: CacheItemState = this.cacheItemStates.get(key);
		if (itemState && itemState.state === CacheItemStateType.FETCHING) {
			console.log(`Not refreshing for key "${anonymizeKey(key)}" because fetching is already in progress.`);
			return null;
		}

		console.info(`Refreshing value for ${anonymizeKey(key)}.`);

		this.cacheItemStates.set(key, {
			state: CacheItemStateType.FETCHING
		});

		try {
			const freshValue: Contact[] = await getFreshValue(key);

			this.cacheItemStates.set(key, {
				state: CacheItemStateType.CACHED,
				updated: new Date().getTime()
			});

			if (freshValue) {
				await this.set(key, freshValue);
			}

			return freshValue;
		} catch (e) {
			this.cacheItemStates.delete(key);
			throw e;
		}
	}
}
