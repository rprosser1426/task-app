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