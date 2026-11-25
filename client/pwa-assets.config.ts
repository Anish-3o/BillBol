import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Makes the app icons (PNG sizes phones need) from public/favicon.svg:
//   npm run generate-pwa-assets
// Re-run it only when the logo changes; the PNGs are committed like any other asset.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    // Android "maskable" icons are cropped to a circle or squircle by the launcher, keeping only
    // the centre 80%. The receipt in favicon.svg already sits well inside that, so very little
    // padding is needed; the brand colour fills the rounded corners so no white shows.
    maskable: {
      ...minimal2023Preset.maskable,
      padding: 0.05,
      resizeOptions: { background: '#0F766E' },
    },
    // iOS puts icons on a black or white tile itself; fill with brand colour so it looks the same.
    apple: {
      ...minimal2023Preset.apple,
      padding: 0.1,
      resizeOptions: { background: '#0F766E' },
    },
  },
  images: ['public/favicon.svg'],
});
