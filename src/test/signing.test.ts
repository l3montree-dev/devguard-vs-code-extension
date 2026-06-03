import * as assert from 'assert';
import { createHash } from 'node:crypto';
import { p256 } from '@noble/curves/p256';
import { deriveFingerprint, isValidTokenFormat, signRequest } from '../api/signing';

// Fixed P-256 private scalar used as a test vector. The golden fingerprint was
// cross-checked against the Go server's pubKeyToFingerprint (sha256 of
// hex(X.Bytes())+hex(Y.Bytes())) using the real github.com/yaronf/httpsign lib.
const FIXED = '1a73970f31816d996ab514c4ffea04b6dee0eadc107267d0c911fd817a7b5167';
const GOLDEN_FINGERPRINT = 'b6c40569c43b73924a56e90e4130916b556afe42b20e45ba6fcd9a25d4378c96';
const EMPTY_BODY_DIGEST = 'sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:';

suite('signing', () => {
	test('fingerprint matches the Go-computed golden value', () => {
		assert.strictEqual(deriveFingerprint(FIXED), GOLDEN_FINGERPRINT);
	});

	test('content-digest is the structured sha-256 of the empty body', () => {
		const headers = signRequest(FIXED, { method: 'GET' });
		assert.strictEqual(headers['Content-Digest'], EMPTY_BODY_DIGEST);
	});

	test('signature-input covers @method and content-digest with created + alg', () => {
		const headers = signRequest(FIXED, { method: 'GET' });
		assert.match(
			headers['Signature-Input'],
			/^sig77=\("@method" "content-digest"\);created=\d+;alg="ecdsa-p256-sha256"$/,
		);
	});

	test('signature verifies against the derived public key (round trip)', () => {
		const headers = signRequest(FIXED, { method: 'GET' });
		const created = /created=(\d+)/.exec(headers['Signature-Input'])?.[1];
		const params = `("@method" "content-digest");created=${created};alg="ecdsa-p256-sha256"`;
		const base = `"@method": GET\n"content-digest": ${headers['Content-Digest']}\n"@signature-params": ${params}`;
		const hash = createHash('sha256').update(base, 'utf8').digest();
		const rs = Buffer.from(/^sig77=:(.+):$/.exec(headers.Signature)?.[1] ?? '', 'base64');
		const pub = p256.getPublicKey(Buffer.from(FIXED, 'hex'), false);
		assert.ok(p256.verify(rs, hash, pub));
	});

	test('isValidTokenFormat accepts hex keys and rejects junk', () => {
		assert.ok(isValidTokenFormat(FIXED));
		assert.ok(isValidTokenFormat(`0x${FIXED}`));
		assert.ok(!isValidTokenFormat('not-a-token'));
		assert.ok(!isValidTokenFormat(''));
		assert.ok(!isValidTokenFormat('z'.repeat(64)));
	});
});
