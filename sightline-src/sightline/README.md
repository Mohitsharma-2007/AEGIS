# Sightline v0.3 — Screen-to-scene studio with a guided Airflow Lab

Sightline turns a selected tab, window, image, or prompt into an interactive 2D diagram or 3D model. You can use the built-in scenes without a model, run an installed local model without a cloud key, or choose a cloud API.

**What stays the same:** a model returns a short semantic plan (subject, template, parts, and notes). Sightline chooses the layout, colors, materials, geometric detail, labels, camera, and animation. The *same validated plan* produces the same drawing in a given mode no matter which provider supplied it. A small model can still misread a screenshot, give a different explanation, or miss parts. Generic 3D scenes are explanatory schematics, not exact meshes reconstructed from the screen.

## Airflow Lab — no model or API key needed

Launch the studio, choose **Airflow lab**, or open `http://127.0.0.1:3000/?demo=airflow` to start there. Each exhibit works in **3D Model** and **2D Diagram**.

| Exhibit | Try this |
| --- | --- |
| **Wind tunnel** | Start **Play walkthrough** or choose **Wake and drag**. Change **Wind speed** and **Crosswind**, toggle **Gusts**, or select **Wake rotation**. The readout shows a relative, unitless drag index. Pause freezes the field and moving tracers; reset starts a new solve with your current settings. |
| **Engine cutaway** | Open the **Engine cutaway** tab. The near half of the outer case is removed along the engine’s centerline. Select a label or walk from the fan and bypass duct through compression, combustion, turbine, and exhaust. Adjust **Motion**, toggle **Flow paths**, or close the **Cutaway** to see the casing. |

The wind tunnel solves a low-speed **2D** flow around an original civilian twinjet silhouette in a browser worker. Streamlines follow the evolving velocity field and the drag readout uses momentum transferred to the fixed obstacle. The 3D view displays the same slice beside a model; it does not compute 3D flow, lift, compressibility, or real aircraft performance. Particle motion is accelerated for readability. The generic turbofan’s rotors and colored core/bypass paths illustrate the layout and direction of flow, not gas dynamics, thrust, temperature, or an actual engine design. Neither exhibit is validated engineering CFD.

## Guide cursor and more demonstrations

- Click a callout or choose a walkthrough step to see a highlighter and a virtual guide cursor. The guide follows the scene while you orbit, pan, or zoom and never moves your actual pointer. Use the pointer icon to hide it; the label control is separate. For a scene with a walkthrough, you can also type `Play the walkthrough` in the prompt box. Reduced-motion settings skip the guide’s glide.

- Turn the **Raspberry Pi 5** in the 3D canvas. Select **Show camera connection** and hit **Play walkthrough**. The ribbon moves from alignment to seating; callouts track the moving components.
- Watch **Next-token prediction** build one example at a time in 2D, or switch to its 3D view. **How a fan moves air** shows rotating blades and moving flow markers. This is a diagram, not a fluid simulation.
- Select **Water filtration** to see what a generic three-part model plan produces. Switch between 2D and 3D without asking a model. You can also enter `Capture -> Interpret -> Render` to author your own sequence locally.

## Run with Qwen3-VL 4B, 4-bit, on your computer

