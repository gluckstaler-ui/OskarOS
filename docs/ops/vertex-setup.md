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

**Where:** `lib/vertex.ts` (the service account: key path, project, token; shared with video) and `lib/gemini.ts`. All six Google calls in `lib/gemini.ts` (`generateImage`, `callGemini` = generate/edit/compose, `editImageWithText`, `chat`, `analyzeImage`, `describeGeneratedImage`) go through one function, `postGenerateContent(body, model)`.

**Models:** images `gemini-nano-banana-2.1` (`OSKAR_IMAGE_MODEL`); the three text-only calls (`chat`, `analyzeImage`, `describeGeneratedImage`) `gemini-3.8-flash` (`OSKAR_TEXT_MODEL`): 3 s instead of 15–25 s on the image model, and cheaper. Tested on `global`: 3.8/3.7/3.6/3.5 Flash answer in ~3 s, Gemini 4 Argon in 55 s.

**Token limit includes thinking.** On Gemini 3.x `maxOutputTokens` counts the model's thinking (500–650 tokens for one image analysis). With the old 1,024 the analysis JSON was cut off → "Could not analyze image". Now 4,096 for `analyzeImage`, 2,048 for `describeGeneratedImage`. A higher limit costs nothing extra: only generated tokens are billed.

**After changing `lib/` or `app/` code, restart Oskar.** Its dev server does not reliably notice edits (`/Oskar` is a symlink to `/System/Volumes/Data/Oskar`); on 2026-10-22 the running server kept the old module (it still said "attempt 1/4" after the code said 5). Check: the log line `[gemini] route: …` appears again after the first request. Restart: runbook 8.5.

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
| `POST /api/analyze-image` | first try 429 ×4 (burst), retry 200 in 6 s; after the switch to `gemini-3.8-flash` and the 4,096 limit 3 of 3 runs complete in 8–10 s |
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

## Step 9 — Video with Gemini Omni Flash (Image mode → VIDEO and VID → VID tabs, 2026-10-23)

**Model and API.** On Vertex the model is `gemini-omni-1.1-flash-preview` (Preview, location `global` only; `OSKAR_VIDEO_MODEL` overrides). It is called through the **Interactions API**, not `generateContent`:
`POST https://aiplatform.googleapis.com/v1beta1/projects/PROJECT/locations/global/interactions`, same Bearer token as Step 7. The same project, billing account, credits and service account work; nothing else to enable. (The model page lists "Pay-as-you-go: Not supported"; on 2026-10-22 it worked on a trial account all the same.)

**Request** (`lib/omni.ts`):
```json
{
  "model": "gemini-omni-1.1-flash-preview",
  "background": true,
  "store": true,
  "input": [
    {"type": "image", "data": "<base64>", "mime_type": "image/png"},
    {"type": "text", "text": "<prompt>"}
  ],
  "response_format": [{"type": "video", "aspect_ratio": "16:9", "resolution": "720p", "duration": "8s"}],
  "generation_config": {"seed": 1234, "thinking_level": "high", "video_config": {"task": "image_to_video"}}
}
```
→ answer `{"id": …, "status": "in_progress"}` → `GET …/interactions/<id>` every 5 s until `completed` → the mp4 is inline in `steps[type=model_output].content[type=video].data` (base64) unless `gcs_uri` is set. The `id` is the **generation ID**: Vertex keeps it 14 days, and `previous_interaction_id: <id>` continues that video (extend, edit) without uploading it again.

**Options — what the API really takes** (OpenAPI spec, Vertex pages, and live tests 2026-10-22/23, ~$4 at 360p):

| Option | Values | Tested |
|---|---|---|
| `aspect_ratio` | `16:9`, `9:16` only; unset = the model picks from prompt/images | 1:1, 4:3, 21:9 → 400 "Supported values: '16:9', '9:16'" |
| `duration` | `3s`–`10s` per generation | 2 s → failed "Requested duration 2 less than minimum duration 3."; 11 s failed too |
| `resolution` | `360p`, `720p` (default), `1080p`, `4k` | 1080p vs. 720p with the same seed: SSIM 0.988, same picture — 1080p is Google's upscale of the 720p render (crisper detail than a plain resize); 4k likewise per Google |
| `seed` | integer | same seed + same settings → identical frames (SSIM 1.000); the API doesn't return the seed it used, so Oskar always sends one and stores it |
| `thinking_level` | `low`, `high` only | `minimal` → 400; same seed with low vs. high → a different video (SSIM 0.80); ~316 vs ~352 thought tokens, same time |
| number of videos | none (one per request) | — |
| negative prompt, temperature, system instructions | not supported | write "No dialogue", "no music" into the prompt |
| audio input | undocumented (Google: not supported) | an mp3 was accepted; not offered in Oskar |

**What each situation is sent as** (Oskar picks it from the slots; `lib/omni-tasks.ts`):

