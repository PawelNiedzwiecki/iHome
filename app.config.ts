import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Extends app.json. Govee discovery uses multicast, which iOS only allows with the
 * `com.apple.developer.networking.multicast` entitlement. Apple grants it on request
 * (https://developer.apple.com/contact/request/networking-multicast). Signing fails if
 * the entitlement is present before Apple has approved it, so it is opt-in:
 *
 *   IHOME_MULTICAST=1 npx expo run:ios
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const multicast = process.env.IHOME_MULTICAST === '1';
  return {
    ...config,
    name: config.name ?? 'iHome',
    slug: config.slug ?? 'ihome',
    ios: {
      ...config.ios,
      entitlements: {
        ...config.ios?.entitlements,
        ...(multicast ? { 'com.apple.developer.networking.multicast': true } : {}),
      },
    },
  };
};