1. Install current [Ollama](https://ollama.com/) and Node.js 20.11+ (or a newer LTS). Start Ollama. On Linux without a running service, you can use `ollama serve` in a separate terminal.
2. Pull the [quantized vision model](https://ollama.com/library/qwen3-vl:4b-instruct-q4_K_M):

   ```sh
   ollama pull qwen3-vl:4b-instruct-q4_K_M
   ```

3. Extract this project, open a terminal in the `sightline` folder, and run:

   ```sh
   npm ci
   npm run dev -- --port 3000
   ```

4. Open `http://127.0.0.1:3000` on the same computer. In **Model settings → Local Qwen 4B**, leave **Images (vision)** selected. Use **Check connection**, then **Use this model**. For an inference test, ask about a novel topic or enable **Compatibility options → Always ask the selected model**; common prompts otherwise take an instant built-in route.
5. Click **Share screen** and select the relevant tab/window, or upload a screenshot. Ask a question and click **Visualize**. **Follow changes** repeats the last question when the captured view changes. A cold load can take longer. Model inference speed depends on available memory, GPU acceleration, and CPU; local rendering is independent of that latency.

The hosted preview cannot reach the Ollama server on your computer. Use the localhost copy for local inference. Pick an installed, non-cloud model in Ollama if you want inference kept on your machine. Sightline never switches a failing local request to a cloud provider.

### Text-only Qwen or another text model

Pull `ollama pull qwen3:4b`, select **Text + OCR → Use Qwen3:4b**, and use the same workflow. Sightline reads English text in the browser using bundled Tesseract assets. The model sees the recognized text and your prompt, not the screenshot. It cannot recover a picture-only subject from OCR. If OCR misses small text, share just the relevant window or zoom it in. You can also type a standalone prompt.

## Use another runtime or cloud API

Select the provider, enter the model ID (or use **Check connection** to list models), and choose **Images (vision)** or **Text + OCR** according to its input capabilities. Cloud profiles require the provider’s API key; local runtimes use no key by default. The key is held in tab memory, not in project files or browser storage.

| Profile | API | Default / configuration |
| --- | --- | --- |
| Ollama | Native `/api/chat` | `http://127.0.0.1:11434` · `SIGHTLINE_OLLAMA_URL` |
| LM Studio | OpenAI-compatible | `http://127.0.0.1:1234/v1` · `SIGHTLINE_LM_STUDIO_URL` |
| llama.cpp | OpenAI-compatible | `http://127.0.0.1:8080/v1` · `SIGHTLINE_LLAMA_CPP_URL` |
| Custom local | OpenAI-compatible, e.g. vLLM or LocalAI | `http://127.0.0.1:8000/v1` · `SIGHTLINE_LOCAL_BASE_URL` |
| OpenAI, OpenRouter, Groq, Together, Alibaba Cloud Model Studio | Provider Chat Completions endpoints | Select the provider and model ID; Alibaba uses the international endpoint |
| Google Gemini, Anthropic | Native Gemini `generateContent` / Anthropic `messages` | Select the provider and model ID |
| Custom cloud | OpenAI-compatible Chat Completions | Set `SIGHTLINE_CLOUD_BASE_URL` to your API’s HTTPS base (usually ending in `/v1`) before running Sightline |

For LM Studio, start its local server and load an appropriate model. For llama.cpp, start `llama-server` with your GGUF; image input requires loading a compatible multimodal projector (`--mmproj` or a matching model package). Some smaller or older backends don’t enforce JSON schemas: choose **Compatibility options → JSON object** or **Prompt only**. Unrelated proprietary APIs with different request protocols need an adapter in `server/runtimes.js`.

Example custom compatible endpoint on macOS/Linux:

```sh
SIGHTLINE_CLOUD_BASE_URL=https://your-provider.example/v1 npm run dev -- --port 3000
```

PowerShell:

```powershell
$env:SIGHTLINE_CLOUD_BASE_URL = 'https://your-provider.example/v1'
npm run dev -- --port 3000
```

Keep the custom URLs under the control of the server operator. Browser inputs can choose a model and a configured provider, but cannot send arbitrary network destinations to the proxy. Local-model routes require direct loopback access with a localhost Host header; they aren't exposed through the hosted preview. Requests don't follow provider redirects.

## Use and privacy

- **Share screen** uses the browser picker. **Upload image** or paste also works. The source is held in memory, not stored on disk by the studio. Cloud vision sends a resized JPEG only when you click Visualize or actively enable Follow changes. Cloud Text + OCR sends recognized text instead. Providers’ data policies and billing still apply. Check connection uses the model list endpoint, without sending your source or making an inference request.
- Follow changes samples about every 0.85 s for layout trace, 2.4 s for local vision, 3.2 s for cloud vision, and 3.3 s for OCR. It uses a compact pixel signature to skip nearly identical frames, doesn't queue behind a pending request, and keeps the current scene usable until the next plan arrives. Those intervals are sampling cadence, not end-to-end inference latency.
- Layering overlays the scene over the capture **inside the app**. **⋯ → Float canvas** opens an always-on-top companion where Chromium Document Picture-in-Picture is supported. Localhost or HTTPS is required for capture; if the embedded preview blocks it, open it directly or run it locally. The browser app cannot draw a transparent OS-wide overlay into other apps.

## Engine and portable recipes

```text
permissioned capture / prompt
  → changed-frame sampler → JPEG (vision) or English OCR (text)
  → selected provider → small validated scene plan
  → deterministic scene compiler → SVG or Three.js + guided walkthrough
```

- `src/engine/plan.js` defines a small provider-neutral JSON contract. It accepts small-model formatting variants but discards arbitrary styling, geometry and extra fields. The model never executes code.
- `src/engine/compile.js` creates labeled process, anatomy, assembly, comparison, cycle, forces and hierarchy views. Some documented subjects use detailed procedural assets in `src/engine/models.js`. Novel topics use the same shape library and model-independent design system, rather than a model emitting drawing code.
- The default Ollama profile uses a 4,096-token context, a 510-token response cap, structured output where supported, compact screenshots, and a 15-minute keep-alive to avoid repeatedly loading the model. Use a smaller context or source crop if your runtime reports resource pressure.
- **⋯ → Download scene plan** exports the plan independently of the provider. **Import scene JSON** accepts it or the drawing geometry; the same plan can be rendered in either mode without another inference call. An exported lab scene restores the built-in exhibit, not a snapshot of the transient flow or the control settings.

```json
{
  "kind": "process",
  "title": "Water filtration",
  "summary": "Three stages from intake to cleaner water.",
  "asset": "none",
  "parts": [
    {"name": "Intake", "note": "Water enters the system.", "form": "tube"},
    {"name": "Filter bed", "note": "Media traps suspended particles.", "form": "panel"},
    {"name": "Outlet", "note": "Filtered water leaves the unit.", "form": "flow"}
  ]
}
```

## Build and verification

```sh
npm test
npm run build
npm run preview -- --port 3000
```

Both Vite entry points include the same-origin model proxy. If you deploy `dist` to static hosting alone, supply that proxy to use models. The OCR language file and WebAssembly assets are copied from npm dependencies by the dev/build scripts and loaded only when needed.

The unit suite covers the toy solver, passive tracers, safe guide targets, deterministic 2D/3D output, provider payloads, and protocol fallback. Browser QA checks both lab renderers, guided annotations, and mobile controls. The capture/OCR and model-connector checks use genuine browser rendering and OCR, with a mock runtime for local/cloud inference. The full 4B weights and live paid APIs were not benchmarked in the hosted sandbox. Performance and recognition should be tested on your device with your model.
