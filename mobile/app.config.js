// app.config.js — dynamic Expo config that injects env vars at build time.
// Set SUPABASE_URL and SUPABASE_ANON_KEY via `eas secret:create` or a local .env.
const IS_DEV = process.env.APP_VARIANT === "development";

module.exports = ({ config }) => {
  const plugins = [...(config.plugins || [])];
  for (const plugin of ["expo-secure-store", "expo-status-bar"]) {
    if (!plugins.some((entry) => (Array.isArray(entry) ? entry[0] : entry) === plugin)) {
      plugins.push(plugin);
    }
  }

  return {
    ...config,
    plugins,
    extra: {
      ...config.extra,
      supabaseUrl: process.env.SUPABASE_URL || config.extra?.supabaseUrl || "",
      supabaseAnonKey:
        process.env.SUPABASE_ANON_KEY || config.extra?.supabaseAnonKey || "",
      revenueCatAndroidApiKey:
        process.env.REVENUECAT_ANDROID_API_KEY ||
        config.extra?.revenueCatAndroidApiKey ||
        "",
    },
  };
};
