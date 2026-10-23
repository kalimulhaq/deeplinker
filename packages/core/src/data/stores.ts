import type { AndroidStoreId, Ecosystem } from "../types";

/**
 * Which Android stores a device of each ecosystem can actually install from. Among the ones a device can use, the
 * order the stores are written in the config decides. Devices without Google services (Huawei, Fire OS) cannot use Google
 * Play, so they never fall back to it; Samsung and Xiaomi phones have Play as well as their own store.
 */
export const ANDROID_STORE_CHAIN: Record<Ecosystem, readonly AndroidStoreId[]> = {
  huawei: ["huawei"],
  amazon: ["amazon"],
  samsung: ["samsung", "google"],
  xiaomi: ["xiaomi", "google"],
  google: ["google"],
};
