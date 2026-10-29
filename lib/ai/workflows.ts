import { factoryInstruction, roastInstruction } from "./prompts";

// These describe the deployed workflows. Each call also retains its actual payload.
export const workflows = [
  { key: "live_roast", name: "GetChecked live roast", description: "A live camera roast using Gemini.", steps: [
    { name: "Generate a grounded roast", system_prompt: roastInstruction, user_prompt: "Participant settings, events, timestamped frames, and recent jokes.", provider: "Google Gemini" },
  ] },
  { key: "factory_captions", name: "Factory meme captions", description: "Five captions followed by an optional shorter-caption revision; images are rendered locally.", steps: [
    { name: "Generate five distinct captions", system_prompt: factoryInstruction, user_prompt: "User direction and a JPG or PNG image.", provider: "Google Gemini" },
    { name: "Revise captions to fit", system_prompt: factoryInstruction, user_prompt: "The same image and direction, with a request for five shorter captions after a layout failure.", provider: "Google Gemini" },
  ] },
  { key: "seedream_image", name: "Seedream image generation", description: "Text or reference-image generation, including admin media and character portraits.", steps: [
    { name: "Generate an image", system_prompt: "", user_prompt: "The user's prompt, with a character-portrait instruction for disguise requests, plus an optional reference image. Exact rendered prompt is saved with each request.", provider: "ByteDance Ark" },
  ] },
  { key: "roast_meme", name: "GetChecked roast meme", description: "Render a verified roast as a meme over the participant's snapshot.", steps: [
    { name: "Render the roast meme", system_prompt: "", user_prompt: "Preserve the participant and scene and render the verified punchline in the Checked Factory format. Exact rendered prompt is saved with each request.", provider: "ByteDance Ark" },
  ] },
] as const;
