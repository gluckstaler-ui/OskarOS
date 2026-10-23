// ============================================================================
// lib/video-presets.ts — prompt presets for the VIDEO tab (Gemini Omni Flash).
// 2026-10-23.
//
// One list per task, because a good Omni prompt depends on the task (Google's
// Omni prompt guide, docs/ops/vertex-setup.md step 9):
// - generations: scene, subject and motion, camera, lighting and mood, sound;
//   "single continuous shot" when one shot is meant (Omni cuts by default);
//   negatives go into the prompt ("No dialogue") — there is no negative-prompt field;
// - image → video: describe the motion, not the picture; vague prompts give weak motion;
// - first + last: describe the transition between the two frames;
// - references: name each source with its tag, <IMAGE_REF_0>, <VIDEO_REF_0>;
// - extend: "Extend this video" + how the scene continues;
// - edit: short, one change, end with "Keep everything else the same."
// [Square brackets] mark what to fill in. Tags such as <FIRST_FRAME> are the
// ones the API expects; the route adds the frame tags when a prompt lacks them.
// Presets with a length are longer than one generation: their ✂ lines cut
// the prompt into 10 s parts (components/video-mode/video-parts.ts).
// ============================================================================

export type VideoPresetGroup = 'text' | 'image' | 'frames' | 'refs' | 'extend' | 'edit'

export interface VideoPreset {
  label: string
  prompt: string
  /** Sets the length (s) — for presets written in ✂ parts. */
  length?: number
}

export const PRESET_GROUP_LABEL: Record<VideoPresetGroup, string> = {
  text: 'Text → video', image: 'Image → video', frames: 'First + last frame', refs: 'Ingredients', extend: 'Extend', edit: 'Edit',
}

