import { createHash } from 'node:crypto';
import { p256 } from '@noble/curves/p256';

// Reproduces devguard `services/pat_service.go` SignRequest byte-for-byte:
// RFC 9421 HTTP Message Signatures, ECDSA P-256, signing only "@method" and
// "content-digest", signature label "sig77", default config (SignCreated +
// SignAlg true). The server verifies with NewP256Verifier over the same fields.

export interface SignInput {
	method: string;
	/** Request body bytes; empty for GET. */
	body?: Uint8Array;
}

export interface SignedHeaders {
	'X-Fingerprint': string;
	'Content-Digest': string;
	'Signature-Input': string;
	Signature: string;
}

/** True if the string is plausibly a hex-encoded P-256 private scalar. */
export function isValidTokenFormat(token: string): boolean {
	try {
		privKeyBytes(token);
		return true;
	} catch {
		return false;
	}
}

/**
 * X-Fingerprint = sha256_hex( hex(X) + hex(Y) ).
 * X and Y are the public-key coordinates encoded the way Go's big.Int.Bytes()
 * does it: minimal big-endian with leading zero bytes stripped. Reproducing
 * that stripping is essential — the server looks the PAT up by this fingerprint.
 */
export function deriveFingerprint(hexPrivKey: string): string {
	const d = privKeyBytes(hexPrivKey);
	const pub = p256.getPublicKey(d, false); // 0x04 || X(32) || Y(32)
	const pubKeyString = bigIntBytesHex(pub.subarray(1, 33)) + bigIntBytesHex(pub.subarray(33, 65));
	return createHash('sha256').update(pubKeyString, 'utf8').digest('hex');
}

export function signRequest(hexPrivKey: string, input: SignInput): SignedHeaders {
	const d = privKeyBytes(hexPrivKey);
	const body = input.body ?? new Uint8Array(0);

	// 1. Content-Digest: structured field `sha-256=:<standard-base64>:`
	const digestB64 = createHash('sha256').update(body).digest('base64');
	const contentDigest = `sha-256=:${digestB64}:`;

	// 2. Signature params + base. Param order is fixed: created, then alg.
	const created = Math.floor(Date.now() / 1000);
	const params = `("@method" "content-digest");created=${created};alg="ecdsa-p256-sha256"`;
	const base =
		`"@method": ${input.method.toUpperCase()}\n` +
		`"content-digest": ${contentDigest}\n` +
		`"@signature-params": ${params}`;

	// 3. ECDSA P-256 over SHA-256(base) -> raw r||s (64 bytes). noble uses
	//    deterministic k (RFC 6979) and low-S; Go's ecdsa.Verify accepts low-S.
	const hash = createHash('sha256').update(base, 'utf8').digest();
	const rs = p256.sign(hash, d).toCompactRawBytes();
	const sigB64 = Buffer.from(rs).toString('base64');

	return {
		'X-Fingerprint': deriveFingerprint(hexPrivKey),
		'Content-Digest': contentDigest,
		'Signature-Input': `sig77=${params}`,
		Signature: `sig77=:${sigB64}:`,
	};
}

/** Validates and normalizes a hex token to a 32-byte big-endian scalar. */
function privKeyBytes(token: string): Uint8Array {
	let h = token.trim().toLowerCase();
	if (h.startsWith('0x')) {
		h = h.slice(2);
	}
	if (h.length === 0 || h.length > 64 || !/^[0-9a-f]+$/.test(h)) {
		throw new Error('personal access token must be a hex-encoded P-256 private key');
	}
	return Buffer.from(h.padStart(64, '0'), 'hex');
}

/** Mirrors Go big.Int.Bytes(): big-endian, leading zero bytes removed (keeps >=1 byte). */
function bigIntBytesHex(fixed: Uint8Array): string {
	let i = 0;
	while (i < fixed.length - 1 && fixed[i] === 0) {
		i++;
	}
	return Buffer.from(fixed.subarray(i)).toString('hex');
}
