# Vertex AI (Agent Platform) and a service account for a Google account — manual for an LLM agent

Written 2026-10-22 from the setup of Robert Oppliger's Google account (project `mini5server`), done with Claude in Chrome. Follow it in order. Google renamed Vertex AI to **Agent Platform**: the API is still `aiplatform.googleapis.com`, the role is still `roles/aiplatform.user`, but the console shows the new names. The console may be in German; German labels are given with their meaning.

## What you need before you start

| Input | Example (Robert) | Where it comes from |
|---|---|---|
| `ACCOUNT` | Robert's Gmail address | the Google account that will own everything; it must be signed in in Chrome |
| `PROJECT` | `mini5server` | an existing Cloud project of that account (see step 1 if there is none) |
| `SA` | `oskar-ai` | name of the service account to create |
| `KEY_PATH` | `/Oskar/ops/vertex/oskar-ai.json` | where the key file goes, inside the repo but git-ignored |
| `REPO` | `/Oskar` | the repo whose code will use the key |

Tools: Claude in Chrome (`mcp__claude-in-chrome__*`) in a new tab of the user's Chrome, Bash, Node with `google-auth-library` installed in `REPO`.

## Rules for the agent

- **The human does:** accepting the free-trial terms, and everything on the payment page (account type, name, address, card). Stop there and hand over; tell the human the exact tab and button. (On 2026-10-22 the Claude Code auto-mode classifier also blocked the click on the trial terms.)
- Never print the key file's contents. To check it, print only `type`, `client_email`, `project_id`.
- Don't delete anything; move files instead.
- Work in one tab and close it at the end.

## Step 0 — Read the current state (read-only)

1. Billing of the project: `https://console.cloud.google.com/billing/linkedaccount?project=PROJECT`
   - "Das Projekt verfügt über kein Rechnungskonto" = no billing account linked.
   - If it redirects to `…/billing/<BILLING_ID>?project=PROJECT`, a billing account is already linked: note `BILLING_ID`, skip step 4.
2. Billing accounts of the user: `https://console.cloud.google.com/billing/manage` → open the "Rechnungskonto" dropdown. "Keine Elemente vorhanden" = the user has none.
3. A blue banner "Starten Sie Ihren kostenlosen Testzeitraum mit einem Guthaben von 300 $" + button "Jetzt kostenlos testen" = the account is eligible for the free trial (only accounts that never had a paid billing account are).
4. Google AI plan (decides whether step 5 applies): `https://one.google.com/about/plans` → `find` "Aktuelles Abo". The $10/month credit exists only with **Google AI Pro or Ultra**.
5. Developer Program: `https://me.developers.google.com/benefits` → a button "Am Programm teilnehmen" = not a member yet.

Report the state to the human before changing anything.

## Step 1 — Project (only if there is none)

`https://console.cloud.google.com/projectcreate` → name → Create. The first visit to the console asks for the country and the Google Cloud terms: that is the human's decision (Robert: Switzerland, no marketing emails). Use the project ID (not the name) as `PROJECT` from here on.

## Step 2 — Service account with only the Vertex user role

1. `https://console.cloud.google.com/iam-admin/serviceaccounts/create?project=PROJECT`
2. Wait ~5 s. Clicks by screen coordinate on a freshly loaded console page often land nowhere; get refs with `read_page` (`filter: interactive`) and click the textboxes by `ref`.
   - Name ("Name des Dienstkontos") = `SA`; the ID fills itself; description e.g. "Oskar: Vertex AI (images)".
   - "Erstellen und fortfahren" (Create and continue).
3. Step "Berechtigungen" (Permissions): **the console preselects "Inhaber" (Owner). Replace it.** Open the role picker, type `aiplatform.user`, choose **"Agent Platform User"** ("Gewährt Zugriff auf alle Ressourcen der Agent Platform"). → "Fortfahren". A toast "Richtlinie aktualisiert" confirms.
4. Step 3 "Hauptkonten mit Zugriff": leave empty → "Fertig".
5. Verify: `https://console.cloud.google.com/iam-admin/iam?project=PROJECT` (wait ~10 s, the table loads late) → the row `SA@PROJECT.iam.gserviceaccount.com` shows **only** "Agent Platform User".

Note: a tool call the user rejected may still have executed its first click. Always look at the page before assuming nothing happened.

## Step 3 — Key file, git-ignored first