export const VIDEO_PRESETS: Record<VideoPresetGroup, VideoPreset[]> = {
  text: [
    {
      label: 'Hero Background',
      prompt: 'Website hero background: [scene]. Slow, steady camera drift, nothing sudden, nobody looks into the camera. Soft natural light, calm mood, slightly muted colors so overlaid text stays readable. Single continuous shot, no scene cuts. Quiet ambient sound only. No dialogue, no music.',
    },
    {
      label: 'Product Reveal',
      prompt: '[Product] on a minimal matte pedestal in a dark studio. Single continuous shot: the camera slowly orbits a quarter turn while a soft key light sweeps across the product and reveals its texture and shape. Shallow depth of field, premium commercial look. Sound: a soft low whoosh and quiet room tone. No dialogue, no music.',
    },
    {
      label: 'Establishing Shot',
      prompt: 'Cinematic establishing shot of [place] at [time of day]. Slow aerial push-in from a wide view toward [focal point]. Natural light, atmospheric depth, realistic detail. Single continuous shot, no scene cuts. Sound: natural ambience of the place. No dialogue.',
    },
    {
      label: 'Craft Close-ups',
      prompt: '[Person or trade] at work in [place]. Three cuts: [0-3s] close-up of the hands [doing what]; [3-6s] medium shot of the face, focused; [6-8s] detail of the finished [result]. Handheld camera, warm natural light, shallow depth of field. Sound: authentic work sounds of the craft. No dialogue, no music.',
    },
    {
      label: 'Spoken Line',
      prompt: 'Medium shot of [person, age, look] in [place], looking into the camera and saying in natural [language]: "[one short sentence]". Natural lip sync and facial expression, soft daylight, shallow depth of field. Single continuous shot. Sound: the line, soft room ambience, no music.',
    },
    {
      label: 'Social Clip',
      prompt: 'Fast, upbeat social clip with four cuts: [0-2s] [hook shot]; [2-4s] [second shot]; [4-6s] [third shot]; [6-8s] [closing shot with the result]. Bright, saturated look, dynamic handheld camera. Sound: upbeat music with a beat on every cut. No dialogue.',
    },
    {
      label: 'Macro Detail',
      prompt: 'Extreme macro close-up of [detail]. Single continuous shot: a slow focus pull reveals the texture while [small motion: drops, steam, fibres] moves gently. Soft directional light, dark background. Sound: subtle, close ambient sound. No dialogue, no music.',
    },
    {
      label: 'Timelapse',
      prompt: 'Timelapse of [scene] from [start state] to [end state]. Locked-off camera, single continuous shot. Light and shadows move smoothly across the scene. Sound: a calm ambient bed. No dialogue.',
    },
    {
      label: 'Story in 2 Parts · 20 s',
      length: 20,
      prompt: '[Style and look, e.g. photorealistic, warm daylight]. [Main subject, described once].\n\n[0-4s] [opening shot]. [4-10s] [what happens next].\nSound: [ambience, effects]. No music.\n\n✂ PART 2 · 10–20 s\nExtend this video: [0-5s] [the turn of the story]. [5-10s] [closing shot]. Same subject, look and sound. No music.',
    },
    {
      label: 'Story in 3 Parts · 30 s',
      length: 30,
      prompt: '[Style and look]. [Main subject, described once].\n\n[0-10s] [setup: where we are, who we see]. Sound: [ambience].\n\n✂ PART 2 · 10–20 s\nExtend this video: [0-10s] [the action]. Same subject, look and sound.\n\n✂ PART 3 · 20–30 s\nExtend this video: [0-10s] [the ending, closing shot]. Same subject, look and sound.',
    },
  ],
  image: [
    {
      label: 'Bring to Life',
      prompt: 'The scene comes to life with subtle natural motion: [what moves — leaves, steam, water, hair]. The camera stays almost still. Keep the composition, lighting and colors of the image. Single continuous shot. Sound: natural ambience. No dialogue.',
    },
    {
      label: 'Slow Push-In',
      prompt: 'Slow, smooth dolly push-in toward [subject] with gentle parallax between foreground and background. Keep the look of the image. Single continuous shot. Sound: quiet ambience. No dialogue, no music.',
    },
    {
      label: 'Orbit',
      prompt: 'The camera slowly orbits around [subject], revealing it from the side while the background shifts with natural parallax. Lighting stays consistent. Single continuous shot. Sound: soft ambient tone. No dialogue.',
    },
    {
      label: 'Action',
      prompt: '[Subject] [does what — turns, walks, pours, smiles] while [secondary motion]. The camera [follows / stays still]. Keep the subject\'s appearance exactly as in the image. Single continuous shot. Sound: [matching sounds]. No dialogue.',
    },
    {
      label: 'Pull Back Reveal',
      prompt: 'Starting on this image, the camera slowly pulls back and rises to reveal [the wider setting]. Natural light, consistent colors. Single continuous shot. Sound: ambience that opens up as the view widens. No dialogue.',
    },
  ],
  frames: [
    {
      label: 'Smooth Transition',
      prompt: 'A single continuous camera move from the first frame to the last frame: [how the camera travels — glides, rises, turns]. Lighting and colors blend naturally on the way. No cuts. Sound: soft ambience. No dialogue.',
    },
    {
      label: 'Seamless Loop',
      prompt: 'A seamless loop that starts and ends on exactly the same frame. Gentle motion — [what moves] — goes out and returns to its starting position. Steady camera, no cuts. Quiet ambient sound. No dialogue, no music.',
    },
    {
      label: 'Before → After',
      prompt: 'Transformation from the first frame to the last frame: [what changes — renovation, styling, season, preparation]. Timelapse feel, steady camera, single continuous shot. Sound: light work sounds fading into calm ambience. No dialogue.',
    },
    {
      label: 'Morph',
      prompt: 'The first frame morphs fluidly into the last frame: shapes and colors flow into each other without a cut. Smooth, dreamlike motion. Sound: a soft rising tone. No dialogue.',
    },
  ],
  refs: [
    {
      label: 'Subject in Scene',
      prompt: '<IMAGE_REF_0> [does what] in [place]. Keep the subject exactly as in the reference — same face or shape, colors and markings in every frame. Use the reference only for the subject\'s appearance, not as a first frame. Single continuous shot. Sound: [matching sounds]. No dialogue.',
    },
    {
      label: 'Product in Use',
      prompt: '[Person] uses <IMAGE_REF_0> in [place]: [action]. The product looks exactly like the reference — shape, color, label. Natural light, shallow depth of field, single continuous shot. Sound: natural ambience and the product\'s own sounds. No dialogue.',
    },
    {
      label: 'Two Subjects',
      prompt: '<IMAGE_REF_0> and <IMAGE_REF_1> meet in [place] and [interaction]. Both keep their appearance from the references. Medium shot, gentle camera movement, single continuous shot. Sound: [matching sounds]. No dialogue.',
    },
    {
      label: 'Style from Image',
      prompt: '[Scene and action] in the visual style of <IMAGE_REF_0>: same color palette, lighting, texture and mood. Do not show the reference image itself. Single continuous shot. Sound: [ambience]. No dialogue.',
    },
    {
      label: 'Motion from Video',
      prompt: '<IMAGE_REF_0> performs the same movement as in <VIDEO_REF_0>, in [place]. Keep the subject\'s appearance from the image and the timing of the motion from the video. Single continuous shot. Sound: [matching sounds]. No dialogue.',
    },
  ],
  extend: [
    {
      label: 'Continue Scene',
      prompt: 'Extend this video: the scene continues naturally — [what happens next]. Same camera style, lighting and sound. No dialogue.',
    },
    {
      label: 'Pull Back',
      prompt: 'Extend this video: the camera slowly pulls back to reveal [the wider setting], while the action settles. Same lighting and sound. No dialogue.',
    },
    {
      label: 'Fade Out',
      prompt: 'Extend this video: [the action comes to rest], then the picture slowly fades to black while the sound fades out.',
    },
    {
      label: 'Next Beat',
      prompt: 'Extend this video: [0-3s] [what happens first]; [3-6s] [what happens next]. Same characters, look and sound as before. No dialogue.',
    },
    {
      label: 'Bring In Ingredient',
      prompt: 'Extend this video: <IMAGE_REF_0> [enters / appears] [where] and [does what]. Keep it exactly like the image. Same light and sound. No dialogue.',
    },
    {
      label: 'Two More Parts · +20 s',
      length: 20,
      prompt: 'Extend this video: [what happens next]. Same look and sound.\n\n✂ PART 2 · 10–20 s\nExtend this video: [how it ends]. Same look and sound.',
    },
  ],
  edit: [
    {
      label: 'Change Style',
      prompt: 'Turn this video into [anime / watercolor / claymation / film noir] style. Keep everything else the same.',
    },
    {
      label: 'Golden Hour',
      prompt: 'Change the lighting to warm, low golden-hour sunlight with long soft shadows. Keep everything else the same.',
    },
    {
      label: 'Day → Night',
      prompt: 'Make it night, lit by street lamps and warm window light. Keep everything else the same.',
    },
    {
      label: 'Change Color',
      prompt: 'Make the [object] [color]. Keep everything else the same.',
    },
    {
      label: 'Remove Object',
      prompt: 'Remove the [object]. Keep everything else the same.',
    },
    {
      label: 'Add Object',
      prompt: 'Add [object] [where]. Keep everything else the same.',
    },
    {
      label: 'New Background',
      prompt: 'Replace the background with [new background]. Keep the subject and its motion the same.',
    },
    {
      label: 'Change Text',
      prompt: 'Change the text on the [sign / label] to "[new text]". Keep everything else the same.',
    },
    {
      label: 'Weather',
      prompt: 'Make it [snow gently / rain lightly / foggy]. Keep everything else the same.',
    },
    {
      label: 'Add Ingredient',
      prompt: 'Put <IMAGE_REF_0> [where] in the scene. Keep everything else the same.',
    },
  ],
}
