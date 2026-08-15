import * as ExpoCrypto from 'expo-crypto';

/**
 * Hermes / React Native has no `crypto.subtle`. Supabase PKCE then falls back
 * to `plain` (insecure and often rejected). Bridge expo-crypto onto globalThis
 * before createClient().
 */
function toUint8Array(data: BufferSource): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array();
}

function algorithmName(algorithm: AlgorithmIdentifier): string {
  if (typeof algorithm === 'string') {
    return algorithm;
  }
  return algorithm.name;
}

function expoDigestAlgo(name: string): ExpoCrypto.CryptoDigestAlgorithm {
  const key = name.toUpperCase().replace('-', '');
  if (key === 'SHA384') {
    return ExpoCrypto.CryptoDigestAlgorithm.SHA384;
  }
  if (key === 'SHA512') {
    return ExpoCrypto.CryptoDigestAlgorithm.SHA512;
  }
  return ExpoCrypto.CryptoDigestAlgorithm.SHA256;
}

export function installWebCryptoPolyfill(): void {
  const g = globalThis as typeof globalThis & { crypto?: Crypto };
  if (typeof g.crypto === 'undefined') {
    // @ts-expect-error RN global crypto shim
    g.crypto = {};
  }

  if (typeof g.crypto.getRandomValues !== 'function') {
    g.crypto.getRandomValues = ExpoCrypto.getRandomValues.bind(ExpoCrypto);
  }

  if (typeof g.crypto.subtle?.digest === 'function') {
    return;
  }

  const subtle = {
    digest: (algorithm: AlgorithmIdentifier, data: BufferSource) =>
      ExpoCrypto.digest(expoDigestAlgo(algorithmName(algorithm)), toUint8Array(data)),
  };

  try {
    Object.defineProperty(g.crypto, 'subtle', {
      value: subtle,
      configurable: true,
    });
  } catch {
    // @ts-expect-error assign when defineProperty is blocked
    g.crypto.subtle = subtle;
  }
}

installWebCryptoPolyfill();
