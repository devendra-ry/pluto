import { test } from 'node:test';
import assert from 'node:assert';
import { isPrivateIpAddress } from './ssrf-guard';

test('isPrivateIpAddress', async (t) => {
    await t.test('returns true for IPv4 private ranges', () => {
        const privateIPv4s = [
            '0.0.0.0', // "this" network
            '0.255.255.255',
            '10.0.0.1', // RFC1918 private
            '10.255.255.255',
            '100.64.0.1', // carrier-grade NAT
            '100.127.255.255',
            '127.0.0.1', // loopback
            '127.255.255.255',
            '169.254.0.1', // link-local
            '169.254.255.255',
            '172.16.0.1', // RFC1918 private
            '172.31.255.255',
            '192.0.0.1', // IETF protocol assignments
            '192.0.0.255',
            '192.168.0.1', // RFC1918 private
            '192.168.255.255',
            '198.18.0.1', // benchmark testing
            '198.19.255.255',
            '224.0.0.1', // multicast
            '239.255.255.255',
            '240.0.0.1', // reserved
            '255.255.255.254',
            '255.255.255.255'
        ];

        for (const ip of privateIPv4s) {
            assert.strictEqual(isPrivateIpAddress(ip), true, `Should identify ${ip} as private`);
        }
    });

    await t.test('returns false for IPv4 public addresses', () => {
        const publicIPv4s = [
            '8.8.8.8',
            '1.1.1.1',
            '9.255.255.255',
            '11.0.0.0',
            '172.15.255.255',
            '172.32.0.0',
            '192.169.0.0'
        ];

        for (const ip of publicIPv4s) {
            assert.strictEqual(isPrivateIpAddress(ip), false, `Should identify ${ip} as public`);
        }
    });

    await t.test('returns true for IPv6 private ranges', () => {
        const privateIPv6s = [
            '::',
            '::1',
            'fc00::1', // unique local
            'fd00::1', // unique local
            'fe80::1', // link-local
            'ff00::1', // multicast
            'fe90::',
            'fea0::',
            'feb0::'
        ];

        for (const ip of privateIPv6s) {
            assert.strictEqual(isPrivateIpAddress(ip), true, `Should identify ${ip} as private`);
        }
    });

    await t.test('returns false for IPv6 public addresses', () => {
        const publicIPv6s = [
            '2001:4860:4860::8888', // Google DNS
            '2606:4700:4700::1111', // Cloudflare DNS
            '2000::1'
        ];

        for (const ip of publicIPv6s) {
            assert.strictEqual(isPrivateIpAddress(ip), false, `Should identify ${ip} as public`);
        }
    });

    await t.test('handles IPv4-mapped IPv6 addresses', async (t) => {
        await t.test('returns true for mapped private IPv4', () => {
            assert.strictEqual(isPrivateIpAddress('::ffff:127.0.0.1'), true);
            assert.strictEqual(isPrivateIpAddress('::ffff:10.0.0.1'), true);
            assert.strictEqual(isPrivateIpAddress('::ffff:192.168.1.1'), true);
        });

        await t.test('returns false for mapped public IPv4', () => {
            assert.strictEqual(isPrivateIpAddress('::ffff:8.8.8.8'), false);
            assert.strictEqual(isPrivateIpAddress('::ffff:1.1.1.1'), false);
        });
    });

    await t.test('returns true (default safe) for invalid IPs', () => {
        // The implementation returns true if version is not 4 or 6.
        assert.strictEqual(isPrivateIpAddress('invalid-ip'), true);
        assert.strictEqual(isPrivateIpAddress(''), true);
        assert.strictEqual(isPrivateIpAddress('256.256.256.256'), true); // Invalid IPv4
        assert.strictEqual(isPrivateIpAddress('1.2.3'), true); // Invalid IPv4 format
    });
});
