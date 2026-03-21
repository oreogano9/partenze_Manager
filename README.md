<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/e5f0819c-8fe8-4014-8a9d-d89013b013a1

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Create `.env.local` with:
   `OPENAI_API_KEY=...`
3. Run the app:
   `npm run dev`

## Deploy on Vercel

- Add `OPENAI_API_KEY` as a Vercel environment variable
- Do not commit `.env.local` or any real API key files
- The app calls `/api/extract-flights` server-side so the key does not reach the browser
