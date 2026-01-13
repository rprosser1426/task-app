import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  // Where to send the user after session is created
  const redirectTo = url.searchParams.get("redirectTo") ?? "/";

  if (!code) {
    // If there's no code, bounce to login (or home)
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const cookieStore = cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  // This is the key line: turns the "code" into a session cookie
  await supabase.auth.exchangeCodeForSession(code); // :contentReference[oaicite:1]{index=1}

  return NextResponse.redirect(new URL(redirectTo, url.origin));
}
