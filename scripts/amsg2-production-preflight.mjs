/**
 * Read-only public preflight for the known personal production Worker.
 * Exactly two unauthenticated GETs: /config-check and /debug; no secret values or paid models.
 * An inaccessible endpoint is reported as UNKNOWN, never as a successful live deployment.
 * This script is intentionally informational and non-blocking for PR CI.
 */
const WORKER_CONFIG_CHECK = 'https://sullyos-amsg.yanlue.workers.dev/config-check';
// 同一份版本常量供前后端使用；只读本仓库文件，不额外请求生产 API。
import { readFileSync } from 'node:fs';
const versionSource = readFileSync(new URL('../utils/amsgBundleVersion.ts', import.meta.url), 'utf8');
const versionMatch = versionSource.match(/AMSG_BUNDLE_VERSION\s*=\s*'([^']+)'/);
if (!versionMatch) throw new Error('Cannot parse the bundled Worker version');
const EXPECTED_VERSION = versionMatch[1];

const report = (message, data = {}) => {
  console.log('[amsg2:production-readonly] ' + JSON.stringify({ message, ...data }));
};

try {
  const response = await fetch(WORKER_CONFIG_CHECK, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    report('UNKNOWN: Worker config-check HTTP error; no live-version conclusion', { httpStatus: response.status });
  } else {
    const body = await response.json();
    if (body?.success !== true || !body?.data || typeof body.data !== 'object') {
      report('UNKNOWN: unexpected config-check response; no live-version conclusion');
    } else {
      const data = body.data;
      const version = typeof data.workerVersion === 'string' ? data.workerVersion : null;
      const missing = Array.isArray(data.missing) ? data.missing.filter(x => typeof x === 'string') : [];
      const warningCodes = Array.isArray(data.warnings)
        ? data.warnings.map(x => x?.code).filter(x => typeof x === 'string') : [];
      report(version === EXPECTED_VERSION
        ? 'VERSION_MATCHES: public Worker reports expected code; production delivery still unverified'
        : 'VERSION_DIFFERENT: production Worker is not yet the candidate version', {
        workerVersion: version,
        expectedVersion: EXPECTED_VERSION,
        configurationOk: data.ok === true,
        missing,
        warningCodes,
        instantTick: data.instantTick === true,
        selfUpdateSupported: data.selfUpdate?.supported === true,
        lastSelfUpdateOutcome: typeof data.selfUpdate?.state?.lastOutcome === 'string' ? data.selfUpdate.state.lastOutcome : null,
        lastSelfUpdateCheckAt: typeof data.selfUpdate?.state?.lastCheckAt === 'string' ? data.selfUpdate.state.lastCheckAt : null,
        lastSelfUpdateErrorCode: typeof data.selfUpdate?.state?.lastError?.code === 'string' ? data.selfUpdate.state.lastError.code : null,
        backgroundJobs: data.backgroundJobs === true,
      });
    }
  }
} catch (error) {
  // Do not print arbitrary response bodies, URLs from redirects, or credential-bearing error text.
  report('UNKNOWN: cannot reach public Worker from GitHub runner; do not infer anything about deployment', {
    errorType: error instanceof Error ? error.name : 'unknown',
  });
}

// The existing Worker already exposes a read-only /debug inspection route.
// Perform exactly one additional GET before a production release; only report
// whitelisted health booleans/status/counts. Never dump the raw debug response.
try {
  const response = await fetch('https://sullyos-amsg.yanlue.workers.dev/debug', {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    report('DEBUG_UNKNOWN: Worker debug HTTP error', { httpStatus: response.status });
  } else {
    const body = await response.json();
    if (body?.success !== true || !body.data || typeof body.data !== 'object') {
      report('DEBUG_UNKNOWN: unexpected Worker debug response');
    } else {
      const { config, storage, tick, schema } = body.data;
      const safeCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
      report('DEBUG_READONLY: existing production Worker and D1 status (no secret values)', {
        configurationOk: config?.ok === true,
        d1Reachable: storage?.reachable === true,
        schemaReady: storage?.schemaReady === true ? true : storage?.schemaReady === false ? false : null,
        schemaProbePresent: schema !== null && schema !== undefined,
        tickStatus: ['idle', 'healthy', 'failing', 'stalled', 'unknown'].includes(tick) ? tick : 'unknown',
        pendingTaskCount: safeCount(storage?.pendingTasks),
        overdueTaskCount: safeCount(storage?.overdueTasks),
        registeredPush: storage?.pushSubscriptionRegistered === true,
        pushDeliveryStatus: storage?.pushDelivery && typeof storage.pushDelivery === 'object'
          ? 'available' : 'unknown',
      });
    }
  }
} catch (error) {
  report('DEBUG_UNKNOWN: cannot inspect public production Worker debug from CI', {
    errorType: error instanceof Error ? error.name : 'unknown',
  });
}
