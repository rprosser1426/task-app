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



## Github (Type each one at a time be sure to add the git add .)

pwd           (Confirm you are in the correct project folder)
ls
-----------------------------------------------------------------
git remote -v  (Verify the GitHub repo this project is connected to)

--------------------------------------------------------------------------------

git status  (Check what files changed)

Review the list carefully.

✅ OK: only files you intended to change

⚠️ STOP: if you see unrelated files

--------------------------------------------------------------------------------
                        Stage only the specific files you want

                      Do NOT use git add . unless you are sure.

  git add app/api/health/route.ts

--------------------------------------------------------------------------------
Make sure only intended files are under:

git status

-----------------------------------------------------------------------------------
Commit

git commit -m "Short clear message of what changed"

--------------------------------------------------------------------------------
Confirm branch

git branch

-------------------------------------------------------------------------------

Push
git push origin main
--------------------------------------------------------------------------------
git add .    
git commit -m "Short description of what I changed"
git push



📊 Recommended Setup (for 5 users)
Component	Tier	Cost
Supabase (Database & Auth)	Free	$0/mo
Vercel (App hosting)	Free	$0/mo
Total Monthly Cost	—	$0/mo

## Format Code
Click anywhere inside the file, then press:

Shift + Alt + F

https://task-app-phi-amber.vercel.app/api/health


This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
