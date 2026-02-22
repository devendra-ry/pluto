import 'server-only';

import { lookup } from 'node:dns';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

import { serverEnv } from '@/lib/env/server';

let fetchImplementation = undiciFetch;

export function _setFetchImplementation(fn: typeof undiciFetch) {
    fetchImplementation = fn;
}

const DEFAULT_ALLOWED_HOST_PATTERNS = ['chutes.ai', '*.chutes.ai'] as const;
const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.localdomain']);
const MAX_REDIRECTS = 3;

function parseAllowedHostPatterns(extraPatterns: string[] = []) {
    const envPatterns = (serverEnv.CHUTES_MEDIA_FETCH_ALLOWED_HOSTS || '')
        .split(',')
        .map((pattern) => pattern.trim().toLowerCase())
        .filter(Boolean);

    const merged = [
        ...DEFAULT_ALLOWED_HOST_PATTERNS,
        ...envPatterns,
        ...extraPatterns.map((pattern) => pattern.trim().toLowerCase()).filter(Boolean),
    ];

    return Array.from(new Set(merged));
}

function ipv4ToInt(address: string) {
    const parts = address.split('.').map((part) => Number.parseInt(part, 10));
    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) {
        return null;
    }
    return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + (parts[3] >>> 0);
}

function isPrivateIPv4(address: string) {
    const value = ipv4ToInt(address);
    if (value === null) return true;

    const inRange = (start: string, end: string) => {
        const min = ipv4ToInt(start);
        const max = ipv4ToInt(end);
        return min !== null && max !== null && value >= min && value <= max;
    };

    return (
        inRange('0.0.0.0', '0.255.255.255') || // "this" network
        inRange('10.0.0.0', '10.255.255.255') || // RFC1918 private
        inRange('100.64.0.0', '100.127.255.255') || // carrier-grade NAT
        inRange('127.0.0.0', '127.255.255.255') || // loopback
        inRange('169.254.0.0', '169.254.255.255') || // link-local
        inRange('172.16.0.0', '172.31.255.255') || // RFC1918 private
        inRange('192.0.0.0', '192.0.0.255') || // IETF protocol assignments
        inRange('192.168.0.0', '192.168.255.255') || // RFC1918 private
        inRange('198.18.0.0', '198.19.255.255') || // benchmark testing
        inRange('224.0.0.0', '239.255.255.255') || // multicast
        inRange('240.0.0.0', '255.255.255.254') || // reserved
        address === '255.255.255.255'
    );
}

function isPrivateIPv6(address: string) {
    const normalized = address.toLowerCase();

    if (
        normalized === '::' ||
        normalized === '::1' ||
        normalized.startsWith('fc') || // unique local
        normalized.startsWith('fd') || // unique local
        normalized.startsWith('fe8') || // link-local
        normalized.startsWith('fe9') || // link-local
        normalized.startsWith('fea') || // link-local
        normalized.startsWith('feb') || // link-local
        normalized.startsWith('ff') // multicast
    ) {
        return true;
    }

    // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
    const mappedIndex = normalized.lastIndexOf(':');
    if (mappedIndex !== -1) {
        const maybeIpv4 = normalized.slice(mappedIndex + 1);
        if (isIP(maybeIpv4) === 4) {
            return isPrivateIPv4(maybeIpv4);
        }
    }

    return false;
}

export function isPrivateIpAddress(address: string) {
    const version = isIP(address);
    if (version === 4) {
        return isPrivateIPv4(address);
    }
    if (version === 6) {
        return isPrivateIPv6(address);
    }
    return true;
}

function isHostAllowed(hostname: string, allowedHostPatterns: string[]) {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    if (!host || LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
        return false;
    }

    return allowedHostPatterns.some((pattern) => {
        if (pattern.startsWith('*.')) {
            const suffix = pattern.slice(2);
            return host === suffix || host.endsWith(`.${suffix}`);
        }
        return host === pattern;
    });
}

// Create a safe agent with custom lookup that blocks private IPs
const safeAgent = new Agent({
    connect: {
        lookup: (hostname, options, callback) => {
            let cb = callback;
            let opts = options;
            if (typeof options === 'function') {
                cb = options;
                opts = {};
            }

            lookup(hostname, opts, (err, addresses, family) => {
                if (err) return cb(err, addresses, family);

                const checkAddress = (addr: string) => {
                    if (isPrivateIpAddress(addr)) {
                        return new Error(`Remote host resolves to a private network address: ${hostname}`);
                    }
                    return null;
                };

                if (Array.isArray(addresses)) {
                    for (const addr of addresses) {
                        const ip = typeof addr === 'string' ? addr : addr.address;
                        const error = checkAddress(ip);
                        if (error) return cb(error, addresses, family);
                    }
                } else {
                    const error = checkAddress(addresses as string);
                    if (error) return cb(error, addresses, family);
                }

                cb(null, addresses, family);
            });
        },
    },
});

export async function assertSafeRemoteUrl(rawUrl: string, allowedHostPatterns: string[]) {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error('Invalid remote media URL');
    }

    if (parsed.protocol !== 'https:') {
        throw new Error('Only HTTPS remote media URLs are allowed');
    }
    if (parsed.username || parsed.password) {
        throw new Error('Credentials are not allowed in remote media URLs');
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!isHostAllowed(hostname, allowedHostPatterns)) {
        throw new Error(`Remote host is not allowed: ${hostname}`);
    }

    // DNS resolution is now handled by the custom Agent lookup

    return parsed;
}

interface GuardedFetchOptions {
    signal?: AbortSignal;
    allowedHostPatterns?: string[];
    maxRedirects?: number;
}

export async function fetchWithSsrfGuard(
    rawUrl: string,
    options: GuardedFetchOptions = {},
): Promise<Response> {
    const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
    const allowedHostPatterns = parseAllowedHostPatterns(options.allowedHostPatterns ?? []);

    let currentUrl = rawUrl;
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
        const safeUrl = await assertSafeRemoteUrl(currentUrl, allowedHostPatterns);
        // Use undiciFetch with the safeAgent
        const response = (await fetchImplementation(safeUrl, {
            method: 'GET',
            signal: options.signal,
            redirect: 'manual',
            dispatcher: safeAgent,
        })) as unknown as Response;

        if (response.status >= 300 && response.status < 400) {
            if (redirectCount === maxRedirects) {
                throw new Error('Too many redirects while fetching remote media');
            }
            const location = response.headers.get('location');
            if (!location) {
                throw new Error('Remote media redirect is missing a Location header');
            }
            currentUrl = new URL(location, safeUrl).toString();
            continue;
        }

        return response;
    }

    throw new Error('Remote media request failed due to redirect loop');
}