| Situation | `task` | Inputs | Limits found live |
|---|---|---|---|
| Text → video | `text_to_video` | prompt | — |
| Image → video | `image_to_video` | 1 image, prompt prefixed `<FIRST_FRAME>` | — |
| First + last frame | `image_to_video` | 2 images, `<FIRST_FRAME> <LAST_FRAME>`; the same image twice = loop | 3 images → failed "supports at most 2 input images: a first frame and an optional last frame" |
| First frame + ingredient | — (not offered) | tried: 2 images + declaration `[# Sources <FIRST_FRAME>@Image1] [# References <IMAGE_REF_0>@Image2]` | worked in a 3 s test, but a 10 s run still ended on the ingredient image as if it were the last frame; without the declaration the second image is the last frame; `reference_to_video` doesn't keep the first frame; a video ingredient → "Video input is not supported for the image_to_video task". So: **frames or ingredients, not both** |
| Ingredients → video | `reference_to_video` | up to 10 images (`<IMAGE_REF_n>`) and 3 videos (`<VIDEO_REF_n>`) | Google advises ≤ 3 s per video and ignores their audio; a 6 s clip was accepted |
| Extend | `extend`, or `previous_interaction_id` (no task) | 1 video (+ ingredient images) | no `aspect_ratio` (400); uploaded video ≤ 30 s ("Videos longer than 30s are not supported for extension."); result = whole video + new part, up to 40 s; only the new seconds are billed; reference videos → 400 "Exactly one input video is required" |
| Edit | `edit`, or `previous_interaction_id` | 1 video ≤ 10 s (+ ingredient images) | "Editing duration 11.1667 exceeds maximum duration 10."; no `aspect_ratio` (400); keeps length and ratio; reference videos → 400 |

**More rules found by live tests:**

| Rule | What happened otherwise |
|---|---|
| Use `background: true` and poll | a synchronous call took 103 s; Node's `fetch` gives up on responses taking more than 5 minutes |
| `previous_interaction_id` **without** `video_config.task` (seed and thinking_level are fine) | 400 "previous_interaction_id is not allowed when video task is set." |
| `store: true` on every request | otherwise the result can't be continued by its generation ID |
| Read `errors[].message` of a `failed` interaction | limits broken after the request was accepted (length, input size) end as status `failed`, not as HTTP 400 |
| Editing/extending an **uploaded** video works on Vertex from Switzerland | the Gemini API docs say this is blocked in the EEA, Switzerland and the UK — not on Vertex |

**Oskar's two video tabs** (Image mode; one workshop card each, like Img Ops — `components/video-mode/`):

- **VIDEO** (text / image(s) → video). Left: slots **First frame**, **Last frame** (+ **Loop**) or **Ingredients** — filled like Layout: the dashed slot is active, a library click fills it and moves on, a second click on the same asset takes it out, the library tiles get badges (First, Last, Ing 1…). No slot filled = text → video. The slots decide the task (table above); combinations Omni rejects are shown in the slots and block Generate. Below: **Length** 5 / 8 / 10 / 20 / 30 s, **Ratio** Auto / 16:9 / 9:16, **Res** 360p / 720p / 1080p ↑ / 4K ↑, **Thinking** Low / High, **Variation** New / Keep (Keep = the seed of the last video). Right: one **video prompt** with Presets ▾ (per situation), ✂ Cut, the part plan, filename, cost, Reset / Review by AI / Generate.
- **VID → VID**. Left: **Extend / Edit**, the video slot (shows its length and whether Oskar continues its generation ID — "Made by Oskar · N days left — no upload" — or uploads the file), optional ingredient images, Add 5–30 s (extend, capped at 40 s in all), Res, Thinking, Variation. Right: the same prompt area.

**Videos longer than 10 s.** One prompt for the whole video (so Review by AI sees all of it), cut into 10 s parts by lines starting with ✂ — `✂ PART 2 · 10–20 s`. Picking 20 or 30 s adds the missing cuts; ✂ Cut inserts one at the cursor. Generate runs one generation per part (`run-video.ts`): part 1 is the new video, every further part extends the part before by its generation ID. Each part's prompt starts with "Extend this video:" and timecodes written for the whole video (`[12-15s]` in part 2) are moved to the part's own clock (`[2-5s]`). Earlier parts are kept in `public/<session>/video-parts/` (not in the library) so a failed later part loses nothing paid; Generate then reads "Continue from part N". `VIDEOS.json` records every video's generation ID, mode, prompt, options, seed, sources, the `chain` of generation IDs of its parts, tokens and cost.

**Files:** `lib/vertex.ts` (account), `lib/omni.ts` (API), `lib/omni-tasks.ts` (limits, slot → task), `lib/omni-pricing.ts` (prices), `lib/video-presets.ts` (prompt presets), `app/api/generate-video/route.ts` (POST one generation, GET `VIDEOS.json`), `components/video-mode/` (`VideoWorkshop.tsx`, `video-slots.ts`, `video-parts.ts`, `run-video.ts`), `components/AdvancedMode.tsx` (tabs, library clicks, badges), `AssetGrid`/`AssetsPanel`/`CanvasPreview` (video tiles and player), `app/api/admin/sessions/[id]/route.ts` (lists `.mp4/.webm/.mov`). **Review by AI** sends the CD the situation, slots with their tags, settings and the cut rules, and returns the refined prompt into the prompt area.

**Price** (Vertex pricing page, 2026-10-22): video output $17.50 per 1M tokens; per second with sound 1,931 tokens at 360p ($0.034), 5,792 at 720p ($0.10), 8,688 at 1080p ($0.15), 17,376 at 4k ($0.30); input $1.50 per 1M (a 360p input video ≈ 1,200 tokens per second, measured). Measured: every 3 s 360p clip = 5,793 output tokens ≈ $0.10; a 10 s 1080p clip 86,880 tokens ≈ $1.52; extend bills only the added seconds; an edit re-renders the whole video.

**Image prices for comparison** (same page): Nano Banana 2.1 output image $0.034 (1K), $0.05 (2K), $0.113 (4K); `gemini-3.8-flash` $0.75 / $3.75 per 1M tokens in/out until 2026-12-31, then $1.50 / $7.50.

## Hand-over report to the human

State, with what you verified: service account email and its one role, key path and mode (never the contents), billing account ID and type (trial and its end date), the credits listed in step 5.4, API status, test result. Mention that the free trial ends after 90 days or when its credit is used up; after that Google stops the resources unless the human upgrades the billing account to a paid one, and the $10 monthly credit only keeps working on a paid account.