1. **Before downloading**, make sure the key's folder can't be committed:
   ```bash
   cd REPO && git check-ignore -v ops/vertex/SA.json || printf '\nops/vertex/\n' >> .gitignore
   git check-ignore -v ops/vertex/SA.json   # must print the .gitignore line
   ```
   (On Robert's mini nothing under `ops/` was ignored, including `ops/rclone/rclone.conf` with the Drive token; both are ignored now.)
2. `https://console.cloud.google.com/iam-admin/serviceaccounts?project=PROJECT` → row `SA` → "⋮" (Aktionen) → "Schlüssel verwalten" → "Schlüssel hinzufügen" → "Neuen Schlüssel erstellen" → JSON (preselected) → "Erstellen". Chrome saves `~/Downloads/PROJECT-<12 hex>.json`; close the dialog ("Schließen").
3. Move it into place and lock it down:
   ```bash
   mkdir -p REPO/ops/vertex && chmod 700 REPO/ops/vertex
   mv ~/Downloads/PROJECT-*.json KEY_PATH && chmod 600 KEY_PATH
   node -e 'const k=require(process.argv[1]); console.log(k.type, k.client_email, k.project_id)' KEY_PATH
   ```
   Expected: `service_account SA@PROJECT.iam.gserviceaccount.com PROJECT`. Nothing left in `~/Downloads`.

## Step 4 — Billing account with the free trial (the human finishes it)

1. Click "Jetzt kostenlos testen" (any console page with the banner; `find` it to get the ref).
2. "Schritt 1 von 2 — Kontoinformationen": account and country (preset from step 1), terms → **"Zustimmen und fortfahren" is the human's click.**
3. "Schritt 2 von 2": account type (in Switzerland always Business), name, address, payment card → **human**. Then "Kostenlos testen starten".
4. Hand over with the tab name ("Schritt 1 von 2 – Kostenlos testen") and wait until the human says it's done.
5. Verify: `https://console.cloud.google.com/billing/linkedaccount?project=PROJECT` redirects to `…/billing/<BILLING_ID>` with "Konto für kostenlosen Testzeitraum". The trial links the new billing account to `PROJECT` by itself. Robert's trial: CHF 250 (= $300) for 90 days.

Not eligible for the trial: `https://console.cloud.google.com/billing/create` → human fills it in → then link it: Billing → "Rechnungskonto verknüpfen" for `PROJECT`.

## Step 5 — Developer Program and the $10 monthly credit (Google AI Pro/Ultra only)

1. `https://me.developers.google.com/benefits` → "Am Programm teilnehmen".
2. Profile form: "Name*" = the account holder's name (the only required field). **Untick "Profil öffentlich" and "Bestätigung des Abos von E-Mails/Newslettern".** → "Profil erstellen".
3. Card "Monatliches GenAI- und Cloud-Guthaben in Höhe von 10 $" (badge with the month, "LÄUFT AB AM" one year later):
   - The billing account dropdown closes before an option can be clicked. Instead: `find` the combobox "Rechnungskonto auswählen" → click it by ref → key `ArrowDown` → key `Enter`. Check by zoom that the billing account name is shown.
   - Tick "Immer dieses Rechnungskonto verwenden" (so every following month's credit lands there by itself).
   - "Anwenden".
4. The page shows no confirmation. Verify at `https://console.cloud.google.com/billing/BILLING_ID/credits/all?project=PROJECT`: a row **"Google Developer Program premium benefit - CREDIT_TYPE_MONTHLY"**, status "Verfügbar", CHF 8.32 (= $10), scope "Google Cloud – insgesamt und Google Maps APIs".
5. Close any extra tab the benefits page opened (the "Google AI Pro oder Ultra freischalten" card links to Google One).

## Step 6 — Enable the API

`https://console.cloud.google.com/apis/library/aiplatform.googleapis.com?project=PROJECT` → "Agent Platform API" → "Aktivieren" → wait ~10 s → the details page shows Status "Aktiviert". Needs the billing account from step 4.

## Step 7 — Test call with the service-account key

```js
// vertex-test.js — run: node vertex-test.js   (REPO, PROJECT, KEY_PATH filled in)
const { GoogleAuth } = require('REPO/node_modules/google-auth-library')
const fs = require('fs')
;(async () => {
  const auth = new GoogleAuth({ keyFile: 'KEY_PATH', scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
  const token = await auth.getAccessToken()
  const url = 'https://aiplatform.googleapis.com/v1/projects/PROJECT/locations/global/publishers/google/models/gemini-nano-banana-2.1:generateContent'
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'A simple flat illustration of a green leaf on a white background.' }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:1' } },
    }),
  })
  const data = await res.json()
  console.log('HTTP', res.status)
  if (!res.ok) return console.log(JSON.stringify(data.error, null, 1))
  const img = (data.candidates?.[0]?.content?.parts || []).find(p => p.inlineData)
  if (img) fs.writeFileSync('vertex-test.png', Buffer.from(img.inlineData.data, 'base64'))
  console.log(img ? 'image saved' : 'no image', JSON.stringify(data.usageMetadata))
})()
```

Expected (Robert, 2026-10-22): `HTTP 200` after ~14 s, a 1024×1024 PNG, about 1,150 output tokens. The cost appears in the billing report after a few hours and is offset by the credits. Errors: `403 PERMISSION_DENIED` → API not enabled yet (wait a few minutes) or the role is missing; `404` on the model → try `us-central1` instead of `global`.

## Step 8 — Oskar uses Vertex for every Gemini call (wired 2026-10-22)

**Where:** `lib/gemini.ts`, nothing else. All six Google calls in that file (`generateImage`, `callGemini` = generate/edit/compose, `editImageWithText`, `chat`, `analyzeImage`, `describeGeneratedImage`) go through one function, `postGenerateContent()`.

**Which route:**
- The key file `ops/vertex/oskar-ai.json` exists (path override: env `OSKAR_VERTEX_KEY`) → **Vertex**: `https://aiplatform.googleapis.com/v1/projects/<project_id from the key>/locations/global/publishers/google/models/<IMAGE_MODEL>:generateContent`, with a Bearer token from `google-auth-library` (`GoogleAuth` with the key file, scope `cloud-platform`; the library caches and refreshes the token).
- No key file → the old Gemini API route with `GOOGLE_API_KEY`, unchanged. There is no silent fallback from Vertex to the API key.
- The server log says which route is active, once after start: `[gemini] route: Vertex AI, project mini5server, global, gemini-nano-banana-2.1`.

**What Oskar changes in the request for Vertex** (`toVertexBody()`; each rule comes from a failed or passed live test on 2026-10-22):

| Rule | Why |
|---|---|
| `role: 'user'` on every content | without it Vertex answers 400 "Please use a valid role: user, model." (the Gemini API doesn't care) |
| drop `responseModalities: ['TEXT']` when it is the only modality | Vertex answers 400 "Request contains an invalid argument" for `gemini-nano-banana-2.1`; text is the default anyway |
| `thinkingConfig.includeThoughts: false` | Vertex returns the model's thinking by default, **including a draft image before the final one**; Oskar took the first image/text it found and would have saved the draft and the thinking text |
| the 4 image harm categories added, all `OFF` | they exist only on Vertex (see the filter table below) |
| `imageConfig.personGeneration: 'ALLOW_ALL'`, `imageConfig.prominentPeople: 'ALLOW_PROMINENT_PEOPLE'` | only Vertex has these fields; on image calls only |

**Response:** parts with `thought: true` are skipped everywhere (`answerParts()`), on both routes.

**429:** Vertex answers 429 "Resource has been exhausted" in bursts, after 3–4 quick calls. It is Google's **shared capacity** for the model (Dynamic Shared Quota), not a project quota: on 2026-10-22 every quota of the project showed 0 % usage. Oskar retries 429 on Vertex 5 times with waits of 2, 4, 8, 16 s; image calls additionally keep their own 3-attempt loop. A request still failing after that shows the 429 text in Oskar.

**Tested in Oskar on 2026-10-22** (session `2026-10-22-1` "Vertex Test", images uploaded through `/api/upload`, the same call as the Assets panel's ADD button):

| Path | Result |
|---|---|
| `POST /api/generate-image` (MCP tool and brand panel path), 16:9 2K | 200 in 24 s, 2752×1536 PNG, `geminiText` = the ~100-word description (not thinking text), IMAGES.md entry written |
| `POST /api/edit-image` generate | 200 in 16 s |
| `POST /api/edit-image` edit with a source image | 200 in 19 s, only the requested change made |
| `POST /api/analyze-image` | first try 429 ×4 (burst), retry 200 in 6 s with the full JSON analysis |
| Image mode UI → Generate tab | image appears READY in the Assets panel, "… ready" notice, 200 in 27 s |
| Image mode UI → Edit tab with an image from the panel | edited image READY next to its source, 200 in 25 s |

Known, not changed: `/api/generate-image` names its file `.jpg` although the data is PNG (as before Vertex); `/api/edit-image` uses the real extension.

## Image options and filters on Vertex (researched and tested 2026-10-22)

**Settable per request** (Vertex REST reference `GenerationConfig` / `ImageConfig` / `SafetySetting`):

| Field | Values | Oskar sends |
|---|---|---|
| `safetySettings[].category` | `HARM_CATEGORY_HATE_SPEECH`, `_DANGEROUS_CONTENT`, `_HARASSMENT`, `_SEXUALLY_EXPLICIT`, `_JAILBREAK`, and image-only `_IMAGE_HATE`, `_IMAGE_DANGEROUS_CONTENT`, `_IMAGE_HARASSMENT`, `_IMAGE_SEXUALLY_EXPLICIT` (`_CIVIC_INTEGRITY` is deprecated) | all 9 |
| `safetySettings[].threshold` | `BLOCK_LOW_AND_ABOVE`, `BLOCK_MEDIUM_AND_ABOVE`, `BLOCK_ONLY_HIGH`, `BLOCK_NONE` (still rates), `OFF` (filter skipped) | `OFF` |
| `safetySettings[].method` | `SEVERITY`, `PROBABILITY` (default) | not sent |
| `imageConfig.personGeneration` | `ALLOW_ALL` (adults and children), `ALLOW_ADULT`, `ALLOW_NONE`; unset = the model decides | `ALLOW_ALL` |
| `imageConfig.prominentPeople` | `ALLOW_PROMINENT_PEOPLE`, `BLOCK_PROMINENT_PEOPLE`; unset = allowed; `personGeneration` wins if both are set | `ALLOW_PROMINENT_PEOPLE` |
| `imageConfig.aspectRatio` | 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9 (the newer `responseFormat.image` also lists 1:4, 4:1, 1:8, 8:1) | from the caller |
| `imageConfig.imageSize` | `1K` (default), `2K`, `4K` | from the caller |
| `imageConfig.imageOutputOptions` | `mimeType`, `compressionQuality` | not sent (PNG comes back) |

Notes: Vertex marks `imageConfig` as deprecated in favour of `responseFormat.image` (delivery, MIME type, aspect ratio, size), but `personGeneration` and `prominentPeople` exist **only** in `imageConfig`, and it works. `HARM_CATEGORY_JAILBREAK` on Vertex is a classifier that is off unless a threshold is set; `OFF` is accepted.

**Not settable** — what still blocks, with the support codes Google returns:

| Filter | Shows up as | Can it be turned off? |
|---|---|---|
| **Third-party content** (copyright / protected characters and people by name), support code **35561575** (35561574) | `finishReason: IMAGE_PROHIBITED_CONTENT`, `finishMessage: "Unable to show the generated image due to interests of third-party content providers … Support code: 35561575."`, no safety ratings | No setting in the API and no allowlist documented (Google lists allowlists only for Child and Celebrity). It checks the **prompt text** for names, not the generated image. |
| Prohibited content (child sexual abuse material, other sensitive content) | `PROHIBITED_CONTENT` / `IMAGE_PROHIBITED_CONTENT`, prompt `blockReason` | No |
| Sensitive personal data in text | `SPII` | No |
| Recitation | `RECITATION` / `IMAGE_RECITATION` | No |
| Model refusal | `finishReason: STOP`, text saying it can't create the image | No (it's the model, not a filter) |
| Child / Celebrity (photorealistic), codes 58061214/17301594 and 29310472/15236754 | `IMAGE_SAFETY` with `raiFilteredReason` | via `personGeneration` / `prominentPeople` (set) and Google's project allowlist |

Other image support codes Google lists: dangerous 62263041, hate 57734940/22137204, other 74803281/29578790/42876398, person/face 39322892, personal data 92201652, prohibited 89371032/49114662/72817394, sexual 90789179/63429089/43188360, harmful 78610348, violence 61493863/56562880, vulgar 32635315, celebrity-or-child 64151117.

**Test (2026-10-22, Oskar's settings above):**

| Prompt | Result |
|---|---|
| "Yoda, the Jedi master from Star Wars, meditating … Dagobah" | blocked, third-party content, 35561575 |
| "Obi-Wan Kenobi from Star Wars … blue lightsaber … Tatooine" | blocked, third-party content |
| "Ewan McGregor as Obi-Wan Kenobi, portrait photo" | blocked, third-party content (not the celebrity code) |
| "A jedi knight in a light saber duel with a sith lord" (Ralph, in the UI) | image, recognisably Obi-Wan |
| "a tiny wise elderly green creature with long pointed ears … misty swamp" | image |
| "a bearded man in a brown hooded monk robe holding a glowing blue energy sword …" | image |

Sources: [Gemini image generation and responsible AI](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/gemini-image-responsible-ai), [Safety and content filters](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/configure-safety-filters), [Responsible AI for Veo (support codes incl. 35561575)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/responsible-ai-and-usage-guidelines), REST reference [GenerationConfig/ImageConfig](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1/GenerationConfig), [HarmCategory](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1/HarmCategory), [HarmBlockThreshold](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1/HarmBlockThreshold), [Edit images with Gemini](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/gemini-edit-images), [Gemini image generation limitations](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/gemini-image-generation-limitations).

## Hand-over report to the human

State, with what you verified: service account email and its one role, key path and mode (never the contents), billing account ID and type (trial and its end date), the credits listed in step 5.4, API status, test result. Mention that the free trial ends after 90 days or when its credit is used up; after that Google stops the resources unless the human upgrades the billing account to a paid one, and the $10 monthly credit only keeps working on a paid account.
