import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function safeRedirectPath(path: string) {
  // Only allow internal redirects
  if (!path || typeof path !== "string") return "/";
  if (!path.startsWith("/")) return "/";
  // prevent protocol-relative like //evil.com
  if (path.startsWith("//")) return "/";
  return path;
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const code = url.searchParams.get("code");

  // support either redirectTo or next
  const redirectToRaw =
    url.searchParams.get("redirectTo") ??
    url.searchParams.get("next") ??
    "/";

  const redirectTo = safeRedirectPath(redirectToRaw);

  if (!code) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const cookieStore = await cookies(); // ✅ use await (works across Next versions)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: any }>) {

          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // If exchange fails, bounce to login with a hint
    const errUrl = new URL("/login", url.origin);
    errUrl.searchParams.set("error", "oauth_exchange_failed");
    return NextResponse.redirect(errUrl);
  }

  return NextResponse.redirect(new URL(redirectTo, url.origin));
}
