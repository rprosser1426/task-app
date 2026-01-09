# Project Notes – Task App

## Auth Setup
- Supabase project: iztpndewxqmncoihxllz
- Magic Link login implemented
- Redirect URL: /auth/callback
- Callback handles both:
  - ?code=... (PKCE)
  - #access_token=... (implicit)

## Local Dev
- Start app: npm run dev
- Clear cache: Remove-Item .next -Recurse -Force
- Stop server: Ctrl + C

## Common Fixes
- If Magic Link says "Missing code":
  - Send a NEW link
  - Check /auth/callback page code
- If build errors:
  - Restart server
  - Clear .next cache



| Extension | Think        |
| --------- | ------------ |
| `.md`     | Notes & docs |
| `.tsx`    | React UI     |
| `.ts`     | Logic        |
| `.css`    | Design       |
| `.json`   | Settings     |
| `.env`    | Secrets      |


## Website
http://localhost:3000/login


## Github

git add .
git commit -m "Short description of what I changed"
git push