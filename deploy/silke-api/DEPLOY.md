# silke-lengler.ch contact form — deploy runbook

Mirrors the barbazza.wine setup exactly: a tiny, isolated Node app mounted at
`silke-lengler.ch/api` (cPanel "Setup Node.js App" / Passenger). No PHP, no build
step, no framework. Same server as barbazza (198.177.120.118), so this is known-good.

This whole folder is staged and ready. When silke-lengler.ch is live on the server,
run the steps below — start to finish it's ~5 minutes, and only **one** value
(`SMTP_PASS`) is filled in.

```
deploy/silke-api/
  server.js            the endpoint (→ Praxis@Silke-Lengler.ch)
  package.json         deps: busboy, nodemailer
  .silke-mail.env      SMTP config — set SMTP_PASS, then chmod 600 on the server
  silke-contact.js     drop-in form wiring for the live page
  DEPLOY.md            this file
```

SSH (same as barbazza):
```
KEY=~/.ssh/oskar_key ; H=aweseybn@198.177.120.118 ; P=21098
alias sx="ssh -i $KEY -p $P $H"
```

---

## Prerequisites (must be true before deploying)

1. **silke-lengler.ch is added to this cPanel account** (addon domain or as configured)
   and its docroot exists — e.g. `~/silke-lengler.ch/`.
2. **A sending mailbox exists**: `postmaster@silke-lengler.ch`. Create it in cPanel →
   Email Accounts if it isn't there yet, and note its password.
   (Recipient `Praxis@Silke-Lengler.ch` must also exist as a deliverable mailbox.)

---

## 1. Fill the one secret

Edit `.silke-mail.env` and replace `__SET_AT_DEPLOY__` with the real
`postmaster@silke-lengler.ch` password. Everything else is already correct.

## 2. Upload the app files

```
sx 'mkdir -p ~/silke-api'
for f in server.js package.json .silke-mail.env ; do
  ssh -i $KEY -p $P $H "cat > ~/silke-api/$f" < "deploy/silke-api/$f"
done
sx 'chmod 600 ~/silke-api/.silke-mail.env'        # creds never world-readable
```

## 3. Create the cPanel Node app  (registers the /api mount + Passenger)

```
sx 'cloudlinux-selector create --json --interpreter nodejs \
      --domain silke-lengler.ch --app-root silke-api --app-uri api \
      --version 24.15.0 --app-mode production --startup-file server.js'
```
Expect `{"result": "success"}`. This also writes `~/silke-lengler.ch/api/.htaccess`.

## 4. Install deps, then restart

```
sx 'cloudlinux-selector install-modules --json --interpreter nodejs --app-root silke-api'
sx 'cloudlinux-selector restart        --json --interpreter nodejs --app-root silke-api'
```
The `install-modules` step may print a benign health-check warning ("return code
'None' / content-type text/html ≠ application/json") — that's cPanel probing the
app root and getting a 404 page; the npm install still ran. Confirm with:
```
sx 'for m in nodemailer busboy ; do ls ~/silke-api/node_modules/$m/package.json >/dev/null 2>&1 && echo "$m OK" || echo "$m MISSING" ; done'
```
If anything is MISSING, install inside the app venv:
```
sx 'source ~/nodevenv/silke-api/24/bin/activate && cd ~/silke-api && npm install --no-audit --no-fund && touch ~/silke-api/tmp/restart.txt'
```

## 5. Wire the live form

Add the script to the deployed page (the proposal forms are dummies until this loads):
```
ssh -i $KEY -p $P $H 'cat > ~/silke-lengler.ch/silke-contact.js' < deploy/silke-api/silke-contact.js
```
Then add this line before `</body>` of the live index page:
```
<script src="/silke-contact.js" defer></script>
```
(Or paste the contents of `silke-contact.js` inline in a `<script>` tag.)
The script finds the contact form by its fields, kills the dummy "Danke" handler,
and POSTs to `/api/contact`. The form's existing field names (`name`, `email`,
`telefon`, `nachricht`) are already what the endpoint expects.

---

## 6. Verify (the green test table)

```
# a. endpoint alive
curl -s "https://silke-lengler.ch/api/contact"
#   -> {"ok":true,"info":"silke-lengler contact endpoint — POST to send"}

# b. real submission (use a unique token so you can find it in the mailbox)
TOK="S-$(date +%H%M%S)"
curl -s -X POST "https://silke-lengler.ch/api/contact" \
  -F "name=Deploy Test $TOK" -F "email=test@example.com" \
  -F "nachricht=Live endpoint test $TOK, bitte ignorieren." -F "company=" \
  -w "\n  -> HTTP %{http_code}\n"
#   -> {"ok":true}

# c. confirm it reached Praxis@Silke-Lengler.ch
#    (open the Praxis mailbox, or IMAP-read the postmaster BCC archive for $TOK —
#     same _verify.mjs approach used for barbazza, pointed at .silke-mail.env)
```

All green = done: a real form submission delivered to **Praxis@Silke-Lengler.ch**,
sent as `postmaster@silke-lengler.ch`, isolated from every other app on the box.
