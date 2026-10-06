import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CART_STORAGE_KEY, CartLine, demoProducts, formatPrice, Product, supabase } from "./src/lib/supabase";

const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
if (googleWebClientId) GoogleSignin.configure({ webClientId: googleWebClientId });

type Screen = "shop" | "bag" | "signin" | "checkout";

export default function App() {
  return <SafeAreaProvider><EasyOrderApp /></SafeAreaProvider>;
}

function EasyOrderApp() {
  const [screen, setScreen] = useState<Screen>("shop");
  const [afterSignIn, setAfterSignIn] = useState<"shop" | "checkout">("shop");
  const [products, setProducts] = useState<Product[]>(demoProducts);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [filter, setFilter] = useState("All objects");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [newsletterEmail, setNewsletterEmail] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      let localCart: CartLine[] = [];
      try {
        const savedCart = await AsyncStorage.getItem(CART_STORAGE_KEY);
        if (savedCart) {
          localCart = JSON.parse(savedCart) as CartLine[];
          if (active) setCart(localCart);
        }
      } catch {
        if (active) setMessage("Your saved bag could not be loaded.");
      }
      if (!supabase) {
        if (active) setLoading(false);
        return;
      }
      const [{ data: productRows, error: productError }, { data: sessionData, error: sessionError }] = await Promise.all([
        supabase.from("products").select("id,slug,name,description,category,price_cents,image_url,badge").eq("active", true).order("sort_order"),
        supabase.auth.getSession(),
      ]);
      if (!active) return;
      if (productError) setMessage(`We couldn't load the live catalog: ${productError.message}`);
      else if (productRows?.length) setProducts(productRows as Product[]);
      if (sessionError) setMessage(`We couldn't check your account: ${sessionError.message}`);
      if (sessionData.session?.user) {
        setUserId(sessionData.session.user.id);
        setEmail(sessionData.session.user.email ?? "");
        setCustomerName(String(sessionData.session.user.user_metadata.full_name ?? ""));
        await restoreRemoteCart(sessionData.session.user.id, active, localCart);
      }
      setLoading(false);
    })();
    const authSubscription = supabase?.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUserId(session?.user.id ?? null);
      setEmail(session?.user.email ?? "");
      if (!session) setCustomerName("");
      else setCustomerName(String(session.user.user_metadata.full_name ?? ""));
    }).data.subscription;
    return () => {
      active = false;
      authSubscription?.unsubscribe();
    };
  }, []);

  async function restoreRemoteCart(id: string, active = true, localCart: CartLine[] = []) {
    if (!supabase) return;
    const { data, error } = await supabase.from("cart_items")
      .select("quantity,product:products(id,slug,name,description,category,price_cents,image_url,badge)")
      .eq("user_id", id);
    if (error) {
      if (active) setMessage(`We couldn't sync your saved bag: ${error.message}`);
      return;
    }
    if (data?.length) {
      const restored = data.flatMap((row) => row.product ? [{ product: row.product as unknown as Product, quantity: row.quantity }] : []);
      if (active) setCart(restored);
      await saveLocalCart(restored);
    } else if (active && localCart.length) {
      const live = localCart.filter((line) => !line.product.id.startsWith("demo-"));
      if (live.length) await writeRemoteCart(id, live);
    }
  }

  async function saveLocalCart(next: CartLine[]): Promise<boolean> {
    setCart(next);
    let saved = true;
    try {
      await AsyncStorage.setItem(CART_STORAGE_KEY, JSON.stringify(next));
    } catch {
      setMessage("Your bag couldn't be saved on this device.");
      saved = false;
    }
    if (userId) saved = await writeRemoteCart(userId, next) && saved;
    return saved;
  }

  async function writeRemoteCart(id: string, lines: CartLine[]): Promise<boolean> {
    if (!supabase) return true;
    const { error: deleteError } = await supabase.from("cart_items").delete().eq("user_id", id);
    if (deleteError) {
      setMessage(`We couldn't update your saved bag: ${deleteError.message}`);
      return false;
    }
    const live = lines.filter((line) => !line.product.id.startsWith("demo-"));
    if (!live.length) return true;
    const { error } = await supabase.from("cart_items").upsert(live.map((line) => ({
      user_id: id, product_id: line.product.id, quantity: line.quantity,
    })));
    if (error) setMessage(`We couldn't update your saved bag: ${error.message}`);
    return !error;
  }

  async function addToBag(product: Product) {
    const existing = cart.find((line) => line.product.id === product.id);
    if (existing && existing.quantity >= 25) {
      setMessage("You can add up to 25 of each item.");
      return;
    }
    const next = existing
      ? cart.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line)
      : [...cart, { product, quantity: 1 }];
    if (await saveLocalCart(next)) setMessage(`${product.name} added to your bag.`);
  }

  async function changeQuantity(productId: string, delta: number) {
    const next = cart.map((line) => line.product.id === productId
      ? { ...line, quantity: Math.min(25, line.quantity + delta) }
      : line).filter((line) => line.quantity > 0);
    await saveLocalCart(next);
  }

  async function signInWithGoogle() {
    if (!supabase) {
      setMessage("Connect the mobile app to the EasyOrder Supabase project to enable Google sign-in.");
      return;
    }
    if (!googleWebClientId) {
      setMessage("Google sign-in needs the existing Google web client ID in EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result = await GoogleSignin.signIn();
      if (result.type === "cancelled") {
        setMessage("Google sign-in was cancelled.");
        return;
      }
      const idToken = result.data.idToken;
      if (!idToken) throw new Error("Google didn't return an ID token. Check the Android and web OAuth client configuration.");
      const { data, error } = await supabase.auth.signInWithIdToken({ provider: "google", token: idToken });
      if (error) throw error;
      if (data.user) await restoreRemoteCart(data.user.id, true, cart);
      setScreen(afterSignIn);
    } catch (error) {
      setMessage(`Google sign-in failed: ${error instanceof Error ? error.message : "Please try again."}`);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.signOut();
    if (error) {
      setMessage(`We couldn't sign you out: ${error.message}`);
      setBusy(false);
      return;
    }
    try {
      await GoogleSignin.signOut();
    } catch (error) {
      setMessage(`You are signed out of EasyOrder, but Google couldn't clear this device's account selection: ${error instanceof Error ? error.message : "Please check Google Play services."}`);
    }
    setScreen("shop");
    setBusy(false);
  }

  async function placeOrder() {
    if (!supabase || !userId) {
      setMessage("Sign in with Google before placing your order.");
      setScreen("signin");
      return;
    }
    if (!customerName.trim() || !address.trim() || !city.trim() || !postalCode.trim()) {
      setMessage("Please complete your delivery details.");
      return;
    }
    if (!cart.length || cart.some((line) => line.product.id.startsWith("demo-"))) {
      setMessage("Your bag contains preview items. Connect the live catalog before checkout.");
      return;
    }
    setBusy(true);
    setMessage("");
    const { data: orderId, error } = await supabase.rpc("place_order", {
      p_customer_name: customerName,
      p_shipping_address: { address, city, postal_code: postalCode, country: "US" },
      p_items: cart.map((line) => ({ product_id: line.product.id, quantity: line.quantity })),
    });
    if (error || !orderId) {
      setBusy(false);
      setMessage(error?.message ?? "We couldn't place your order. Please try again.");
      return;
    }
    let confirmationSent = false;
    const webOrigin = process.env.EXPO_PUBLIC_EASYORDER_WEB_URL;
    if (webOrigin) {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const response = await fetch(`${webOrigin.replace(/\/$/, "")}/api/order-confirmation`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionData.session?.access_token ?? ""}`,
          },
          body: JSON.stringify({ orderId }),
        });
        const result = await response.json();
        confirmationSent = Boolean(result.sent);
      } catch {
        confirmationSent = false;
      }
    }
    const { error: cartError } = await supabase.from("cart_items").delete().eq("user_id", userId);
    if (cartError) setMessage(`Order placed, but your saved bag could not be cleared: ${cartError.message}`);
    try {
      await AsyncStorage.removeItem(CART_STORAGE_KEY);
    } catch {
      setMessage("Order placed, but the saved bag could not be cleared on this device.");
    }
    setCart([]);
    setScreen("shop");
    Alert.alert(
      "Order received",
      confirmationSent
        ? "Thank you for shopping small. A confirmation is on its way."
        : `Thank you for shopping small. Your order number is ${orderId}. Email confirmation could not be sent.`,
    );
    setBusy(false);
  }

  const categories = useMemo(() => ["All objects", ...Array.from(new Set(products.map((product) => product.category)))], [products]);
  const visibleProducts = filter === "All objects" ? products : products.filter((product) => product.category === filter);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = cart.reduce((sum, line) => sum + line.product.price_cents * line.quantity, 0);
  const shipping = subtotal >= 7500 || subtotal === 0 ? 0 : 700;
  const total = subtotal + shipping;

  function goBack() {
    setMessage("");
    if (screen === "checkout") setScreen("bag");
    else setScreen("shop");
  }

  if (loading) return <SafeAreaView style={styles.loading}><ActivityIndicator color={colors.ink} /><Text style={styles.body}>Getting EasyOrder ready…</Text></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.topbar}>
        <Pressable onPress={() => setScreen("shop")}><Text style={styles.brand}>easyorder<Text style={styles.brandDot}>.</Text></Text></Pressable>
      </View>
      {screen === "shop" && <ScrollView style={styles.screen} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        {message ? <View style={styles.notice}><Text style={styles.noticeText}>{message}</Text><Pressable onPress={() => setMessage("")}><Text style={styles.noticeDismiss}>×</Text></Pressable></View> : null}
        <View style={styles.announcement}><Text style={styles.announcementText}>LOVELY EVERYDAY THINGS, MADE EASY  ·  FREE SHIPPING OVER $75</Text></View>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>GOOD FINDS, NO FUSS</Text>
          <Text style={styles.heroTitle}>Good things.{"\n"}Easy days.{"\n"}<Text style={styles.italic}>Made easy.</Text></Text>
          <Text style={styles.heroText}>Little comforts, useful favorites, and everyday finds, picked with care and just a click away.</Text>
          <Pressable style={styles.darkButton} onPress={() => setFilter("All objects")}><Text style={styles.darkButtonText}>Shop the good stuff  →</Text></Pressable>
          <Image source={{ uri: "https://images.unsplash.com/photo-1490312278390-ab64016e0aa9?auto=format&fit=crop&w=1200&q=85" }} style={styles.heroImage} />
          <Text style={styles.imageCaption}>SMALL THINGS, GOOD LIVING</Text>
        </View>
        <View style={styles.accountBanner}>
          <View style={styles.accountCopy}>
            <Text style={styles.eyebrow}>{userId ? "YOUR EASYORDER ACCOUNT" : "YOUR BAG, SAVED FOR LATER"}</Text>
            <Text style={styles.accountTitle}>{userId ? "Good to see you." : "Already have an account?"}</Text>
            <Text style={styles.body}>{userId ? email : "Sign in with Google to keep your bag close and check out securely."}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            style={styles.accountButton}
            onPress={() => {
              setMessage("");
              setAfterSignIn(userId ? "shop" : "checkout");
              setScreen(userId ? "checkout" : "signin");
            }}
          >
            <Text style={styles.accountButtonText}>{userId ? "Go to checkout  →" : "Sign in with Google  →"}</Text>
          </Pressable>
        </View>
        <View style={styles.manifesto}><Text style={styles.eyebrow}>A LITTLE MORE INTENTIONAL</Text><Text style={styles.sectionTitle}>Fewer things.{"\n"}<Text style={styles.italic}>More feeling.</Text></Text><Text style={styles.body}>We partner with independent makers to bring useful, enduring objects into your everyday. Nothing extra. Nothing in a hurry.</Text></View>
        <View style={styles.sectionHead}><Text style={styles.eyebrow}>THE EASYORDER EDIT</Text><Text style={styles.sectionTitle}>Everyday favorites,{"\n"}<Text style={styles.italic}>found.</Text></Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {categories.map((category) => <Pressable key={category} onPress={() => setFilter(category)} style={[styles.filter, filter === category && styles.filterActive]}><Text style={[styles.filterText, filter === category && styles.filterTextActive]}>{category}</Text></Pressable>)}
        </ScrollView>
        {!supabase && <Text style={styles.setupNote}>Preview catalog shown. Connect the existing Supabase project to load live inventory and enable checkout.</Text>}
        <View style={styles.products}>
          {visibleProducts.map((product) => <View style={styles.productCard} key={product.id}>
            <View style={styles.productImageWrap}><Image source={{ uri: product.image_url }} style={styles.productImage} /><Text style={styles.productCategory}>{product.category.toUpperCase()}</Text>{product.badge && <Text style={styles.badge}>{product.badge}</Text>}</View>
            <View style={styles.productDetails}><View style={styles.productCopy}><Text style={styles.productName}>{product.name}</Text><Text style={styles.description}>{product.description}</Text><Text style={styles.price}>{formatPrice(product.price_cents)}</Text></View><Pressable style={styles.addButton} onPress={() => void addToBag(product)}><Text style={styles.addButtonText}>+</Text></Pressable></View>
            <Pressable style={styles.addWide} onPress={() => void addToBag(product)}><Text style={styles.addWideText}>Add to bag</Text></Pressable>
          </View>)}
        </View>
        <View style={styles.newsletter}>
          <Text style={styles.eyebrow}>A GOOD NOTE, NOW AND THEN</Text>
          <Text style={styles.sectionTitle}>Keep in <Text style={styles.italic}>good company.</Text></Text>
          <Text style={styles.body}>A little note from us, now and then.</Text>
          <View style={styles.newsletterForm}>
            <TextInput
              accessibilityLabel="Your email address"
              value={newsletterEmail}
              onChangeText={setNewsletterEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              style={styles.newsletterInput}
            />
            <Pressable
              accessibilityRole="button"
              style={styles.newsletterButton}
              onPress={() => {
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newsletterEmail)) {
                  Alert.alert("Check your email", "Enter a valid email address to continue.");
                  return;
                }
                Alert.alert("Thanks for being here", "Newsletter signup will be available soon.");
              }}
            >
              <Text style={styles.newsletterButtonText}>→</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.footer}>GOOD EVERYDAY THINGS, MADE EASY  ·  © 2026 EASYORDER</Text>
      </ScrollView>}
      {screen === "signin" && <ScrollView style={styles.screen} contentContainerStyle={styles.page}>
        <Pressable onPress={goBack}><Text style={styles.back}>←  Back to shop</Text></Pressable>
        <View style={styles.authCard}><Text style={styles.eyebrow}>YOUR EASYORDER ACCOUNT</Text><Text style={styles.heroTitle}>Good things,{"\n"}<Text style={styles.italic}>one click away.</Text></Text><Text style={styles.body}>Sign in to keep your bag close and pick up checkout right where you left it.</Text>
          {userId ? <>
            <Text style={styles.body}>{email}</Text>
            <Pressable style={styles.darkButton} onPress={() => setScreen("checkout")}><Text style={styles.darkButtonText}>Continue to checkout  →</Text></Pressable>
            <Pressable style={styles.signOutButton} disabled={busy} onPress={() => void signOut()}><Text style={styles.signOutText}>{busy ? "Signing out…" : "Sign out"}</Text></Pressable>
          </>
            : <Pressable disabled={busy} style={styles.googleButton} onPress={() => void signInWithGoogle()}><Text style={styles.googleG}>G</Text><Text style={styles.googleText}>{busy ? "Connecting to Google…" : "Continue with Google"}</Text></Pressable>}
          {!userId && <View style={styles.signinSteps}>
            <Text style={styles.signinStep}><Text style={styles.stepNumber}>01  </Text>Choose the Google account you want to use.</Text>
            <Text style={styles.signinStep}><Text style={styles.stepNumber}>02  </Text>Confirm your account in Google's secure Android picker.</Text>
            <Text style={styles.signinStep}><Text style={styles.stepNumber}>03  </Text>Continue to checkout right here in EasyOrder.</Text>
          </View>}
          {!userId && <Text style={styles.privacy}>Your password stays with Google. EasyOrder receives your basic account details.</Text>}
          {!googleWebClientId && <Text style={styles.setupNote}>Add the existing Google web client ID to EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID to enable native sign-in.</Text>}
          {!supabase && <Text style={styles.setupNote}>Sign-in setup is not complete for this shop yet. Connect this app to the EasyOrder Supabase project to continue.</Text>}
          {message ? <Text style={styles.error}>{message}</Text> : null}
        </View>
      </ScrollView>}
      {screen === "bag" && <ScrollView style={styles.screen} contentContainerStyle={styles.page}>
        <Pressable onPress={goBack}><Text style={styles.back}>←  Back to shop</Text></Pressable>
        <Text style={styles.eyebrow}>YOUR ORDER, NEARLY THERE</Text><Text style={styles.sectionTitle}>Your <Text style={styles.italic}>bag.</Text></Text>
        {!cart.length ? <View style={styles.empty}><Text style={styles.body}>Your bag is taking a quiet moment.</Text><Pressable style={styles.darkButton} onPress={() => setScreen("shop")}><Text style={styles.darkButtonText}>Find something good  →</Text></Pressable></View>
          : cart.map((line) => <View style={styles.cartLine} key={line.product.id}>
            <Image source={{ uri: line.product.image_url }} style={styles.cartImage} />
            <View style={styles.cartCopy}><Text style={styles.productName}>{line.product.name}</Text><Text style={styles.description}>{formatPrice(line.product.price_cents)}</Text><View style={styles.quantity}><Pressable onPress={() => void changeQuantity(line.product.id, -1)}><Text style={styles.quantityButton}>−</Text></Pressable><Text style={styles.quantityValue}>{line.quantity}</Text><Pressable onPress={() => void changeQuantity(line.product.id, 1)}><Text style={styles.quantityButton}>+</Text></Pressable></View></View>
          </View>)}
        <View style={styles.totals}><Summary label="Subtotal" value={formatPrice(subtotal)} /><Summary label="Shipping" value={shipping === 0 ? "Complimentary" : formatPrice(shipping)} /><Summary label="Total" value={formatPrice(total)} bold /></View>
        {!!cart.length && <Pressable style={styles.darkButton} onPress={() => { setMessage(""); setAfterSignIn("checkout"); setScreen(userId ? "checkout" : "signin"); }}><Text style={styles.darkButtonText}>{userId ? "Continue to checkout" : "Sign in to check out"}  →</Text></Pressable>}
        {message ? <Text style={styles.error}>{message}</Text> : null}
      </ScrollView>}
      {screen === "checkout" && <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <Pressable onPress={goBack}><Text style={styles.back}>←  Back to bag</Text></Pressable>
          <Text style={styles.eyebrow}>SECURE CHECKOUT</Text><Text style={styles.sectionTitle}>Check <Text style={styles.italic}>out.</Text></Text>
          {!userId ? <View style={styles.empty}><Text style={styles.body}>Sign in with Google to continue to delivery details.</Text><Pressable style={styles.darkButton} onPress={() => { setAfterSignIn("checkout"); setScreen("signin"); }}><Text style={styles.darkButtonText}>Continue to sign in  →</Text></Pressable></View> : <>
            <Text style={styles.formSection}>01  CONTACT</Text><Text style={styles.inputLabel}>Email address</Text><TextInput value={email} editable={false} style={styles.input} autoCapitalize="none" keyboardType="email-address" />
            <Text style={styles.formSection}>02  DELIVERY</Text>
            <Field label="Full name" value={customerName} onChangeText={setCustomerName} />
            <Field label="Street address" value={address} onChangeText={setAddress} />
            <Field label="City" value={city} onChangeText={setCity} />
            <Field label="ZIP code" value={postalCode} onChangeText={setPostalCode} />
            <View style={styles.totals}><Summary label="Subtotal" value={formatPrice(subtotal)} /><Summary label="Shipping" value={shipping === 0 ? "Complimentary" : formatPrice(shipping)} /><Summary label="Total" value={formatPrice(total)} bold /></View>
            {message ? <Text style={styles.error}>{message}</Text> : null}
            <Pressable disabled={busy} style={[styles.darkButton, busy && styles.disabled]} onPress={() => void placeOrder()}><Text style={styles.darkButtonText}>{busy ? "Placing your order…" : `Place order  ·  ${formatPrice(total)}`}</Text></Pressable>
            <Text style={styles.privacy}>By placing your order, you agree to our terms and privacy policy. Payments are not yet connected.</Text>
          </>}
        </ScrollView>
      </KeyboardAvoidingView>}
      {screen !== "shop" && message && screen !== "bag" && screen !== "checkout" ? <Text style={styles.error}>{message}</Text> : null}
      <View style={styles.bottomBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={userId ? "Open account" : "Sign in with Google"}
          style={[styles.bottomAction, screen === "signin" && styles.bottomActionActive]}
          onPress={() => {
            setMessage("");
            setAfterSignIn(userId ? "shop" : "checkout");
            setScreen("signin");
          }}
        >
          <Text style={[styles.bottomActionText, screen === "signin" && styles.bottomActionTextActive]}>{userId ? "Account" : "Sign in"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open shopping bag, ${itemCount} items`}
          style={[styles.bottomAction, styles.bottomBagAction, screen === "bag" && styles.bottomActionActive]}
          onPress={() => { setMessage(""); setScreen("bag"); }}
        >
          <Ionicons
            name="cart-outline"
            size={20}
            color={screen === "bag" ? colors.accent : colors.paper}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <Text style={[styles.bottomActionText, screen === "bag" && styles.bottomActionTextActive]}>Bag</Text>
          <Text style={styles.bottomCount}>{itemCount}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Summary({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return <View style={styles.summaryRow}><Text style={bold ? styles.summaryBold : styles.summaryLabel}>{label}</Text><Text style={bold ? styles.summaryBold : styles.summaryValue}>{value}</Text></View>;
}

function Field({ label, value, onChangeText }: { label: string; value: string; onChangeText: (text: string) => void }) {
  return <View style={styles.field}><Text style={styles.inputLabel}>{label}</Text><TextInput value={value} onChangeText={onChangeText} style={styles.input} autoCapitalize="words" /></View>;
}

const colors = { paper: "#f6f4ee", white: "#fffefa", ink: "#20251f", muted: "#73776f", line: "#deded5", olive: "#e8e9df", accent: "#71805c" };
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper }, flex: { flex: 1 }, screen: { flex: 1 }, loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: colors.paper },
  topbar: { minHeight: 66, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8, flexDirection: "row", alignItems: "center", backgroundColor: colors.white, borderBottomWidth: 1, borderColor: colors.line },
  brand: { color: colors.ink, fontSize: 23, fontWeight: "700", letterSpacing: -1.5 }, brandDot: { color: colors.accent },
  page: { paddingBottom: 38 }, announcement: { paddingHorizontal: 18, paddingVertical: 10, backgroundColor: colors.ink }, announcementText: { color: colors.paper, textAlign: "center", fontSize: 9, letterSpacing: 1.15 },
  hero: { padding: 22, paddingTop: 34 }, eyebrow: { color: colors.accent, fontSize: 10, letterSpacing: 1.7, fontWeight: "700", marginBottom: 12 }, heroTitle: { color: colors.ink, fontSize: 43, lineHeight: 48, fontWeight: "500", letterSpacing: -2 }, italic: { fontStyle: "italic", fontWeight: "400" },
  heroText: { color: colors.muted, fontSize: 15, lineHeight: 23, marginTop: 14, marginBottom: 20, maxWidth: 350 }, darkButton: { backgroundColor: colors.ink, paddingVertical: 15, paddingHorizontal: 18, alignItems: "center", marginTop: 14, borderRadius: 2 }, darkButtonText: { color: colors.white, fontSize: 13, fontWeight: "600", letterSpacing: 0.2 },
  heroImage: { width: "100%", height: 285, marginTop: 26, backgroundColor: colors.olive }, imageCaption: { color: colors.muted, fontSize: 9, letterSpacing: 1.3, marginTop: 9 },
  manifesto: { padding: 24, paddingVertical: 38, backgroundColor: colors.olive, marginVertical: 20 }, sectionTitle: { color: colors.ink, fontSize: 31, lineHeight: 37, fontWeight: "500", letterSpacing: -1, marginBottom: 12 }, body: { color: colors.muted, fontSize: 14, lineHeight: 22 },
  sectionHead: { paddingHorizontal: 20, paddingTop: 22 }, filters: { paddingHorizontal: 20, paddingVertical: 16, gap: 8 }, filter: { paddingVertical: 9, paddingHorizontal: 13, borderRadius: 22, borderWidth: 1, borderColor: colors.line }, filterActive: { backgroundColor: colors.ink, borderColor: colors.ink }, filterText: { color: colors.muted, fontSize: 12 }, filterTextActive: { color: colors.white },
  setupNote: { color: colors.muted, fontSize: 12, lineHeight: 18, marginHorizontal: 20, marginBottom: 12 }, products: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 13 }, productCard: { width: "50%", padding: 7, marginBottom: 10 }, productImageWrap: { position: "relative" }, productImage: { width: "100%", height: 178, backgroundColor: colors.olive }, productCategory: { position: "absolute", left: 8, bottom: 8, backgroundColor: colors.white, color: colors.ink, fontSize: 8, letterSpacing: 1, paddingHorizontal: 7, paddingVertical: 5 }, badge: { position: "absolute", right: 7, top: 7, backgroundColor: colors.ink, color: colors.white, paddingHorizontal: 7, paddingVertical: 5, fontSize: 8 },
  productDetails: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingTop: 10, gap: 4 }, productCopy: { flex: 1 }, productName: { color: colors.ink, fontSize: 13, fontWeight: "600" }, description: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 }, price: { color: colors.ink, fontSize: 12, marginTop: 8 }, addButton: { width: 29, height: 29, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" }, addButtonText: { fontSize: 21, lineHeight: 23, color: colors.ink }, addWide: { marginTop: 9, paddingVertical: 9, alignItems: "center", backgroundColor: colors.olive }, addWideText: { fontSize: 11, color: colors.ink, fontWeight: "600" },
  newsletter: { padding: 22, marginTop: 30, backgroundColor: colors.white }, newsletterForm: { flexDirection: "row", marginTop: 16, borderWidth: 1, borderColor: colors.line }, newsletterInput: { flex: 1, minHeight: 46, paddingHorizontal: 12, color: colors.ink, fontSize: 13 }, newsletterButton: { width: 48, alignItems: "center", justifyContent: "center", backgroundColor: colors.ink }, newsletterButtonText: { color: colors.white, fontSize: 20 }, footer: { color: colors.muted, fontSize: 9, letterSpacing: 1, textAlign: "center", paddingTop: 25 },
  accountBanner: { marginHorizontal: 20, marginTop: 6, padding: 18, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, accountCopy: { gap: 5 }, accountTitle: { color: colors.ink, fontSize: 21, fontWeight: "500", letterSpacing: -0.4 }, accountButton: { marginTop: 14, paddingVertical: 13, paddingHorizontal: 14, backgroundColor: colors.olive, alignItems: "center" }, accountButtonText: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  notice: { backgroundColor: colors.olive, paddingVertical: 11, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, noticeText: { color: colors.ink, fontSize: 12, flex: 1, marginRight: 8 }, noticeDismiss: { color: colors.ink, fontSize: 19, paddingHorizontal: 4 },
  back: { color: colors.muted, fontSize: 13, padding: 20 }, authCard: { paddingHorizontal: 22, paddingTop: 15 }, googleButton: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, padding: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 22 }, googleG: { color: "#4285F4", fontSize: 17, fontWeight: "700" }, googleText: { color: colors.ink, fontSize: 14, fontWeight: "600" }, privacy: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 18 },
  signinSteps: { marginTop: 22, gap: 13, paddingTop: 18, borderTopWidth: 1, borderColor: colors.line }, signinStep: { color: colors.muted, fontSize: 12, lineHeight: 18 }, stepNumber: { color: colors.accent, fontWeight: "700" }, signOutButton: { marginTop: 14, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: colors.line }, signOutText: { color: colors.ink, fontSize: 13, fontWeight: "600" },
  callbackHelp: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 14 }, callbackUrl: { color: colors.ink, fontSize: 10, lineHeight: 15, marginTop: 4 },
  error: { color: "#a23f35", fontSize: 12, lineHeight: 18, marginTop: 14 }, empty: { padding: 20, backgroundColor: colors.white, marginVertical: 16 }, cartLine: { flexDirection: "row", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderColor: colors.line, gap: 14 }, cartImage: { width: 86, height: 96, backgroundColor: colors.olive }, cartCopy: { flex: 1, paddingTop: 6 }, quantity: { flexDirection: "row", alignItems: "center", gap: 18, marginTop: 10 }, quantityButton: { fontSize: 20, color: colors.ink }, quantityValue: { fontSize: 12, color: colors.ink },
  bottomBar: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 9, paddingBottom: 12, backgroundColor: colors.white, borderTopWidth: 1, borderColor: colors.line, elevation: 12 }, bottomAction: { minHeight: 46, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, bottomBagAction: { backgroundColor: colors.ink, borderColor: colors.ink }, bottomActionActive: { borderColor: colors.accent }, bottomActionText: { color: colors.ink, fontSize: 14, fontWeight: "700" }, bottomActionTextActive: { color: colors.accent }, bottomCount: { minWidth: 23, height: 23, overflow: "hidden", borderRadius: 12, textAlign: "center", textAlignVertical: "center", color: colors.ink, backgroundColor: colors.paper, fontSize: 12, fontWeight: "700" },
  totals: { padding: 20, marginTop: 10, borderTopWidth: 1, borderColor: colors.line }, summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7 }, summaryLabel: { color: colors.muted, fontSize: 13 }, summaryValue: { color: colors.ink, fontSize: 13 }, summaryBold: { color: colors.ink, fontSize: 15, fontWeight: "700" }, formSection: { color: colors.accent, fontSize: 11, letterSpacing: 1.4, fontWeight: "700", marginTop: 26, marginBottom: 13 },
  field: { marginBottom: 15 }, inputLabel: { color: colors.ink, fontSize: 12, marginBottom: 7 }, input: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, color: colors.ink }, disabled: { opacity: 0.6 },
});
