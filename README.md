# EasyOrder Android

The Android companion app for the EasyOrder storefront. It reuses the existing Supabase project, catalog, customer accounts, saved carts, and `place_order` database function. Google sign-in uses Google's native Android account picker and sends the returned ID token to Supabase.

## Run on Android

This app includes a native Google Sign-In module, so **it does not run in Expo Go**. Install the custom development build on your Android phone. The native sign-in flow stays in the app; it does not open the shop website or a browser.

1. Install Node.js 20.9 or newer and Android Studio/Android SDK, or use an EAS cloud build.
2. From this folder, run `npm install`.
3. Copy `.env.example` to `.env.local`. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` to the same public values used by the web shop. Set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to the existing Google **web** OAuth client ID configured in Supabase. Set `EXPO_PUBLIC_EASYORDER_WEB_URL` to the deployed website origin if order-confirmation emails are enabled.
4. For the EAS APK, open the project's Android credentials page at `https://expo.dev/accounts/jessek2/projects/easyorder-android/credentials?platform=android`, open `com.easyorder.mobile`, and copy the **SHA-1 fingerprint** under Android upload keystore. In Google Cloud Console, create an OAuth client ID of type **Android** with package `com.easyorder.mobile` and that SHA-1. For local debug builds, also register the debug SHA-1 from `cd android; .\gradlew signingReport`.
5. In Supabase **Authentication → Providers → Google**, keep the existing web Client ID first, then add the new Android Client ID in the Client IDs field, separated by a comma. Keep the existing Google web client ID in `.env.local` as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; do not put a client secret in the app.
6. Build and install a fresh APK after adding/changing OAuth credentials: `npx eas-cli build --profile preview --platform android`. For EAS, configure the `EXPO_PUBLIC_*` values in the EAS environment as well; `.env.local` is not uploaded.

The Google **web** client ID is public configuration, not a secret. Never put the Google client secret or Supabase service-role key in the app. Keep the existing Google provider enabled in Supabase. No Supabase OAuth redirect URL is needed for native ID-token sign-in.

## Store and checkout notes

- The live catalog and account carts use the existing Supabase `products` and `cart_items` tables.
- Checkout calls the existing `place_order` RPC; no schema migration or separate backend is needed.
- Order confirmation email uses the web shop's `/api/order-confirmation` endpoint when `EXPO_PUBLIC_EASYORDER_WEB_URL` is set.
- The web shop currently has no payment provider, and the Android app does not collect card details.
- When Supabase is not configured, the app shows the same four preview products as the web storefront. Preview products cannot be ordered.
