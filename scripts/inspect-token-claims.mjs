import { createHash } from 'node:crypto';

const token = (await new Promise(resolve => {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => resolve(input.trim()));
}));

if (!token || typeof token !== 'string') throw new Error('A token must be supplied on stdin');
const parts = token.split('.');
if (parts.length < 2) throw new Error('Not a JWT');
const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
const groupClaim = process.env.GROUP_CLAIM_NAME ?? 'urn:zitadel:iam:org:project:roles';
const subject = typeof payload.sub === 'string'
  ? createHash('sha256').update(payload.sub).digest('hex').slice(0, 16)
  : undefined;

console.log(JSON.stringify({
  issuer: payload.iss,
  audience: payload.aud,
  subject_hash: subject,
  expires_at: payload.exp,
  group_claim_name: groupClaim,
  group_claim: payload[groupClaim]
}, null, 2));
