import {verifyReservationToken} from '../src/lib/turnstile-verification';

// Uses Cloudflare's public dummy keys only. Never loads private configuration.
async function main() {
  const env={APP_ORIGIN:'http://localhost:3000',NEXT_PUBLIC_TURNSTILE_SITE_KEY:'1x00000000000000000000AA',PALMSTEEZE_TURNSTILE_TEST_MODE:'true'};
  for(const [name,secret,expected] of [['always-pass','1x0000000000000000000000000000000AA',true],['always-fail','2x0000000000000000000000000000000AA',false],['spent-token','3x0000000000000000000000000000000AA',false]] as const) {
    const result=await verifyReservationToken('XXXX.DUMMY.TOKEN.XXXX',{...env,TURNSTILE_SECRET_KEY:secret});
    if(result.ok!==expected) throw new Error(`Official test-key check failed: ${name}`);
    console.log(`PASSED: Cloudflare official ${name} key. No genuine widget or customer proof implied.`);
  }
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Official-key verification unavailable');process.exitCode=1;});
