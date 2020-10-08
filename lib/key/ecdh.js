import { crypto } from 'openpgp';
import { concatArrays, binaryStringToArray } from '../utils';

// Key Derivation Function (RFC 6637)
export async function kdf(hashAlgo, X, length, param, stripLeading = false, stripTrailing = false) {
    // Note: X is little endian for Curve25519, big-endian for all others.
    // This is not ideal, but the RFC's are unclear
    // https://tools.ietf.org/html/draft-ietf-openpgp-rfc4880bis-02#appendix-B
    let i;
    if (stripLeading) {
        // Work around old go crypto bug
        for (i = 0; i < X.length && X[i] === 0; i++);
        X = X.subarray(i);
    }
    if (stripTrailing) {
        // Work around old OpenPGP.js bug
        for (i = X.length - 1; i >= 0 && X[i] === 0; i--);
        X = X.subarray(0, i + 1);
    }
    const digest = await crypto.hash.digest(hashAlgo, concatArrays([new Uint8Array([0, 0, 0, 1]), X, param]));
    return digest.subarray(0, length);
}

// Build Param for ECDH algorithm (RFC 6637)
export function buildEcdhParam(publicAlgo, oid, kdfParams, fingerprint) {
    return concatArrays([
        oid.write(),
        new Uint8Array([publicAlgo]),
        kdfParams.write(),
        binaryStringToArray('Anonymous Sender    '),
        fingerprint.subarray(0, 20)
    ]);
}

/**
 * Generate ECDHE secret from private key and public part of ephemeral key
 *
 * @param  {Uint8Array}             V            Public part of ephemeral key
 * @param  {Uint8Array}             Q            Recipient public key
 * @param  {Uint8Array}             d            Recipient private key
 * @returns {Promise<{secretKey: Uint8Array, sharedKey: Uint8Array}>}
 * @async
 */
export async function genCurvePrivateEphemeralKey(V, Q, d) {
    if (d.length !== 32) {
        const privateKey = new Uint8Array(32);
        privateKey.set(d, 32 - d.length);
        d = privateKey;
    }
    const secretKey = d.slice().reverse();
    const sharedKey = crypto.publicKey.nacl.scalarMult(secretKey, V.subarray(1));
    return { secretKey, sharedKey }; // Note: sharedKey is little-endian here
}

/**
 * Generate ECDHE ephemeral key and secret from public key
 *
 * @param  {Uint8Array}             Q            Recipient public key
 * @returns {Promise<{publicKey: Uint8Array, sharedKey: Uint8Array}>}
 * @async
 */
export async function genCurvePublicEphemeralKey(Q) {
    const d = await crypto.random.getRandomBytes(32);
    const { secretKey, sharedKey } = await genCurvePrivateEphemeralKey(Q, null, d);
    let { publicKey } = crypto.publicKey.nacl.box.keyPair.fromSecretKey(secretKey);
    publicKey = concatArrays([new Uint8Array([0x40]), publicKey]);
    return { publicKey, sharedKey }; // Note: sharedKey is little-endian here
}