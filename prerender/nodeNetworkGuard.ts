import { createRequire, syncBuiltinESMExports } from 'node:module';
import { denyStaticRenderNetwork } from './networkCapabilityError.ts';

type MutableRecord = Record<PropertyKey, unknown>;
type Restore = () => void;

const require = createRequire(import.meta.url);

/**
 * Blocks the Node networking entry points commonly used by server-side
 * libraries. The browser APIs are blocked separately by the JSDOM environment.
 * Filesystem, child-process, worker and native-addon access are enforced by the
 * Node Permission Model on the renderer process itself.
 */
export function installNodeNetworkGuard(): () => void {
    const restores: Restore[] = [];
    const http = require('node:http');
    const https = require('node:https');
    const http2 = require('node:http2');
    const net = require('node:net');
    const tls = require('node:tls');
    const dgram = require('node:dgram');
    const dns = require('node:dns');
    const dnsPromises = require('node:dns/promises');

    blockMethods(http, ['get', 'request'], restores);
    blockMethods(http.Agent?.prototype, ['createConnection'], restores);
    blockMethods(http, ['ClientRequest'], restores);
    blockMethods(https, ['get', 'request'], restores);
    blockMethods(https.Agent?.prototype, ['createConnection'], restores);
    blockMethods(http2, ['connect'], restores);
    blockMethods(net, ['connect', 'createConnection'], restores);
    blockMethods(net.Socket?.prototype, ['connect'], restores);
    blockMethods(tls, ['connect'], restores);
    blockMethods(tls.TLSSocket?.prototype, ['connect'], restores);
    blockMethods(dgram, ['createSocket'], restores);
    blockMethods(dgram.Socket?.prototype, ['bind', 'connect', 'send'], restores);
    blockMethods(dns, getFunctionKeys(dns), restores);
    blockMethods(dns.Resolver?.prototype, getFunctionKeys(dns.Resolver?.prototype || {}), restores);
    blockMethods(dnsPromises, getFunctionKeys(dnsPromises), restores);
    blockMethods(process as unknown as MutableRecord, ['binding', '_linkedBinding'], restores);
    syncBuiltinESMExports();

    return () => {
        for (const restore of restores.reverse()) restore();
        syncBuiltinESMExports();
    };
}

function blockMethods(target: MutableRecord | undefined, keys: PropertyKey[], restores: Restore[]): void {
    if (!target) return;

    for (const key of keys) {
        if (typeof target[key] !== 'function') continue;

        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        if (!descriptor) continue;

        Object.defineProperty(target, key, {
            ...descriptor,
            value: () => denyStaticRenderNetwork(String(key)),
        });
        restores.push(() => Object.defineProperty(target, key, descriptor));
    }
}

function getFunctionKeys(target: MutableRecord): PropertyKey[] {
    return Reflect.ownKeys(target).filter(key => typeof target[key] === 'function');
}
