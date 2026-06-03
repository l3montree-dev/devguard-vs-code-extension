import * as config from '../config';
import { Logger } from '../logger';
import { signRequest } from './signing';
import {
	Asset,
	DependencyVulnFlat,
	Org,
	Paged,
	Project,
	PurlInspectResponse,
	Ref,
	WhoAmI,
	encodePurlForPath,
} from './types';

export class NotConnectedError extends Error {
	constructor() {
		super('Not connected to DevGuard. Run "DevGuard: Connect".');
		this.name = 'NotConnectedError';
	}
}

export class DevGuardHttpError extends Error {
	constructor(public readonly status: number, message: string) {
		super(message);
		this.name = 'DevGuardHttpError';
	}
}

export class DevGuardNetworkError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DevGuardNetworkError';
	}
}

type TokenProvider = () => Promise<string | undefined>;

interface RequestOptions {
	signed?: boolean;
	accept?: string;
	signal?: AbortSignal;
}

/** Talks to the DevGuard backend: public purl inspection + PAT-signed endpoints. */
export class DevGuardClient {
	constructor(private readonly logger: Logger, private readonly getToken: TokenProvider) {}

	/** PUBLIC — no auth. Returns risk intelligence for a single package version. */
	async inspectPurl(purl: string, signal?: AbortSignal): Promise<PurlInspectResponse> {
		return this.json<PurlInspectResponse>(`/vulndb/purl-inspect/${encodePurlForPath(purl)}`, { signal });
	}

	/** Signed. The body's `userID` is "NO_SESSION" when the token is not recognized. */
	async whoami(signal?: AbortSignal): Promise<WhoAmI> {
		return this.json<WhoAmI>('/whoami/', { signed: true, signal });
	}

	async listOrgs(signal?: AbortSignal): Promise<Org[]> {
		return this.list<Org>('/organizations/', signal);
	}

	async listProjects(orgSlug: string, signal?: AbortSignal): Promise<Project[]> {
		// Note: the projects endpoint returns a paged { data, total, ... } object,
		// whereas orgs/assets/refs return bare arrays. `list` tolerates both.
		return this.list<Project>(`/organizations/${seg(orgSlug)}/projects/`, signal);
	}

	async listAssets(orgSlug: string, projectSlug: string, signal?: AbortSignal): Promise<Asset[]> {
		return this.list<Asset>(`/organizations/${seg(orgSlug)}/projects/${seg(projectSlug)}/assets/`, signal);
	}

	async listRefs(orgSlug: string, projectSlug: string, assetSlug: string, signal?: AbortSignal): Promise<Ref[]> {
		return this.list<Ref>(
			`/organizations/${seg(orgSlug)}/projects/${seg(projectSlug)}/assets/${seg(assetSlug)}/refs/`,
			signal,
		);
	}

	/** One page of the flat dependency-vulnerability list for an asset version (each with its path). */
	async listDependencyVulnsFlat(
		orgSlug: string,
		projectSlug: string,
		assetSlug: string,
		refSlug: string,
		page: number,
		pageSize: number,
		signal?: AbortSignal,
	): Promise<Paged<DependencyVulnFlat>> {
		const base = `/organizations/${seg(orgSlug)}/projects/${seg(projectSlug)}/assets/${seg(assetSlug)}/refs/${seg(refSlug)}`;
		return this.json<Paged<DependencyVulnFlat>>(
			`${base}/dependency-vulns/?flat=true&page=${page}&pageSize=${pageSize}`,
			{ signed: true, signal },
		);
	}

	/** CycloneDX SBOM JSON for an asset version, returned as raw text. */
	async getSbom(orgSlug: string, projectSlug: string, assetSlug: string, refSlug: string, signal?: AbortSignal): Promise<string> {
		const base = `/organizations/${seg(orgSlug)}/projects/${seg(projectSlug)}/assets/${seg(assetSlug)}/refs/${seg(refSlug)}`;
		return this.text(`${base}/sbom.json/`, { signed: true, accept: 'application/json', signal });
	}

	private async json<T>(path: string, opts: RequestOptions): Promise<T> {
		const res = await this.fetch(path, opts);
		const body = await res.text();
		if (!res.ok) {
			throw new DevGuardHttpError(res.status, truncate(body) || res.statusText);
		}
		try {
			return JSON.parse(body) as T;
		} catch {
			throw new DevGuardNetworkError('received a non-JSON response from DevGuard');
		}
	}

	/** Fetches a list endpoint, tolerating both a bare array and a paged `{ data: [...] }` object. */
	private async list<T>(path: string, signal?: AbortSignal): Promise<T[]> {
		const parsed = await this.json<unknown>(path, { signed: true, signal });
		if (Array.isArray(parsed)) {
			return parsed as T[];
		}
		if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)) {
			return (parsed as { data: T[] }).data;
		}
		return [];
	}

	private async text(path: string, opts: RequestOptions): Promise<string> {
		const res = await this.fetch(path, opts);
		const body = await res.text();
		if (!res.ok) {
			throw new DevGuardHttpError(res.status, truncate(body) || res.statusText);
		}
		return body;
	}

	private async fetch(path: string, opts: RequestOptions): Promise<Response> {
		if (!config.isApiUrlValid()) {
			throw new DevGuardNetworkError('The configured devguard.apiUrl is not a valid http(s) URL.');
		}
		const url = `${config.getApiUrl()}/api/v1${path}`;
		const headers: Record<string, string> = { Accept: opts.accept ?? 'application/json' };

		if (opts.signed) {
			const token = await this.getToken();
			if (!token) {
				throw new NotConnectedError();
			}
			// Defense-in-depth: only ever attach signed headers to the configured host.
			const origin = config.getApiOrigin();
			if (!origin || new URL(url).origin !== origin) {
				throw new DevGuardNetworkError('refusing to sign a request to a non-configured host');
			}
			Object.assign(headers, signRequest(token, { method: 'GET' }));
		}

		// Caller signal + our own timeout, combined.
		const controller = new AbortController();
		const onAbort = () => controller.abort();
		opts.signal?.addEventListener('abort', onAbort, { once: true });
		const timer = setTimeout(() => controller.abort(), config.getTimeoutMs());

		let res: Response;
		try {
			res = await fetch(url, {
				method: 'GET',
				headers,
				signal: controller.signal,
				// Never follow a redirect on a signed request — it must not resend
				// the signature to another location.
				redirect: opts.signed ? 'manual' : 'follow',
			});
		} catch (err) {
			if (opts.signal?.aborted) {
				throw new DevGuardNetworkError('request cancelled');
			}
			throw new DevGuardNetworkError(`could not reach DevGuard at ${config.getApiUrl()}`);
		} finally {
			clearTimeout(timer);
			opts.signal?.removeEventListener('abort', onAbort);
		}

		if (opts.signed && (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400))) {
			throw new DevGuardHttpError(res.status || 302, 'unexpected redirect on a signed request');
		}
		return res;
	}
}

function seg(slug: string): string {
	return encodeURIComponent(slug);
}

function truncate(s: string): string {
	const t = s.trim();
	return t.length > 300 ? `${t.slice(0, 300)}…` : t;
}
