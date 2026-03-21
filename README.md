# Partenze Manager

Partenze Manager is a small departures-board web app for quickly reviewing and importing flight sheet data.

It is designed around a simple workflow:

1. scan or import a photo of a departures sheet
2. let the app extract flight rows with OpenAI vision
3. review, filter, and uncheck anything you do not want
4. add the selected flights to the live board

The app is built with Vite, React, TypeScript, and a Vercel-compatible OCR flow.

## What It Does

- Shows a live departures-style board grouped by time urgency
- Lets you scan or import flight sheet photos
- Uses OpenAI vision to extract rows from the image
- Supports repeated scans in the same review session
- Merges rescans into existing OCR rows instead of duplicating them
- Merges imported OCR rows into existing board flights when the same flight is found again
- Marks crossed-out rows and leaves them unchecked by default
- Exports visible flights as:
  - ICS for Apple Calendar / Outlook / system calendar import
  - plain text for AI-assisted calendar creation

## OCR Flow

The OCR flow is server-assisted and Vercel-safe:

1. the browser optimizes the image
2. the browser uploads the image to Vercel Blob
3. the app sends the Blob URL to a server route
4. the server route calls OpenAI with the image URL
5. the app shows a review screen before import

This keeps the OpenAI API key on the server and out of the browser.

## Local Development

### Requirements

- Node.js 18+
- npm

### Install

```bash
npm install
```

### Environment Variables

Create a local env file:

```bash
cp .env.example .env.local
```

Then set:

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_VISION_MODEL=gpt-4.1-mini
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token_here
```

Notes:

- `BLOB_READ_WRITE_TOKEN` is the preferred variable name
- `BLOBV1_READ_WRITE_TOKEN` is also supported as a fallback in the codebase
- `.env.local` should not be committed

### Run

```bash
npm run dev
```

The dev server runs at:

- `http://127.0.0.1:3000`

### Checks

```bash
npm run lint
npm run build
```

## Deploying on Vercel

Add these environment variables in your Vercel project settings:

- `OPENAI_API_KEY`
- `OPENAI_VISION_MODEL` (optional, default is `gpt-4.1-mini`)
- `BLOB_READ_WRITE_TOKEN`

If you already use a legacy/custom blob token name, the app also accepts:

- `BLOBV1_READ_WRITE_TOKEN`

You also need a Vercel Blob store connected to the project.

Recommended setup:

- Blob access: `public`
- Blob region: the closest region to your users

Why public Blob is used here:

- the server sends the uploaded image URL to OpenAI
- OpenAI needs to be able to fetch that image

## Current Behavior Notes

- Dummy data is hidden by default
- OCR review defaults to the extracted flights view on mobile
- Repeated scans can add more images into the same review session
- Extracted flights are sorted by departure time
- Crossed-out rows are flagged and unchecked by default
- The review modal allows quick selection of only `Scivoli` or only `Nastri`

## Project Structure

Important files:

- `src/App.tsx`
  Main app UI, OCR review flow, filtering, and import behavior
- `src/components/FlightCard.tsx`
  Main board card UI and shared expanded content
- `src/services/ocrService.ts`
  Client-side image optimization, Blob upload, and OCR request flow
- `api/extract-flights.ts`
  Server route for calling OpenAI extraction
- `api/_openaiVision.ts`
  OpenAI vision prompt and response normalization
- `api/blob-upload.ts`
  Blob upload token route for Vercel
- `src/constants.ts`
  Translations, mock data, and position type logic
- `src/types.ts`
  Shared app and OCR types

## Security Notes

- Do not put `OPENAI_API_KEY` in client-side code
- Do not use `VITE_OPENAI_API_KEY`
- Do not commit `.env.local`
- The browser should only talk to your own routes, not directly to OpenAI with the secret key

## Future Ideas

Planned or likely future additions:

- difficulty rules based on carrier and special container patterns
- richer handling of handwritten notes
- more OCR review controls for edited / cancelled rows

